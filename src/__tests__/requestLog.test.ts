import { describe, test } from "node:test";
import assert from "node:assert";
import { formatRequestLine } from "@/middleware/requestLog";

void describe("formatRequestLine", () => {
  void test("puts method, path, status, timing, ip, user agent and referer on one line", () => {
    const line = formatRequestLine({
      method: "GET",
      path: "/species/42",
      status: 200,
      ms: 12,
      ip: "203.0.113.7",
      userAgent: 'Mozilla/5.0 (compatible; "Bot")',
      referer: "https://basny.org/",
    });
    assert.strictEqual(
      line,
      'HTTP GET /species/42 200 12ms ip=203.0.113.7 ua="Mozilla/5.0 (compatible; \\"Bot\\")" ref="https://basny.org/"'
    );
  });

  void test("marks missing headers with a dash", () => {
    const line = formatRequestLine({
      method: "HEAD",
      path: "/",
      status: 301,
      ms: 0,
      ip: undefined,
      userAgent: undefined,
      referer: undefined,
    });
    assert.strictEqual(line, 'HTTP HEAD / 301 0ms ip=- ua="-" ref="-"');
  });
});
