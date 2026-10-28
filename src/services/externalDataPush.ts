/**
 * Push a Species' external references and image links from a local database
 * to a remote BAP over the admin API (#595, #461). The CLI is
 * scripts/push-external-data.ts; docs/EXTERNAL_DATA_CRON.md describes the
 * off-box pipeline it ends.
 *
 * Nothing here opens a database or reads config: the script reads the local
 * rows and hands them in, and fetch and sleep are injected, so the tests drive
 * all of it.
 */
import fs from "fs";
import { parseArgs } from "node:util";
import { z } from "zod";

export const DEFAULT_URL = "https://bap.basny.org";
/** 120 requests a minute is the API's limit; two a second stays under it. */
export const DEFAULT_DELAY_MS = 600;
const MAX_RETRIES = 5;

/** Which local Species to push. */
export type Selection =
  { kind: "species"; groupId: number } | { kind: "since"; since: string } | { kind: "all" };

export type PushOptions = {
  selection: Selection;
  execute: boolean;
  dbPath?: string;
  url?: string;
  delayMs: number;
};

export class UsageError extends Error {}

export const USAGE = `Usage: npm run script scripts/push-external-data.ts -- <selection> [options]

Selection (exactly one):
  --species-id=N     one Species
  --since=<date>     Species whose local last_external_sync is at or after <date> (ISO 8601)
  --all              every Species in the local database

Options:
  --execute          write to the remote; without it, only show what would change
  --db=<path>        local database (default db/database.db)
  --url=<base>       remote (default $BASNY_API_URL, else ${DEFAULT_URL})
  --delay-ms=N       pause between requests (default ${DEFAULT_DELAY_MS})`;

/** Parse the CLI arguments; a UsageError says what is wrong. */
export function parsePushArgs(argv: string[]): PushOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        "species-id": { type: "string" },
        since: { type: "string" },
        all: { type: "boolean" },
        execute: { type: "boolean" },
        db: { type: "string" },
        url: { type: "string" },
        "delay-ms": { type: "string" },
      },
    }));
  } catch (err) {
    throw new UsageError((err as Error).message);
  }

  const given = [values["species-id"] !== undefined, values.since !== undefined, !!values.all];
  if (given.filter(Boolean).length !== 1) {
    throw new UsageError("Give exactly one of --species-id, --since or --all");
  }

  let selection: Selection;
  if (values["species-id"] !== undefined) {
    const groupId = z.coerce.number().int().positive().safeParse(values["species-id"]);
    if (!groupId.success) throw new UsageError("--species-id must be a positive integer");
    selection = { kind: "species", groupId: groupId.data };
  } else if (values.since !== undefined) {
    const since = new Date(values.since);
    if (!/^\d{4}-\d{2}-\d{2}/.test(values.since) || isNaN(since.getTime())) {
      throw new UsageError(
        "--since must be an ISO 8601 date, e.g. 2026-10-01 or 2026-10-01T06:00:00Z"
      );
    }
    selection = { kind: "since", since: since.toISOString() };
  } else {
    selection = { kind: "all" };
  }

  let delayMs = DEFAULT_DELAY_MS;
  if (values["delay-ms"] !== undefined) {
    const parsed = z.coerce.number().int().nonnegative().safeParse(values["delay-ms"]);
    if (!parsed.success) throw new UsageError("--delay-ms must be a whole number of milliseconds");
    delayMs = parsed.data;
  }

  return {
    selection,
    execute: !!values.execute,
    dbPath: values.db,
    url: values.url,
    delayMs,
  };
}

/** A local Species row, before its lists are read. */
export type LocalSpecies = {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  last_external_sync: string | null;
};

/**
 * The Species to push, ordered by group_id. `since` compares instants, so a
 * stamp written as "YYYY-MM-DD HH:MM:SS" (taken as UTC) or as ISO 8601 both count.
 */
export function selectSpecies<T extends LocalSpecies>(rows: T[], selection: Selection): T[] {
  const sinceMs = selection.kind === "since" ? Date.parse(selection.since) : 0;
  const synced = (stamp: string | null) => {
    if (!stamp) return NaN;
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(stamp)
      ? `${stamp.replace(" ", "T")}Z`
      : stamp;
    return Date.parse(iso);
  };
  return rows
    .filter((row) => {
      switch (selection.kind) {
        case "species":
          return row.group_id === selection.groupId;
        case "since":
          return synced(row.last_external_sync) >= sinceMs;
        case "all":
          return true;
      }
    })
    .sort((a, b) => a.group_id - b.group_id);
}

/** One Species' external data, as the local database or the API has it. */
export type ExternalData = {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  external_references: string[];
  image_links: string[];
};

/** How one list differs: what the push adds and removes, or that only the order changes. */
export type ListDiff = { added: string[]; removed: string[]; reordered: boolean };

export function diffList(remote: string[], local: string[]): ListDiff | null {
  if (remote.length === local.length && remote.every((v, i) => v === local[i])) return null;
  const remoteSet = new Set(remote);
  const localSet = new Set(local);
  const added = local.filter((v) => !remoteSet.has(v));
  const removed = remote.filter((v) => !localSet.has(v));
  return { added, removed, reordered: added.length === 0 && removed.length === 0 };
}

export type Plan =
  | { action: "unchanged" }
  | { action: "update"; references: ListDiff | null; images: ListDiff | null }
  | { action: "skip"; reason: string };

function sameName(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Decide what to do with one Species. The local database can be older than
 * the remote, so a group_id whose Canonical name differs is skipped rather
 * than written: it may name another Species by now. A push never empties a
 * list the remote has: that is more likely a stale local copy than a removal.
 */
export function planPush(local: ExternalData, remote: ExternalData): Plan {
  if (
    !sameName(local.canonical_genus, remote.canonical_genus) ||
    !sameName(local.canonical_species_name, remote.canonical_species_name)
  ) {
    return {
      action: "skip",
      reason: `name mismatch: local "${local.canonical_genus} ${local.canonical_species_name}", remote "${remote.canonical_genus} ${remote.canonical_species_name}"`,
    };
  }
  const references = diffList(remote.external_references, local.external_references);
  const images = diffList(remote.image_links, local.image_links);
  if (!references && !images) return { action: "unchanged" };
  const cleared = [
    references && local.external_references.length === 0 ? "external_references" : null,
    images && local.image_links.length === 0 ? "image_links" : null,
  ].filter(Boolean);
  if (cleared.length > 0) {
    return { action: "skip", reason: `would clear remote ${cleared.join(" and ")}` };
  }
  return { action: "update", references, images };
}

/**
 * The admin token: $BASNY_ADMIN_TOKEN, else the token file. A file anyone but
 * its owner can read is refused, as ssh refuses a loose private key.
 */
export function loadToken(env: NodeJS.ProcessEnv, tokenPath: string): string {
  const fromEnv = env.BASNY_ADMIN_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  let stat;
  try {
    stat = fs.statSync(tokenPath);
  } catch {
    throw new UsageError(`No admin token: set BASNY_ADMIN_TOKEN or create ${tokenPath} (mode 600)`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new UsageError(
      `${tokenPath} is readable by group or others (mode ${(stat.mode & 0o777).toString(8)}); run chmod 600 ${tokenPath}`
    );
  }
  const token = fs.readFileSync(tokenPath, "utf8").trim();
  if (!token) throw new UsageError(`${tokenPath} is empty`);
  return token;
}

const speciesResponse = z.object({
  group_id: z.number(),
  canonical_genus: z.string(),
  canonical_species_name: z.string(),
  external_references: z.array(z.string()),
  image_links: z.array(z.string()),
});

/** Stops the whole run: the token is bad, so every later request would fail too. */
export class AuthError extends Error {}

export type Fetch = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;

/** How long to wait before retrying a 429: Retry-After if usable, else doubling from 5s. */
export function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const seconds = Number(retryAfter);
  if (retryAfter !== null && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds, 120) * 1000 + 250;
  }
  return Math.min(5000 * 2 ** attempt, 120000);
}

/** The admin API's Species endpoints, paced and retried on 429. */
export class SpeciesApi {
  private last = -Infinity;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly delayMs: number,
    private readonly fetchImpl: Fetch,
    private readonly sleep: Sleep,
    private readonly now: () => number = Date.now
  ) {}

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/api/admin/species${path}`;
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.delayMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        await this.sleep(retryDelayMs(res.headers.get("retry-after"), attempt));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`${method} ${path}: ${res.status} ${await errorMessage(res)}`);
      }
      return res;
    }
  }

  /** The remote Species, or null if it has no Species with this id. */
  async get(groupId: number): Promise<ExternalData | null> {
    const res = await this.request("GET", `/${groupId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${groupId}: ${res.status} ${await errorMessage(res)}`);
    return speciesResponse.parse(await res.json());
  }

  /** Replace each list given (one left out is untouched); returns what the remote now holds. */
  async put(
    groupId: number,
    lists: Partial<Pick<ExternalData, "external_references" | "image_links">>
  ) {
    const res = await this.request("PUT", `/${groupId}/external-data`, lists);
    if (!res.ok) throw new Error(`PUT ${groupId}: ${res.status} ${await errorMessage(res)}`);
    return speciesResponse
      .pick({ group_id: true, external_references: true, image_links: true })
      .parse(await res.json());
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // not JSON
  }
  return text.slice(0, 200);
}

export type Summary = Record<"checked" | "unchanged" | "updated" | "skipped" | "failed", number>;

function describe(label: string, diff: ListDiff | null): string[] {
  if (!diff) return [];
  if (diff.reordered) return [`    ${label}: reordered`];
  return [
    ...diff.added.map((v) => `    ${label} + ${v}`),
    ...diff.removed.map((v) => `    ${label} - ${v}`),
  ];
}

/**
 * Check each local Species against the remote and, with execute, write the
 * ones that differ. Failures are counted and the run goes on; an AuthError
 * ends it.
 */
export async function pushExternalData(
  locals: AsyncIterable<ExternalData> | Iterable<ExternalData>,
  api: Pick<SpeciesApi, "get" | "put">,
  execute: boolean,
  log: (line: string) => void
): Promise<Summary> {
  const summary: Summary = { checked: 0, unchanged: 0, updated: 0, skipped: 0, failed: 0 };
  for await (const local of locals) {
    summary.checked++;
    const label = `${local.group_id} ${local.canonical_genus} ${local.canonical_species_name}`;
    try {
      const remote = await api.get(local.group_id);
      if (!remote) {
        summary.skipped++;
        log(`skip     ${label}: not on the remote`);
        continue;
      }
      const plan = planPush(local, remote);
      if (plan.action === "unchanged") {
        summary.unchanged++;
        log(`same     ${label}`);
        continue;
      }
      if (plan.action === "skip") {
        summary.skipped++;
        log(`skip     ${label}: ${plan.reason}`);
        continue;
      }
      const changes = [...describe("ref", plan.references), ...describe("img", plan.images)];
      if (!execute) {
        summary.updated++;
        log(`would    ${label}`);
        changes.forEach((line) => log(line));
        continue;
      }
      // Send only the lists that differ: the API stores image URLs without
      // their attribution and license, so rewriting an unchanged image list
      // would drop them.
      const written = await api.put(local.group_id, {
        ...(plan.references ? { external_references: local.external_references } : {}),
        ...(plan.images ? { image_links: local.image_links } : {}),
      });
      if (
        diffList(written.external_references, local.external_references) ||
        diffList(written.image_links, local.image_links)
      ) {
        throw new Error("the remote holds something other than what was sent");
      }
      summary.updated++;
      log(`updated  ${label}`);
      changes.forEach((line) => log(line));
    } catch (err) {
      if (err instanceof AuthError) throw err;
      summary.failed++;
      log(`FAILED   ${label}: ${(err as Error).message}`);
    }
  }
  return summary;
}
