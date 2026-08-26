import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverProviderModels, enabledProviderModels, internalModelId, normalizeProviderFreeModels, openRouterFreeModels, providerBaseUrl, publicModelId, reconcileEnabledModels, sanitizeGroqMessages, uniqueModels } from "../src/providers";
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
