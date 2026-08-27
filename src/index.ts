import { handleAdmin } from "./admin";
import { cloudflareAccountId, enabledProviderModels, internalModelId, messagesToChat, proxyOpenAICompatible, publicModelId, runWorkersAI, workersAIBaseUrl } from "./providers";
import { authenticateClient, getProviders } from "./store";
import { chatStreamToMessages, chatStreamToResponses } from "./streaming";
import type { Env, GatewayRequest, Provider } from "./types";
import { instrumentUsageResponse } from "./usage";
import { bearer, cors, error, json, readJson } from "./utils";

function resolveProvider(providers: Provider[], body: GatewayRequest): Provider | undefined {
  if (body.provider) {
    const provider = providers.find((p) => p.id === body.provider && p.enabled);
    if (!provider || !body.model) return provider;
    const internal = internalModelId(provider, body.model);
    if (!internal) return undefined;
    body.model = internal;
    return provider;
  }
  const model = body.model || "";
  const prefix = model.includes("/") ? model.split("/")[0] : "";
  const byPrefix = providers.find((p) => p.enabled && (p.id === prefix || p.name === prefix || p.type === prefix));
  if (byPrefix) {
    const internal = internalModelId(byPrefix, model.slice(prefix.length + 1));
    if (!internal) return undefined;
    body.model = internal;
    return byPrefix;
  }
  for (const provider of providers.filter((item) => item.enabled)) {
    const internal = internalModelId(provider, model);
    if (internal) { body.model = internal; return provider; }
  }
  if (model) return undefined;
  return providers.find((p) => p.enabled && enabledProviderModels(p).length > 0);
}

async function gateway(request: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  const startedAt = Date.now();
  const clientKey = await authenticateClient(env, bearer(request));
  if (!clientKey) return error("API Key 无效", 401, "authentication_error");
  const providers = await getProviders(env);
  if (path === "/v1/models" && request.method === "GET") {
    const seen = new Set<string>();
    const data = providers.filter((p) => p.enabled).flatMap((p) => enabledProviderModels(p).map((model) => ({ id: publicModelId(p, model), object: "model", owned_by: p.name }))).filter((model) => !seen.has(model.id) && Boolean(seen.add(model.id)));
    return json({ object: "list", data });
  }
  if (request.method !== "POST") return error("仅支持 POST", 405);
  const body = await readJson<GatewayRequest>(request);
  let provider = resolveProvider(providers, body);
  if (!provider) return error(body.model ? "该模型未启用或不属于指定提供商" : "没有可用的 AI 提供商", body.model ? 400 : 503, body.model ? "model_not_enabled" : "provider_unavailable");
  const enabledModels = enabledProviderModels(provider);
  if (!body.model) body.model = provider.defaultModel && enabledModels.includes(provider.defaultModel) ? provider.defaultModel : enabledModels[0];
  if (!body.model) return error("请求与提供商均未指定模型", 400);
  const usageProvider = provider;
  const usageModel = body.model;
  const shape = path.includes("responses") ? "responses" : path.includes("messages") || path.endsWith("/message") ? "messages" : "chat";
  let workersRest = false;
  let protocolAdapted = false;
  let response: Response | undefined;
  if (provider.type === "workers-ai") {
    const accountId = cloudflareAccountId(provider.baseUrl);
    const apiToken = provider.apiKey;
    if (!accountId || !apiToken) {
      protocolAdapted = shape !== "chat";
      response = await runWorkersAI(env, provider, body, shape);
    }
    else {
      provider = { ...provider, type: "openai-compatible", apiKey: apiToken, baseUrl: workersAIBaseUrl(accountId) };
      workersRest = true;
    }
  }
  if (!response) {
    if (shape === "responses" && (provider.type === "groq" || workersRest)) response = await proxyOpenAICompatible(provider, body, "responses", request.signal);
    else {
      protocolAdapted = shape !== "chat";
      const upstream = await proxyOpenAICompatible(provider, shape === "chat" ? body : messagesToChat(body), "chat/completions", request.signal);
      if (shape === "chat" || !upstream.ok) response = upstream;
      else if (body.stream) response = shape === "messages" ? chatStreamToMessages(upstream, body.model) : chatStreamToResponses(upstream, body.model);
      else {
        const data = await upstream.json<Record<string, unknown>>();
        const choices = data.choices as Array<{ message?: { content?: string } }> | undefined; const text = choices?.[0]?.message?.content || "";
        if (shape === "responses") response = json({ id: data.id || `resp_${crypto.randomUUID()}`, object: "response", status: "completed", model: data.model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], output_text: text, usage: data.usage }, upstream.status, { "x-llm-provider": provider.id });
        else response = json({ id: data.id, type: "message", role: "assistant", model: data.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: data.usage }, upstream.status, { "x-llm-provider": provider.id });
      }
    }
  }
  return instrumentUsageResponse(env, ctx, response, {
    clientKeyId: clientKey.id,
    endpoint: path,
    providerId: usageProvider.id,
    providerName: usageProvider.name,
    providerType: usageProvider.type,
    model: usageModel,
    status: response.status,
    startedAt,
    streaming: Boolean(body.stream),
    protocolAdapted,
  }, body);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url); let response: Response;
    try {
      if (request.method === "OPTIONS") response = new Response(null, { status: 204 });
      else if (url.pathname === "/health") response = json({ ok: true, service: "edge-provider" });
      else if (url.pathname.startsWith("/admin/")) response = await handleAdmin(request, env, url.pathname);
      else if (["/v1/chat/completions", "/v1/responses", "/v1/messages", "/v1/message", "/v1/models"].includes(url.pathname)) response = await gateway(request, env, ctx, url.pathname);
      else response = await env.ASSETS.fetch(request);
    } catch (cause) {
      console.error(JSON.stringify({ event: "request_error", path: url.pathname, message: cause instanceof Error ? cause.message : String(cause) }));
      response = error(cause instanceof Error ? cause.message : "内部错误", 500, "gateway_error");
    }
    return cors(request, response);
  }
} satisfies ExportedHandler<Env>;
