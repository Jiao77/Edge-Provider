import { describe, expect, it } from "vitest";
import { parseUsageQuery } from "../src/admin";

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
