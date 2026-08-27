import { describe, expect, it, vi } from "vitest";
import { clientLimitsInputError, enforceClientLimits, normalizeClientLimits } from "../src/limits";
import type { ClientKey, Env } from "../src/types";

const key = (limits: Partial<ClientKey> = {}): ClientKey => ({
  id: "key-1",
  name: "test",
  hash: "hash",
  prefix: "llmf_test",
  enabled: true,
  createdAt: "2026-08-28T00:00:00Z",
  ...limits,
});

const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

describe("client usage limits", () => {
  it("accepts only positive integer settings", () => {
    expect(normalizeClientLimits({ requestsPerMinute: 10, dailyRequestLimit: 0, monthlyTokenLimit: 1.5, maxOutputTokensPerRequest: 2048 }))
      .toEqual({ requestsPerMinute: 10, dailyRequestLimit: undefined, monthlyTokenLimit: undefined, maxOutputTokensPerRequest: 2048 });
  });

  it("reports invalid limit input instead of silently disabling protection", () => {
    expect(clientLimitsInputError({ requestsPerMinute: 1.5 })).toContain("正整数");
    expect(clientLimitsInputError({ requestsPerMinute: 1 })).toBeNull();
    expect(clientLimitsInputError({ requestsPerMinute: null as unknown as number })).toBeNull();
  });

  it("injects a maximum output size when the client omits one", async () => {
    const body: Record<string, unknown> = { model: "provider/model" };
    const response = await enforceClientLimits({} as Env, ctx, key({ maxOutputTokensPerRequest: 1024 }), body, "/v1/responses");
    expect(response).toBeNull();
    expect(body.max_output_tokens).toBe(1024);
  });

  it("rejects an output size above the key limit", async () => {
    const response = await enforceClientLimits({} as Env, ctx, key({ maxOutputTokensPerRequest: 512 }), { max_tokens: 513 }, "/v1/chat/completions");
    expect(response?.status).toBe(429);
    await expect(response?.json()).resolves.toMatchObject({ error: { type: "quota_exceeded" } });
  });

  it("atomically rejects a request when the current minute bucket is full", async () => {
    const first = vi.fn(async () => null);
    const statement = { bind: vi.fn(() => ({ first })) };
    const env = { USAGE: { prepare: vi.fn(() => statement) } } as unknown as Env;
    const response = await enforceClientLimits(env, ctx, key({ requestsPerMinute: 2 }), {}, "/v1/chat/completions", Date.UTC(2026, 7, 28, 1, 2, 30));
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("30");
  });

  it("rejects a key that reached its rolling daily request quota", async () => {
    const first = vi.fn(async () => ({ daily_requests: 5, monthly_tokens: 100 }));
    const env = { USAGE: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })) } } as unknown as Env;
    const response = await enforceClientLimits(env, ctx, key({ dailyRequestLimit: 5 }), {}, "/v1/chat/completions");
    expect(response?.status).toBe(429);
    await expect(response?.json()).resolves.toMatchObject({ error: { message: expect.stringContaining("过去 24 小时") } });
  });
});
