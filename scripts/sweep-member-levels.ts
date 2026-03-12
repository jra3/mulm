import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname, "..", "src"));

import { init } from "@/db/conn";
import { sweepMemberLevels } from "@/scheduled/level-sweep";
import { logger } from "@/utils/logger";

async function main() {
  await init();

  const result = await sweepMemberLevels();

  if (result.changes.length === 0) {
    logger.info("All member levels are up to date.");
  } else {
    logger.info(`Updated ${result.updated} levels:`);
    for (const change of result.changes) {
      logger.info(`  ${change.name}: ${change.program} ${change.from || "none"} → ${change.to}`);
    }
  }
}

main().catch((err) => {
  logger.error("Level sweep failed", err);
  process.exit(1);
});
