/**
 * One-off: recompute Steve Matassa's stored program levels after the historical
 * backfill (the DB-layer approveSubmission doesn't refresh member levels the way
 * the admin route does). Emails disabled — silent backfill.
 *
 * Run: npm run script scripts/recalc-steve-levels.ts
 */
import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname, "..", "src"));

import { init } from "@/db/conn";
import { checkAndUpdateMemberLevel, Program } from "@/levelManager";
import { logger } from "@/utils/logger";

const MEMBER_ID = 13; // Steve Matassa

async function main() {
  await init();
  for (const program of ["fish", "plant", "coral"] as Program[]) {
    const res = await checkAndUpdateMemberLevel(MEMBER_ID, program, { disableEmails: true });
    logger.info(`Level (${program}): ${JSON.stringify(res)}`);
  }
}

main().catch((err) => {
  logger.error("Recalc failed", err);
  process.exit(1);
});
