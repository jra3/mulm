/**
 * Push external references and image links from a local database to the BAP
 * over the admin API (#595, #461), so Wikipedia/GBIF enrichment can run off
 * the prod box: refresh a local copy of prod, run the sync scripts against it,
 * then push what changed. See docs/EXTERNAL_DATA_CRON.md for the pipeline and
 * docs/ADMIN_API.md for the token.
 *
 * For each selected Species it GETs the remote Species and compares both lists
 * with the local ones. Only a Species that differs is written: a PUT of the
 * lists that differ, each replacing the remote list of that kind. It skips, and reports, a Species
 * the remote doesn't have, one whose Canonical name differs (the local copy is
 * stale), and a push that would empty a list the remote has.
 *
 * Usage:
 *   npm run script scripts/push-external-data.ts -- --species-id=61             # dry-run, one Species
 *   npm run script scripts/push-external-data.ts -- --since=2026-10-01           # dry-run, synced since
 *   npm run script scripts/push-external-data.ts -- --since=2026-10-01 --execute # write
 *   npm run script scripts/push-external-data.ts -- --all --db=/path/to/copy.db
 *   npm run script scripts/push-external-data.ts -- --species-id=61 --url=https://basny-bap-staging.fly.dev
 *
 * The remote is --url, else $BASNY_API_URL, else https://bap.basny.org. The
 * token is $BASNY_ADMIN_TOKEN, else ~/.config/basny/admin-token (mode 600).
 * The token is never printed.
 *
 * Exit status: 0 when nothing failed, 1 when any Species failed, 2 on bad
 * usage, a missing token or a rejected one.
 */

import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { homedir } from "os";
import { join } from "path";
import {
  AuthError,
  DEFAULT_URL,
  type ExternalData,
  type LocalSpecies,
  loadToken,
  parsePushArgs,
  pushExternalData,
  selectSpecies,
  SpeciesApi,
  USAGE,
  UsageError,
} from "../src/services/externalDataPush";

async function main(): Promise<number> {
  let options;
  let token;
  try {
    options = parsePushArgs(process.argv.slice(2));
    token = loadToken(process.env, join(homedir(), ".config", "basny", "admin-token"));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`${err.message}\n\n${USAGE}`);
    return 2;
  }

  const dbPath = options.dbPath ?? join(__dirname, "../db/database.db");
  const url = options.url ?? process.env.BASNY_API_URL ?? DEFAULT_URL;
  console.log(`Local:  ${dbPath}`);
  console.log(`Remote: ${url}`);
  console.log(`Mode:   ${options.execute ? "EXECUTE" : "dry-run (add --execute to write)"}\n`);

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  });
  try {
    const rows = selectSpecies(
      await db.all<LocalSpecies[]>(
        "SELECT group_id, canonical_genus, canonical_species_name, last_external_sync FROM species_name_group"
      ),
      options.selection
    );
    if (options.selection.kind === "species" && rows.length === 0) {
      console.error(`Species ${options.selection.groupId} is not in the local database`);
      return 1;
    }

    async function* locals(): AsyncGenerator<ExternalData> {
      for (const row of rows) {
        const refs = await db.all<{ reference_url: string }[]>(
          "SELECT reference_url FROM species_external_references WHERE group_id = ? ORDER BY display_order, id",
          [row.group_id]
        );
        const images = await db.all<{ image_url: string }[]>(
          "SELECT image_url FROM species_images WHERE group_id = ? ORDER BY display_order, id",
          [row.group_id]
        );
        yield {
          group_id: row.group_id,
          canonical_genus: row.canonical_genus,
          canonical_species_name: row.canonical_species_name,
          external_references: refs.map((r) => r.reference_url),
          image_links: images.map((i) => i.image_url),
        };
      }
    }

    const api = new SpeciesApi(
      url,
      token,
      options.delayMs,
      fetch,
      (ms) => new Promise((r) => setTimeout(r, ms))
    );
    const summary = await pushExternalData(locals(), api, options.execute, (line) =>
      console.log(line)
    );

    console.log(
      `\nchecked ${summary.checked}, unchanged ${summary.unchanged}, ` +
        `${options.execute ? "updated" : "would update"} ${summary.updated}, ` +
        `skipped ${summary.skipped}, failed ${summary.failed}`
    );
    return summary.failed > 0 ? 1 : 0;
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    console.error(`\nToken rejected, stopping: ${err.message}`);
    return 2;
  } finally {
    await db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Error:", err);
    process.exit(1);
  }
);
