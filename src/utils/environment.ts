/**
 * Which deployment this process is. Staging is marked by STAGING=1 (set in
 * fly.staging.toml) and also runs NODE_ENV=production, so NODE_ENV alone
 * cannot tell staging from the live site.
 *
 * Each helper takes the environment as an argument so tests can pass their
 * own; callers normally leave it to default to process.env.
 *
 * No imports, so a script can load this before anything that opens the DB.
 */
export type Env = Record<string, string | undefined>;

/** Staging: a public copy of the site running on a restore of prod's data. */
export function isStaging(env: Env = process.env): boolean {
  return env.STAGING === "1";
}

/**
 * The live site at bap.basny.org. Use this for anything that must happen only
 * there (scheduled jobs, real side effects). For production-grade behaviour
 * that staging should share, such as secure cookies, check NODE_ENV instead.
 */
export function isLiveProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === "production" && !isStaging(env);
}
