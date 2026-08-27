import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverProviderModels, enabledProviderModels, inferredProviderFreeModels, internalModelId, messagesToChat, normalizeProviderFreeModels, openRouterFreeModels, providerBaseUrl, publicModelId, reconcileEnabledModels, sanitizeGroqMessages, siliconFlowFreeModels, uniqueModels, zhipuFreeModels } from "../src/providers";
import type { Provider } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

describe("model catalog parsing", () => {
  it("uses the callable Cloudflare model name instead of the catalog UUID", () => {
    expect(uniqueModels([{ id: "f9f2250b-1048-4a52-9910-d0bf976616a1", name: "@cf/openai/gpt-oss-120b" }])).toEqual(["@cf/openai/gpt-oss-120b"]);
  });

  it("keeps OpenAI-compatible model IDs when no name is present", () => {
    expect(uniqueModels([{ id: "llama-3.3-70b-versatile" }])).toEqual(["llama-3.3-70b-versatile"]);
  });

  it("uses Groq's callable id instead of its display name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "openai/gpt-oss-20b", name: "GPT OSS 20B" }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const provider: Provider = { id: "groq", name: "Groq", type: "groq", enabled: true, apiKey: "test-key", models: [] };

    await expect(discoverProviderModels(provider)).resolves.toEqual({ models: ["openai/gpt-oss-20b"], freeModels: [] });
  });

  it("migrates a uniquely matching legacy display-name selection", () => {
    expect(reconcileEnabledModels(["GPT OSS 20B"], ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]))
      .toEqual(["openai/gpt-oss-20b"]);
  });

  it("does not guess when multiple ids share the same display-name alias", () => {
    expect(reconcileEnabledModels(["Model X"], ["vendor-a/model-x", "vendor-b/model-x"]))
      .toEqual([]);
  });
});

describe("provider defaults", () => {
  it("uses NVIDIA's hosted NIM OpenAI-compatible endpoint", () => {
    const provider: Provider = { id: "nvidia", name: "NVIDIA", type: "nvidia", enabled: true, models: [] };
    expect(providerBaseUrl(provider)).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("uses OpenRouter's OpenAI-compatible endpoint", () => {
    const provider: Provider = { id: "openrouter", name: "OpenRouter", type: "openrouter", enabled: true, models: [] };
    expect(providerBaseUrl(provider)).toBe("https://openrouter.ai/api/v1");
  });

  it.each([
    ["siliconflow", "https://api.siliconflow.cn/v1"],
    ["zhipu", "https://open.bigmodel.cn/api/paas/v4"],
    ["mistral", "https://api.mistral.ai/v1"],
  ] as const)("uses %s's built-in OpenAI-compatible endpoint", (type, expected) => {
    const provider: Provider = { id: type, name: type, type, enabled: true, models: [] };
    expect(providerBaseUrl(provider)).toBe(expected);
  });

  it.each([
    ["siliconflow", "https://api.siliconflow.cn/v1/models"],
    ["zhipu", "https://open.bigmodel.cn/api/paas/v4/models"],
    ["mistral", "https://api.mistral.ai/v1/models"],
  ] as const)("discovers %s models from its account catalog", async (type, expectedUrl) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "available-model" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider: Provider = { id: type, name: type, type, enabled: true, apiKey: "test-key", models: [] };

    await expect(discoverProviderModels(provider)).resolves.toEqual({
      models: ["available-model"],
      freeModels: type === "mistral" ? ["available-model"] : [],
    });
    expect(fetchMock).toHaveBeenCalledWith(expectedUrl, expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer test-key" }),
    }));
  });

});

describe("OpenRouter model pricing", () => {
  it("classifies zero-price and official free-variant models", () => {
    expect(openRouterFreeModels([
      { id: "vendor/zero-priced", pricing: { prompt: "0", completion: "0", request: "0" } },
      { id: "vendor/free-variant:free", pricing: { prompt: "0.1", completion: "0.2" } },
      { id: "openrouter/free", pricing: {} },
      { id: "vendor/paid", pricing: { prompt: "0", completion: "0.2", request: "0" } },
    ])).toEqual(["openrouter/free", "vendor/free-variant:free", "vendor/zero-priced"]);
  });

  it("keeps only catalog models and infers official free suffixes for manual entries", () => {
    expect(normalizeProviderFreeModels({
      type: "openrouter",
      models: ["vendor/free:free", "vendor/zero-priced", "vendor/paid"],
      freeModels: ["vendor/zero-priced", "missing/model"],
    })).toEqual(["vendor/free:free", "vendor/zero-priced"]);
  });

  it("discovers callable ids and returns free-model metadata", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: "vendor/free", name: "Free", pricing: { prompt: "0", completion: "0", request: "0" } },
        { id: "vendor/paid", name: "Paid", pricing: { prompt: "0.000001", completion: "0.000002", request: "0" } },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider: Provider = { id: "openrouter", name: "OpenRouter", type: "openrouter", enabled: true, apiKey: "test-key", models: [] };

    await expect(discoverProviderModels(provider)).resolves.toEqual({ models: ["vendor/free", "vendor/paid"], freeModels: ["vendor/free"] });
    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models?limit=1000&output_modalities=text", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer test-key" }) }));
  });
});

describe("built-in free model catalogs", () => {
  it("marks SiliconFlow's documented free models and unprefixed Pro counterparts", () => {
    expect(siliconFlowFreeModels([
      "Qwen/Qwen3-8B",
      "vendor/model-a",
      "Pro/vendor/model-a",
      "paid/model-b",
    ])).toEqual(["Qwen/Qwen3-8B", "vendor/model-a"]);
  });

  it("matches only Zhipu models explicitly documented as free", () => {
    expect(zhipuFreeModels([
      "glm-4.7-flash",
      "glm-4.7-flashx",
      "glm-4.6v-flash",
      "glm-5.3-flash",
    ])).toEqual(["glm-4.7-flash", "glm-4.6v-flash"]);
  });

  it("treats Mistral's account-visible catalog as free-tier candidates", () => {
    expect(inferredProviderFreeModels("mistral", ["mistral-small-latest", "codestral-latest"]))
      .toEqual(["mistral-small-latest", "codestral-latest"]);
  });

  it("preserves discovered free metadata when provider settings are saved", () => {
    expect(normalizeProviderFreeModels({
      type: "siliconflow",
      models: ["known/free", "other/model"],
      freeModels: ["known/free"],
    })).toEqual(["known/free"]);
  });
});

describe("Groq request compatibility", () => {
  it("removes unsupported reasoning_content while preserving supported message fields", () => {
    const messages = [{
      role: "assistant",
      content: "answer",
      reasoning_content: "private reasoning residue",
      reasoning: "supported parsed reasoning",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }]
    }];

    const sanitized = sanitizeGroqMessages(messages);

    expect(sanitized?.[0]).not.toHaveProperty("reasoning_content");
    expect(sanitized?.[0]).toMatchObject({
      role: "assistant",
      content: "answer",
      reasoning: "supported parsed reasoning",
      tool_calls: messages[0].tool_calls
    });
    expect(messages[0]).toHaveProperty("reasoning_content", "private reasoning residue");
  });
});

describe("Messages request compatibility", () => {
  it("converts Anthropic tool calls and tool results to Chat Completions messages", () => {
    const converted = messagesToChat({
      model: "model",
      messages: [
        { role: "assistant", content: [{ type: "text", text: "Checking" }, { type: "tool_use", id: "call_1", name: "lookup", input: { q: "edge" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "found" }] },
      ],
    });
    expect(converted.messages).toEqual([
      { role: "assistant", content: "Checking", tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"edge"}' } }] },
      { role: "tool", tool_call_id: "call_1", content: "found" },
    ]);
  });
});

describe("public model IDs", () => {
  const workersProvider: Provider = { id: "fabecdd7-7c4c-40be-aaf6-8dea11a5e5ae", name: "我的 Cloudflare", type: "workers-ai", enabled: true, models: [] };

  it("uses the administrator-defined provider name instead of its UUID", () => {
    expect(publicModelId(workersProvider, "@cf/openai/gpt-oss-120b")).toBe("我的 Cloudflare/@cf/openai/gpt-oss-120b");
  });

  it("restores the Workers AI prefix before inference", () => {
    const provider = { ...workersProvider, models: ["@cf/openai/gpt-oss-120b"] };
    expect(internalModelId(provider, "我的 Cloudflare/@cf/openai/gpt-oss-120b")).toBe("@cf/openai/gpt-oss-120b");
  });

  it("keeps every legacy model enabled until a selection is saved", () => {
    const provider = { ...workersProvider, models: ["model-a", "model-b"] };
    expect(enabledProviderModels(provider)).toEqual(["model-a", "model-b"]);
  });

  it("only routes explicitly selected models", () => {
    const provider = { ...workersProvider, models: ["model-a", "model-b"], enabledModels: ["model-b"] };
    expect(enabledProviderModels(provider)).toEqual(["model-b"]);
    expect(internalModelId(provider, "model-a")).toBeNull();
    expect(internalModelId(provider, "我的 Cloudflare/model-b")).toBe("model-b");
  });
});
