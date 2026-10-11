/**
 * Tell each member whose Submissions migration 066 reset that nothing is
 * wrong (#524).
 *
 * Points are set at the Witness now (ADR-0003). Submissions witnessed under
 * the old flow carried no points, so 066-reset-pointless-witnesses.sql sent
 * them back to awaiting a Witness when it ran at deploy. This letter tells
 * their members: nothing is wrong, the waiting period has not restarted, a
 * committee member will confirm the submission again, and the points email
 * follows. One letter per member, listing every reset Submission of theirs
 * still awaiting a Witness.
 *
 * Idempotent: a member is recorded as written to (settings key
 * `rewitness_emailed:<member id>`) only after the letter got through, so a
 * second run emails nobody twice, and a member with no address or a failed
 * send is tried again. A member whose reset Submissions have all been
 * re-witnessed meanwhile gets nothing: the points email has told them.
 *
 * It lives under src/ so `npm run build` compiles it into the image as
 * /app/src/scripts/email-rewitness.js (the runner stage copies dist/src and
 * installs no devDependencies, so tsx and scripts/ are not there). Run it
 * once on production, after the release carrying 066 is deployed and its
 * migrations have run (the app runs them at boot), as the nodejs user the
 * app runs as, so the database files stay its:
 *
 *   fly ssh console -a basny-bap -C "su nodejs -s /bin/sh -c 'cd /app && node src/scripts/email-rewitness.js'"
 *
 * Locally, against the configured database (mail is off under STAGING=1 or
 * email.disableEmails, when it only logs who would be written to):
 *
 *   npm run script src/scripts/email-rewitness.ts
 *
 * Running it twice is safe. The log names each member written to and the
 * Submissions the letter covered. Exit status 1 if any letter failed to
 * send, so a failed run is visible; rerun to retry those members.
 */
import { addAlias } from "module-alias";
import path from "path";
addAlias("@", path.join(__dirname, ".."));

import { ready, readOnlyConn, writeConn } from "@/db/conn";
import { membersAwaitingRewitnessEmail, sendRewitnessEmails } from "@/lifecycle";
import { logger } from "@/utils/logger";

async function main(): Promise<number> {
  await ready;

  const due = await membersAwaitingRewitnessEmail();
  if (due.length === 0) {
    logger.info("Nobody is owed the re-witness letter.");
    return 0;
  }
  logger.info(`${due.length} member(s) owed the re-witness letter:`);
  for (const letter of due) {
    logger.info(
      `  ${letter.member.display_name} <${letter.member.contact_email || "no email"}>: submissions ${letter.submissions
        .map((s) => s.id)
        .join(", ")}`
    );
  }

  const tally = await sendRewitnessEmails();
  logger.info(
    `Re-witness letters: emailed=${tally.emailed}, skipped=${tally.skipped}, failed=${tally.failed}`
  );
  return tally.failed > 0 ? 1 : 0;
}

main().then(
  async (code) => {
    await readOnlyConn.close();
    await writeConn.close();
    process.exit(code);
  },
  (err: unknown) => {
    logger.error("Re-witness letters failed", err);
    process.exit(1);
  }
);
