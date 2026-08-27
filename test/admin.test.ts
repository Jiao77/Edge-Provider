import { describe, expect, it, vi } from "vitest";
import { handleAdmin, parseUsageQuery } from "../src/admin";
import type { ClientKey, Env, Provider } from "../src/types";

describe("usage pagination query", () => {
  it("accepts the supported page sizes and page numbers", () => {
    expect(parseUsageQuery("https://example.test/admin/usage?days=7&modelPage=2&modelPageSize=25&logPage=3&logPageSize=50")).toEqual({
      days: 7,
      modelPage: 2,
      modelPageSize: 25,
      logPage: 3,
      logPageSize: 50,
    });
  });

  it("bounds the date range and rejects unsupported pagination values", () => {
    expect(parseUsageQuery("https://example.test/admin/usage?days=365&modelPage=0&modelPageSize=100&logPage=-2&logPageSize=abc")).toEqual({
      days: 90,
      modelPage: 1,
      modelPageSize: 10,
      logPage: 1,
      logPageSize: 10,
    });
  });
});

describe("provider deletion", () => {
  it("removes the provider configuration before deleting its usage history", async () => {
    const provider: Provider = { id: "provider-old", name: "Old Provider", type: "groq", enabled: true, models: [] };
    const put = vi.fn(async (_key: string, _value: string) => undefined);
    const run = vi.fn(async () => ({ success: true }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const env = {
      ADMIN_TOKEN: "admin-token-for-test",
      CONFIG: {
        get: vi.fn(async () => [provider]),
        put,
      },
      USAGE: { prepare },
    } as unknown as Env;

    const response = await handleAdmin(new Request("https://example.test/admin/providers/provider-old", {
      method: "DELETE",
      headers: { authorization: "Bearer admin-token-for-test" },
    }), env, "/admin/providers/provider-old");

    expect(response.status).toBe(204);
    expect(JSON.parse(String(put.mock.calls[0][1]))).toEqual([]);
    expect(prepare).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM usage_events WHERE provider_id = \?/));
    expect(bind).toHaveBeenCalledWith("provider-old");
    expect(run).toHaveBeenCalledOnce();
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
  });
});

describe("client key controls", () => {
  it("updates limits and enabled state without exposing or replacing the hash", async () => {
    const clientKey: ClientKey = { id: "key-1", name: "Laptop", hash: "secret-hash", prefix: "llmf_test", enabled: true, createdAt: "2026-08-28T00:00:00Z", requestsPerMinute: 10 };
    const put = vi.fn(async (_key: string, _value: string) => undefined);
    const env = {
      ADMIN_TOKEN: "admin-token-for-test",
      CONFIG: { get: vi.fn(async () => [clientKey]), put },
    } as unknown as Env;
    const response = await handleAdmin(new Request("https://example.test/admin/keys/key-1", {
      method: "PUT",
      headers: { authorization: "Bearer admin-token-for-test", "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, requestsPerMinute: 5, dailyRequestLimit: 100 }),
    }), env, "/admin/keys/key-1");

    expect(response.status).toBe(200);
    const saved = JSON.parse(String(put.mock.calls[0][1]));
    expect(saved[0]).toMatchObject({ hash: "secret-hash", enabled: false, requestsPerMinute: 5, dailyRequestLimit: 100 });
    await expect(response.json()).resolves.not.toHaveProperty("hash");
  });
});
