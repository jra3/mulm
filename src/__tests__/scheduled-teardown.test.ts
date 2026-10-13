import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { setupTestDatabase } from "./testDbHelper.helper";
import { logger } from "../utils/logger";
import { startScheduledCleanup, stopScheduledCleanup } from "../scheduled/cleanup";
import {
  startFinalSubmissionReminders,
  stopFinalSubmissionReminders,
} from "../scheduled/finalSubmissionReminder";
import { startCommitteeDigest, stopCommitteeDigest } from "../scheduled/committeeDigest";

for (const [name, start, stop] of [
  ["cleanup", startScheduledCleanup, stopScheduledCleanup],
  ["reminders", startFinalSubmissionReminders, stopFinalSubmissionReminders],
  ["digest", startCommitteeDigest, stopCommitteeDigest],
] as const) {
  void test(`${name} teardown awaits startup work and cancels the first timeout`, async (t) => {
    const fixture = await setupTestDatabase();
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
}
