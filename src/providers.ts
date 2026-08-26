import type { Env, GatewayMessage, GatewayRequest, Provider } from "./types";
import { error, json } from "./utils";

type ModelRecord = Record<string, unknown>;

export interface ProviderModelCatalog {
  models: string[];
  freeModels: string[];
}

function modelId(item: ModelRecord, preferId: boolean): string | null {
  const keys = preferId ? ["id", "model", "model_id", "name"] : ["name", "id", "model", "model_id"];
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value) return value.replace(/^models\//, "");
  }
  return null;
}

export function uniqueModels(items: unknown[], preferId = false): string[] {
  return [...new Set(items.map((item) => item && typeof item === "object" ? modelId(item as ModelRecord, preferId) : null).filter((id): id is string => Boolean(id)))].sort();
}

export function isOpenRouterFreeModelId(model: string): boolean {
  return model === "openrouter/free" || model.endsWith(":free");
}

function isZeroPrice(value: unknown): boolean {
  return (typeof value === "string" || typeof value === "number") && value !== "" && Number(value) === 0;
}

export function openRouterFreeModels(items: unknown[]): string[] {
  const free = items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as ModelRecord;
    const id = modelId(record, true);
    if (!id) return [];
    const pricing = record.pricing && typeof record.pricing === "object" ? record.pricing as ModelRecord : {};
    const zeroTokenPrice = isZeroPrice(pricing.prompt) && isZeroPrice(pricing.completion);
    const zeroRequestPrice = pricing.request === undefined || isZeroPrice(pricing.request);
    return isOpenRouterFreeModelId(id) || (zeroTokenPrice && zeroRequestPrice) ? [id] : [];
  });
  return [...new Set(free)].sort();
}

export function normalizeProviderFreeModels(provider: Pick<Provider, "type" | "models" | "freeModels">): string[] {
  if (provider.type !== "openrouter") return [];
  const declared = new Set(provider.freeModels || []);
  return provider.models.filter((model) => declared.has(model) || isOpenRouterFreeModelId(model));
}

function modelAlias(model: string): string {
  return (model.split("/").at(-1) || model).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function reconcileEnabledModels(previous: string[] | undefined, models: string[]): string[] {
  if (previous === undefined) return [...models];
  const exact = new Set(previous);
  const previousAliases = new Set(previous.map(modelAlias));
  const aliasCounts = new Map<string, number>();
  for (const model of models) {
    const alias = modelAlias(model);
    aliasCounts.set(alias, (aliasCounts.get(alias) || 0) + 1);
  }
  return models.filter((model) => exact.has(model) || (aliasCounts.get(modelAlias(model)) === 1 && previousAliases.has(modelAlias(model))));
}

export function cloudflareAccountId(value?: string): string | null {
  if (!value) return null;
  const match = value.match(/accounts\/([a-f0-9]{32})/i);
  return match?.[1] || (/^[a-f0-9]{32}$/i.test(value.trim()) ? value.trim() : null);
}

export function workersAIBaseUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}

export function providerBaseUrl(provider: Provider): string | undefined {
  if (provider.type === "google") return "https://generativelanguage.googleapis.com/v1beta/openai";
  if (provider.type === "groq") return "https://api.groq.com/openai/v1";
  if (provider.type === "nvidia") return "https://integrate.api.nvidia.com/v1";
  if (provider.type === "openrouter") return "https://openrouter.ai/api/v1";
  return provider.baseUrl;
}

export function publicModelId(provider: Provider, model: string): string {
  return `${provider.name}/${model}`;
}

export function enabledProviderModels(provider: Provider): string[] {
  if (provider.enabledModels === undefined) return provider.models;
  const selected = new Set(provider.enabledModels);
  return provider.models.filter((model) => selected.has(model));
}

export function internalModelId(provider: Provider, requested: string): string | null {
  return enabledProviderModels(provider).find((model) => model === requested || publicModelId(provider, model) === requested) || null;
}

export async function discoverProviderModels(provider: Provider, env?: Env): Promise<ProviderModelCatalog> {
  if (provider.type !== "workers-ai" && !provider.apiKey) throw new Error("请先填写提供商 API Key");
  if (provider.type === "google") {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": provider.apiKey || "" } });
    const data = await response.json<Record<string, unknown>>();
    if (!response.ok) throw new Error(upstreamError(data, response.status));
    const models = Array.isArray(data.models) ? data.models as ModelRecord[] : [];
    return { models: uniqueModels(models.filter((item) => !Array.isArray(item.supportedGenerationMethods) || item.supportedGenerationMethods.includes("generateContent"))), freeModels: [] };
  }
  if (provider.type === "workers-ai") {
    if (!env) throw new Error("Workers AI 模型目录资源不可用");
    const accountId = cloudflareAccountId(provider.baseUrl);
    const apiToken = provider.apiKey;
    if (accountId && apiToken) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?task=Text%20Generation&hide_experimental=true&per_page=1000`, { headers: { authorization: `Bearer ${apiToken}`, accept: "application/json" } });
      const data = await response.json<Record<string, unknown>>();
      if (response.ok && data.success !== false && Array.isArray(data.result)) {
        const liveModels = uniqueModels(data.result);
        if (liveModels.length) return { models: liveModels, freeModels: [] };
      }
      console.warn(JSON.stringify({ event: "workers_ai_model_discovery_fallback", status: response.status }));
    }
    const response = await env.ASSETS.fetch(new Request("https://assets.internal/workers-ai-models.json"));
    if (!response.ok) throw new Error("Workers AI 模型目录尚未同步，请先运行 npm run sync:cf-models 后重新部署");
    const data = await response.json<{ models?: unknown }>();
    if (!Array.isArray(data.models)) throw new Error("Workers AI 模型目录格式无效");
    return { models: [...new Set(data.models.filter((model): model is string => typeof model === "string"))].sort(), freeModels: [] };
  }
  const baseUrl = providerBaseUrl(provider);
  if (!baseUrl) throw new Error("请先填写 Base URL");
  const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models${provider.type === "openrouter" ? "?limit=1000&output_modalities=text" : ""}`;
  const response = await fetch(modelsUrl, { headers: { authorization: `Bearer ${provider.apiKey}`, accept: "application/json" } });
  const data = await response.json<Record<string, unknown>>();
  if (!response.ok) throw new Error(upstreamError(data, response.status));
  const items = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  return { models: uniqueModels(items, true), freeModels: provider.type === "openrouter" ? openRouterFreeModels(items) : [] };
}

function upstreamError(data: Record<string, unknown>, status: number): string {
  const errorValue = data.error;
  if (typeof errorValue === "string") return errorValue;
  if (errorValue && typeof errorValue === "object" && typeof (errorValue as ModelRecord).message === "string") return (errorValue as ModelRecord).message as string;
  if (Array.isArray(data.errors) && data.errors[0] && typeof data.errors[0] === "object" && typeof (data.errors[0] as ModelRecord).message === "string") return (data.errors[0] as ModelRecord).message as string;
  return `模型发现请求失败（HTTP ${status}）`;
}

function toMessages(body: GatewayRequest): GatewayMessage[] {
  if (body.messages) return body.messages;
  if (typeof body.input === "string") return [{ role: "user", content: body.input }];
  if (Array.isArray(body.input)) return body.input as GatewayMessage[];
  return [];
}

export function sanitizeGroqMessages(messages?: GatewayMessage[]): GatewayMessage[] | undefined {
  return messages?.map((message) => {
    const clean = { ...message };
    delete clean.reasoning_content;
    return clean;
  });
}

function upstreamPayload(provider: Provider, body: GatewayRequest, endpoint: "chat/completions" | "responses"): GatewayRequest {
  const clean = { ...body };
  delete clean.provider;
  if (provider.type === "groq") clean.messages = sanitizeGroqMessages(clean.messages);
  if (body.stream && endpoint === "chat/completions" && ["google", "groq"].includes(provider.type)) {
    const current = clean.stream_options && typeof clean.stream_options === "object" ? clean.stream_options as Record<string, unknown> : {};
    clean.stream_options = { ...current, include_usage: true };
  }
  return clean;
}

function upstreamHeaders(provider: Provider): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  if (provider.apiKey) headers.set("authorization", `Bearer ${provider.apiKey}`);
  return headers;
}

export async function proxyOpenAICompatible(provider: Provider, body: GatewayRequest, endpoint: "chat/completions" | "responses"): Promise<Response> {
  const defaults = providerBaseUrl(provider);
  if (!defaults) return error("提供商缺少 Base URL", 500, "configuration_error");
  const target = `${defaults.replace(/\/$/, "")}/${endpoint}`;
  const upstream = await fetch(target, { method: "POST", headers: upstreamHeaders(provider), body: JSON.stringify(upstreamPayload(provider, body, endpoint)) });
  return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store", "x-llm-provider": provider.id } });
}

function workersResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const item = result as Record<string, unknown>;
    if (typeof item.response === "string") return item.response;
    if (typeof item.result === "string") return item.result;
  }
  return JSON.stringify(result);
}

export async function runWorkersAI(env: Env, provider: Provider, body: GatewayRequest, shape: "chat" | "responses" | "messages"): Promise<Response> {
  if (body.stream) return error("Workers AI 适配器暂不支持流式兼容转换，请设置 stream=false", 400);
  const enabledModels = enabledProviderModels(provider);
  const model = body.model || (provider.defaultModel && enabledModels.includes(provider.defaultModel) ? provider.defaultModel : enabledModels[0]);
  if (!model) return error("未指定 Workers AI 模型", 400);
  const result = await env.AI.run(model as Parameters<Ai["run"]>[0], { messages: toMessages(body), max_tokens: body.max_tokens || body.max_output_tokens });
  const text = workersResultText(result);
  const id = `gw_${crypto.randomUUID()}`;
  if (shape === "responses") return json({ id, object: "response", status: "completed", model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], output_text: text });
  if (shape === "messages") return json({ id, type: "message", role: "assistant", model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } });
  return json({ id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
}

export function messagesToChat(body: GatewayRequest): GatewayRequest {
  const messages = toMessages(body);
  const system = body.system;
  return { ...body, messages: system ? [{ role: "system", content: system }, ...messages] : messages, max_tokens: body.max_tokens, stream: body.stream };
}
