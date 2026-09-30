import { describe, test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { fetchOEmbed, getCacheStats } from "../utils/oembed";

const HOUR = 60 * 60 * 1000;

void describe("oEmbed cache", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    mock.method(globalThis, "fetch", (url: string) => {
      calls.push(url);
      return Promise.resolve(new Response(JSON.stringify({ type: "video", version: "1.0", title: "t" })));
    });
  });

  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  void test("starts no timer when imported", () => {
    assert.ok(!process.getActiveResourcesInfo().includes("Timeout"));
  });

  void test("serves a repeat lookup from the cache within the hour", async () => {
    await fetchOEmbed("youtube", "https://youtu.be/a1");
    await fetchOEmbed("youtube", "https://youtu.be/a1");

    assert.strictEqual(calls.length, 1);
  });

  void test("a write sweeps entries older than an hour", async () => {
    await fetchOEmbed("youtube", "https://youtu.be/old");
    mock.timers.tick(HOUR + 1);

    await fetchOEmbed("vimeo", "https://vimeo.com/1");

    const keys = getCacheStats().entries.map((e) => e.key);
    assert.ok(!keys.includes("youtube:https://youtu.be/old"));
    assert.ok(keys.includes("vimeo:https://vimeo.com/1"));
  });
});
