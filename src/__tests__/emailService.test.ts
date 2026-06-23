import { describe, it } from "node:test";
import assert from "node:assert";
import { sendEmailWithRetry } from "../services/emailService";

// Instant sleep so exponential backoff doesn't add real wall-clock to the suite.
const noSleep = (): Promise<void> => Promise.resolve();

void describe("sendEmailWithRetry", () => {
  void it("returns true and sends once on first-attempt success", async () => {
    let calls = 0;
    const ok = await sendEmailWithRetry(
      () => {
        calls++;
        return Promise.resolve();
      },
      { type: "test" },
      noSleep
    );
    assert.strictEqual(ok, true);
    assert.strictEqual(calls, 1);
  });

  void it("retries transient failures and succeeds", async () => {
    let calls = 0;
    const send = (): Promise<void> => {
      calls++;
      return calls < 3 ? Promise.reject(new Error(`transient ${calls}`)) : Promise.resolve();
    };
    const ok = await sendEmailWithRetry(send, { type: "test", maxRetries: 3 }, noSleep);
    assert.strictEqual(ok, true);
    assert.strictEqual(calls, 3);
  });

  void it("waits with exponential backoff between attempts", async () => {
    const delays: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    };
    const send = (): Promise<void> => Promise.reject(new Error("always"));
    await sendEmailWithRetry(send, { type: "test", maxRetries: 3, baseDelayMs: 1000 }, sleep);
    // 3 attempts → 2 backoff sleeps: 1000 * 2^0, 1000 * 2^1
    assert.deepStrictEqual(delays, [1000, 2000]);
  });

  void it("non-critical: returns false after exhausting retries (does not throw)", async () => {
    let calls = 0;
    const send = (): Promise<void> => {
      calls++;
      return Promise.reject(new Error("nope"));
    };
    const result = await sendEmailWithRetry(send, { type: "test", maxRetries: 3 }, noSleep);
    assert.strictEqual(result, false);
    assert.strictEqual(calls, 3);
  });

  void it("critical: rethrows the last error after exhausting retries", async () => {
    const send = (): Promise<void> => Promise.reject(new Error("boom"));
    await assert.rejects(
      () => sendEmailWithRetry(send, { type: "test", critical: true, maxRetries: 2 }, noSleep),
      /boom/
    );
  });

  void it("treats a hung send as a timeout and retries", async () => {
    let calls = 0;
    const send = (): Promise<void> => {
      calls++;
      return new Promise<void>(() => {
        /* never resolves */
      });
    };
    const result = await sendEmailWithRetry(
      send,
      { type: "test", maxRetries: 2, timeoutMs: 20 },
      noSleep
    );
    assert.strictEqual(result, false);
    assert.strictEqual(calls, 2);
  });
});
