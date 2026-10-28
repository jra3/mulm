import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import request from "supertest";
import { bootstrap, type BootstrapEffects, type StartupService } from "../bootstrap";

function fakeEffects(events: string[], fail?: string): BootstrapEffects {
  const service = (name: string): StartupService => ({
    start: () => {
      events.push(`start:${name}`);
      if (fail === name) throw new Error(`failed:${name}`);
    },
    stop: () => {
      events.push(`stop:${name}`);
    },
  });
  return {
    database: service("database"),
    storage: service("storage"),
    jobs: [service("job1"), service("job2")],
  };
}
for (const failure of ["database", "storage", "job2"]) {
  void test(`startup failure in ${failure} cleans up acquired resources`, async () => {
    const events: string[] = [];
    await assert.rejects(
      bootstrap({
        env: { NODE_ENV: "production" },
        port: 0,
        host: "127.0.0.1",
        effects: fakeEffects(events, failure),
      }),
      new RegExp(`failed:${failure}`)
    );
    const starts = events.filter((e) => e.startsWith("start:")).map((e) => e.slice(6));
    const stops = events.filter((e) => e.startsWith("stop:")).map((e) => e.slice(5));
    assert.deepEqual(stops, starts.reverse());
  });
}
for (const env of [
  { NODE_ENV: "test" },
  { NODE_ENV: "production", STAGING: "1" },
  { NODE_ENV: "production" },
]) {
  void test(`bootstrap jobs and idempotent teardown for ${JSON.stringify(env)}`, async () => {
    const events: string[] = [];
    const runtime = await bootstrap({
      env,
      port: 0,
      host: "127.0.0.1",
      effects: fakeEffects(events),
    });
    try {
      await request(runtime.server).get("/health").expect(200);
      assert.deepEqual(events.slice(0, 2), ["start:database", "start:storage"]);
      assert.equal(
        events.includes("start:job1"),
        env.NODE_ENV === "production" && env.STAGING !== "1"
      );
    } finally {
      await runtime.stop();
    }
    const previous = [...events];
    await runtime.stop();
    assert.deepEqual(events, previous);
    assert.equal(runtime.server.listening, false);
  });
}
void test("HTTP bind failure rejects and unwinds services", async () => {
  const busy = createServer();
  await new Promise<void>((resolve) => busy.listen(0, "127.0.0.1", resolve));
  try {
    const address = busy.address();
    assert.ok(address && typeof address !== "string");
    const events: string[] = [];
    await assert.rejects(
      bootstrap({
        env: { NODE_ENV: "test" },
        port: address.port,
        host: "127.0.0.1",
        effects: fakeEffects(events),
      }),
      /EADDRINUSE/
    );
    assert.deepEqual(events, [
      "start:database",
      "start:storage",
      "stop:storage",
      "stop:database",
    ]);
  } finally {
    await new Promise<void>((resolve) => busy.close(() => resolve()));
  }
});

void test("database readiness resolves before any service can start accepting traffic", async () => {
  const events: string[] = [];
  let ready!: () => void;
  const gate = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const effects = fakeEffects(events);
  effects.database.start = () => gate;
  const starting = bootstrap({ env: { NODE_ENV: "test" }, port: 0, host: "127.0.0.1", effects });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);
  ready();
  const runtime = await starting;
  try {
    await request(runtime.server).get("/health").expect(200);
  } finally {
    await runtime.stop();
  }
});
