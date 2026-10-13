import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createTestDatabase } from "./helpers/database";
import { logger } from "../utils/logger";
import { startScheduledCleanup, stopScheduledCleanup } from "../scheduled/cleanup";
import {
  startFinalSubmissionReminders,
  stopFinalSubmissionReminders,
} from "../scheduled/finalSubmissionReminder";
import { startCommitteeDigest, stopCommitteeDigest } from "../scheduled/committeeDigest";

for (const [name, start, stop, hour] of [
  ["cleanup", startScheduledCleanup, stopScheduledCleanup, 3],
  ["reminders", startFinalSubmissionReminders, stopFinalSubmissionReminders, 4],
  ["digest", startCommitteeDigest, stopCommitteeDigest, 7],
] as const) {
  void test(`${name} teardown awaits startup work and cancels the first timeout`, async (t) => {
    const fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    const info = t.mock.method(logger, "info", () => {});
    const error = t.mock.method(logger, "error", () => {});
    t.mock.timers.enable({
      apis: ["Date", "setTimeout", "setInterval"],
      now: new Date("2026-01-01T00:00:00Z"),
    });
    try {
      start();
      await stop();
      const messages = info.mock.callCount();
      await fixture.cleanup();
      t.mock.timers.tick(3 * 24 * 60 * 60 * 1000);
      await setImmediate();
      assert.equal(info.mock.callCount(), messages);
      assert.equal(error.mock.callCount(), 0);
      await stop();
    } finally {
      t.mock.timers.reset();
      await stop();
    }
  });

  void test(`${name} skips an overlapping daily run and waits for startup work before teardown`, async (t) => {
    const fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    const errors = t.mock.method(logger, "error", () => {});
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const prepare = fixture.db.prepare.bind(fixture.db);
    const preparing = t.mock.method(
      fixture.db,
      "prepare",
      async (...args: Parameters<typeof prepare>) => {
        entered();
        await blocked;
        return prepare(...args);
      }
    );
    t.mock.timers.enable({
      apis: ["Date", "setTimeout", "setInterval"],
      now: new Date(2026, 0, 1, hour - 1, 59, 59),
    });
    try {
      start();
      await started;
      t.mock.timers.tick(1000);
      await setImmediate();
      assert.equal(preparing.mock.callCount(), 1, "daily slot must not overlap startup work");
      let stopped = false;
      const stopping = stop().then(() => {
        stopped = true;
      });
      await setImmediate();
      assert.equal(stopped, false, "stop must wait for the blocked startup run");
      release();
      await stopping;
      const calls = preparing.mock.callCount();
      await fixture.cleanup();
      t.mock.timers.tick(3 * 24 * 60 * 60 * 1000);
      await setImmediate();
      assert.equal(preparing.mock.callCount(), calls, "no work remains after teardown");
      assert.equal(errors.mock.callCount(), 0);
    } finally {
      release();
      t.mock.timers.reset();
      await stop();
      await fixture.cleanup();
    }
  });
}
