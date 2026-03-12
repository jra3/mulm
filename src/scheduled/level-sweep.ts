import { query } from "@/db/conn";
import { checkAllMemberLevels } from "@/levelManager";
import { logger } from "@/utils/logger";

/**
 * Sweep all members and recalculate their award levels.
 * Corrects any levels that are out of sync with approved submissions.
 */
export async function sweepMemberLevels(): Promise<{
  checked: number;
  updated: number;
  errors: number;
  changes: Array<{ memberId: number; name: string; program: string; from: string | undefined; to: string }>;
}> {
  logger.info("Starting member level sweep");

  const members = await query<{ id: number; display_name: string }>(
    "SELECT id, display_name FROM members ORDER BY id"
  );

  let checked = 0;
  let updated = 0;
  let errors = 0;
  const changes: Array<{ memberId: number; name: string; program: string; from: string | undefined; to: string }> = [];

  for (const member of members) {
    try {
      const results = await checkAllMemberLevels(member.id, { disableEmails: true });
      checked++;

      for (const [program, result] of Object.entries(results)) {
        if (result?.levelChanged) {
          updated++;
          changes.push({
            memberId: member.id,
            name: member.display_name,
            program,
            from: result.oldLevel,
            to: result.newLevel!,
          });
          logger.info(
            `Level updated: ${member.display_name} (${program}): ${result.oldLevel || "none"} → ${result.newLevel}`
          );
        }
      }
    } catch (err) {
      errors++;
      logger.error(`Failed to check levels for ${member.display_name} (${member.id})`, err);
    }
  }

  logger.info(
    `Level sweep complete: ${checked} members checked, ${updated} levels updated, ${errors} errors`
  );

  return { checked, updated, errors, changes };
}
