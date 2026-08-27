import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

describe("provider dialog", () => {
  it("uses a non-submitting close button so required fields do not block dismissal", () => {
    expect(html).toMatch(/id="providerDialog"[\s\S]*?<button class="icon-button" type="button" data-close aria-label="关闭">/);
  });

  it("offers editing and preserves an existing API key when the field is blank", () => {
    expect(script).toContain('data-edit-provider="${p.id}"');
    expect(script).toContain('"已保存；留空则保持不变"');
    expect(script).toContain('method: providerId ? "PUT" : "POST"');
  });

  it("enables free-model grouping for all providers that expose a free tier", () => {
    expect(script).toContain('["openrouter", "siliconflow", "zhipu", "mistral"].includes(type)');
  });
});
