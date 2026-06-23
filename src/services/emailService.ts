import { logger } from "@/utils/logger";

/**
 * Centralized send wrapper for outbound email: retry with exponential backoff,
 * a per-attempt timeout, and structured logging.
 *
 * Two modes via `critical`:
 *  - non-critical (default): on final failure, log and return `false` so the
 *    calling business operation (submission, approval, etc.) still succeeds.
 *  - critical (`critical: true`): on final failure, rethrow so the caller can
 *    surface the error (e.g. password reset can't proceed without the email).
 */

export interface SendEmailOptions {
  /** Short machine label for logs, e.g. "submission_created". */
  type: string;
  /** Extra structured context for logs (recipient, ids, …). */
  context?: Record<string, unknown>;
  /** Rethrow on final failure instead of swallowing. Default false. */
  critical?: boolean;
  /** Total attempts (including the first). Default 3. */
  maxRetries?: number;
  /** Base backoff in ms; delays are base * 2^(attempt-1). Default 1000. */
  baseDelayMs?: number;
  /** Per-attempt timeout in ms. Default 30000. */
  timeoutMs?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Reject if `promise` doesn't settle within `ms` (does not cancel the work). */
async function withTimeout<T>(promise: Promise<T>, ms: number, type: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Email '${type}' timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Run `send` with retry/backoff/timeout. Returns true on success. On final
 * failure: returns false (non-critical) or throws (critical).
 *
 * `sleep` is injectable for tests so backoff doesn't add real wall-clock.
 */
export async function sendEmailWithRetry(
  send: () => Promise<unknown>,
  options: SendEmailOptions,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<boolean> {
  const { type, context, critical = false } = options;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await withTimeout(Promise.resolve(send()), timeoutMs, type);
      if (attempt > 1) {
        logger.info("Email sent after retry", { type, attempt, ...context });
      }
      return true;
    } catch (err) {
      lastError = err;
      logger.warn(`Email attempt ${attempt}/${maxRetries} failed`, {
        type,
        attempt,
        error: errMessage(err),
        ...context,
      });
      if (attempt < maxRetries) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  logger.error("Email failed after retries", {
    type,
    attempts: maxRetries,
    lastError: errMessage(lastError),
    ...context,
  });

  if (critical) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`Email '${type}' failed after ${maxRetries} attempts: ${errMessage(lastError)}`);
  }
  return false;
}
