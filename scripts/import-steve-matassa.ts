/**
 * Bulk-import Steve Matassa's historical BAP submissions.
 *
 * Source: "Steve's Points.xlsx", normalized + enriched offline into
 * scripts/steve-import.json (one record per submission to import).
 *
 * Each record runs the same path the app uses for a witnessed + approved entry:
 *   createSubmission -> confirmWitness -> recordName -> approveSubmission
 *
 * Rows already in production (the 2025 "DAVID"-witnessed batch) were excluded
 * during enrichment, so this only imports the un-entered historical backlog.
 *
 * Run:  npm run script scripts/import-steve-matassa.ts [-- --dry-run]
 */
import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname, "..", "src"));

import fs from "fs";
import { init, query, writeConn } from "@/db/conn";
import { createSubmission, approveSubmission, confirmWitness } from "@/db/submissions";
import { recordName } from "@/db/species";
import { checkAndUpdateMemberLevel, Program } from "@/levelManager";
import { FormValues } from "@/forms/submission";
import { logger } from "@/utils/logger";

const APPROVER_ID = 9; // John Allen (admin running the backfill)
const DATA_FILE = path.join(__dirname, "steve-import.json");
const DRY_RUN = process.argv.includes("--dry-run");

interface ImportRecord {
  line: number;
  form: FormValues & { species_type: "Fish" | "Invert" | "Plant" | "Coral" };
  species: {
    program_class: string;
    canonical_genus: string;
    canonical_species_name: string;
    common_name: string;
    latin_name: string;
  };
  existing_group_id: number | null;
  witness_id: number;
  approval: {
    points: number;
    article_points: number;
    first_time_species: boolean;
    cares_species: boolean;
    flowered: boolean;
    sexual_reproduction: boolean;
  };
  flags: string;
}

async function main() {
  await init();

  const { member_id, records } = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as {
    member_id: number;
    records: ImportRecord[];
  };

  // Safety: confirm member exists and we're not double-importing.
  const member = await query<{ display_name: string }>(
    `SELECT display_name FROM members WHERE id = ?`,
    [member_id]
  );
  if (member.length === 0) {
    throw new Error(`Member ${member_id} not found — restore the prod DB first.`);
  }
  const before = await query<{ n: number }>(
    `SELECT COUNT(*) n FROM submissions WHERE member_id = ?`,
    [member_id]
  );
  logger.info(
    `Importing ${records.length} submissions for ${member[0].display_name} (member ${member_id}). ` +
      `Existing submissions: ${before[0].n}. Dry run: ${DRY_RUN}`
  );

  if (DRY_RUN) {
    for (const r of records) {
      logger.info(
        `[dry] L${r.line} ${r.form.species_type}/${r.form.species_class} ` +
          `"${r.species.common_name}" (${r.species.canonical_genus} ${r.species.canonical_species_name}) ` +
          `pts=${r.approval.points} ft=${r.approval.first_time_species} ` +
          `flowered=${r.approval.flowered} witness=${r.witness_id} ` +
          `group=${r.existing_group_id ?? "NEW"}`
      );
    }
    logger.info("Dry run complete — no changes written.");
    return;
  }

  let ok = 0;
  const failures: { line: number; error: string }[] = [];

  for (const r of records) {
    try {
      // 1. Create + submit (status -> pending witness)
      const submissionId = await createSubmission(member_id, r.form, true);

      // 2. Witness (status -> confirmed)
      await confirmWitness(submissionId, r.witness_id);

      // 3. Record/lookup species names -> ids (ON CONFLICT reuses existing group)
      const speciesIds = await recordName({
        program_class: r.species.program_class,
        canonical_genus: r.species.canonical_genus,
        canonical_species_name: r.species.canonical_species_name,
        common_name: r.species.common_name,
        latin_name: r.species.latin_name,
      });

      // 4. For newly-created groups, fill species_type / base_points / cares
      //    (recordName doesn't set these). COALESCE so we never clobber an
      //    existing group's curated values.
      if (r.existing_group_id === null) {
        await writeConn.run(
          `UPDATE species_name_group
             SET species_type = COALESCE(species_type, ?),
                 base_points  = COALESCE(base_points, ?),
                 is_cares_species = CASE WHEN is_cares_species IS NULL OR is_cares_species = 0
                                         THEN ? ELSE is_cares_species END
           WHERE group_id = ?`,
          r.form.species_type,
          r.approval.points,
          r.approval.cares_species ? 1 : 0,
          speciesIds.group_id
        );
      }

      // 5. Approve (sets points, bonuses, approved_by/on)
      await approveSubmission(APPROVER_ID, submissionId, speciesIds, {
        id: submissionId,
        group_id: speciesIds.group_id,
        points: r.approval.points,
        article_points: r.approval.article_points,
        first_time_species: r.approval.first_time_species,
        cares_species: r.approval.cares_species,
        flowered: r.approval.flowered,
        sexual_reproduction: r.approval.sexual_reproduction,
      });

      ok++;
      logger.info(
        `OK L${r.line} #${submissionId} "${r.species.common_name}" ` +
          `${r.approval.points}pt -> group ${speciesIds.group_id}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ line: r.line, error: msg });
      logger.error(`FAIL L${r.line} "${r.species.common_name}": ${msg}`);
    }
  }

  // Recalculate stored member levels (approveSubmission at the DB layer doesn't,
  // unlike the admin route). Emails disabled — this is a silent backfill.
  for (const program of ["fish", "plant", "coral"] as Program[]) {
    const res = await checkAndUpdateMemberLevel(member_id, program, { disableEmails: true });
    logger.info(`Level (${program}): ${JSON.stringify(res)}`);
  }

  const after = await query<{ n: number }>(
    `SELECT COUNT(*) n FROM submissions WHERE member_id = ?`,
    [member_id]
  );
  logger.info(`Done. Imported ${ok}/${records.length}. Member now has ${after[0].n} submissions.`);
  if (failures.length) {
    logger.warn(`Failures (${failures.length}): ${JSON.stringify(failures, null, 2)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error("Import failed", err);
  process.exit(1);
});
