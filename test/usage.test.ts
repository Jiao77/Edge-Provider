import { describe, expect, it } from "vitest";
import { estimateTokens, extractTokenUsage, instrumentUsageResponse } from "../src/usage";
import type { UsageEvent } from "../src/types";

describe("usage extraction", () => {
  it("reads OpenAI-compatible token fields", () => {
    expect(extractTokenUsage({ usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } })).toEqual({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });
  });

  it("reads Responses and Anthropic-style token fields", () => {
    expect(extractTokenUsage({ usage: { input_tokens: 7, output_tokens: 5 } })).toEqual({ inputTokens: 7, outputTokens: 5, totalTokens: 12 });
  });

  it("does not invent counts when the upstream omits usage", () => {
    expect(extractTokenUsage({ choices: [] })).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
  });

  it("reads usage from a streamed Responses completion event", () => {
    expect(extractTokenUsage({ type: "response.completed", response: { usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } } })).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });
  });
});

describe("token estimation fallback", () => {
  it("counts CJK more densely than ASCII text", () => {
    expect(estimateTokens("你好世界")).toBe(4);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("stream instrumentation", () => {
  it("forwards SSE bytes unchanged and records final exact usage", async () => {
    const encoder = new TextEncoder();
    const source = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\ndata: [DONE]\n\n';
    const writes: unknown[][] = [];
    const env = { USAGE: { prepare: () => ({ bind: (...values: unknown[]) => ({ run: async () => { writes.push(values); } }) }) } };
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } as ExecutionContext;
    const event: UsageEvent = { clientKeyId: "key", endpoint: "/v1/chat/completions", providerId: "provider", providerName: "Groq", providerType: "groq", model: "model", status: 200, startedAt: Date.now(), streaming: true };
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(source)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
    const monitored = instrumentUsageResponse(env, ctx, response, event, { stream: true, messages: [{ role: "user", content: "Hello" }] });

    expect(await monitored.text()).toBe(source);
    await Promise.all(pending);
    expect(writes).toHaveLength(1);
    expect(writes[0][10]).toBe(5);
    expect(writes[0][11]).toBe(3);
    expect(writes[0][12]).toBe(8);
    expect(writes[0][17]).toBe("exact");
    expect(writes[0][18]).toBe(1);
  });
});
