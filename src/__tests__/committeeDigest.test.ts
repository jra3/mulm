import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { runCommitteeDigest, currentDigestSlot } from "@/scheduled/committeeDigest";
import { getSetting } from "../db/settings";
import { setupTestDatabase, teardownTestDatabase, type TestContext } from "./helpers/testHelpers";

/**
 * The digest job runs on every boot, and prod scales to zero, so it must run
 * at most once per daily 7:00 slot. The recorded last run is the evidence.
 */

const at = (iso: string) => new Date(iso);
const lastRun = () => getSetting("committee_digest_last_run");

void describe("Committee digest job", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase({ adminCount: 1 });
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void test("slot is today's 7:00 after 7, yesterday's before", () => {
    const after = at("2026-10-09T15:00:00");
    const before = at("2026-10-09T05:00:00");
    assert.strictEqual(currentDigestSlot(after).getTime(), at("2026-10-09T07:00:00").getTime());
    assert.strictEqual(currentDigestSlot(before).getTime(), at("2026-10-08T07:00:00").getTime());
  });

  void test("a second boot in the same slot does not run again", async () => {
    const first = at("2026-10-09T08:00:00");
    await runCommitteeDigest(first);
    assert.strictEqual(await lastRun(), first.toISOString());

    await runCommitteeDigest(at("2026-10-09T08:10:00"));
    await runCommitteeDigest(at("2026-10-10T06:59:00"));
    assert.strictEqual(await lastRun(), first.toISOString());
  });

  void test("the next slot runs again", async () => {
    await runCommitteeDigest(at("2026-10-09T08:00:00"));
    const next = at("2026-10-10T07:00:00");
    await runCommitteeDigest(next);
    assert.strictEqual(await lastRun(), next.toISOString());
  });
});
