import { describe, expect, it } from "vitest";
import { enabledProviderModels, internalModelId, providerBaseUrl, publicModelId, sanitizeGroqMessages, uniqueModels } from "../src/providers";
import type { Provider } from "../src/types";

describe("model catalog parsing", () => {
  it("uses the callable Cloudflare model name instead of the catalog UUID", () => {
    expect(uniqueModels([{ id: "f9f2250b-1048-4a52-9910-d0bf976616a1", name: "@cf/openai/gpt-oss-120b" }])).toEqual(["@cf/openai/gpt-oss-120b"]);
  });

  it("keeps OpenAI-compatible model IDs when no name is present", () => {
    expect(uniqueModels([{ id: "llama-3.3-70b-versatile" }])).toEqual(["llama-3.3-70b-versatile"]);
  });
});

describe("provider defaults", () => {
  it("uses NVIDIA's hosted NIM OpenAI-compatible endpoint", () => {
    const provider: Provider = { id: "nvidia", name: "NVIDIA", type: "nvidia", enabled: true, models: [] };
    expect(providerBaseUrl(provider)).toBe("https://integrate.api.nvidia.com/v1");
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
