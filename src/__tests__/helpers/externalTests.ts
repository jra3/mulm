/**
 * The gate on tests that call somebody else's server.
 *
 * These suites make real API calls, so they belong to a cadence, not to every
 * push: a Wikipedia outage is not a reason to redden a pull request. They run
 * only when `RUN_EXTERNAL_TESTS` is set — nightly in CI, and by hand with
 * `npm run test:external`.
 *
 * The gate used to be `process.env.CI`, which read "skip in CI" and so skipped
 * in the nightly job built to run them: the one place they were meant to
 * execute was the one place they could not. An explicit opt-in says what is
 * actually meant, and keeps a plain `npm test` quiet everywhere.
 */
export function skipUnlessExternalTestsEnabled(
  name: string,
  enabledInConfig: boolean | undefined
): string | undefined {
  if (!enabledInConfig) {
    return `${name} integration is disabled in config`;
  }
  if (!process.env.RUN_EXTERNAL_TESTS) {
    return `Set RUN_EXTERNAL_TESTS=1 to run ${name} tests against the live API`;
  }
  return undefined;
}
