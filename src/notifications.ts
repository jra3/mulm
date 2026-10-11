import nodemailer from "nodemailer";
import config from "@/config.json";
import { type Submission } from "./db/submissions";
import { MemberRecord } from "./db/members";
import * as pug from "pug";
import { logger } from "@/utils/logger";
import { type Env, isStaging } from "@/utils/environment";
import { sendEmailWithRetry } from "./services/emailService";
import {
  bonusBreakdown,
  bonusesStillPossible,
  pointsBreakdown,
  programOfSpeciesType,
  type BonusField,
  type BonusLine,
} from "./points";
import { programMetadata } from "./programs";
import { formatLongDate } from "./utils/dateFormat";
import type { RewitnessPending } from "./lifecycle/rewitness";
import type { WitnessedFacts } from "./lifecycle/consequences";
import { waitingPeriodEndsOn } from "./lifecycle/state";

const DEBUG_EMAIL = process.env.DEBUG_EMAIL;
const fromEmail = `BASNY Breeder Awards ${config.email.fromEmail}`;

/**
 * Whether outgoing mail is off. Staging holds a copy of every real member's
 * address, so STAGING=1 turns mail off whatever its config says.
 */
export function emailsDisabled(
  env: Env,
  emailConfig: { disableEmails?: boolean }
): boolean {
  return (
    env.NODE_ENV === "test" || // Disable emails in test mode
    isStaging(env) ||
    emailConfig.disableEmails === true // Config killswitch for local development
  );
}

const EMAILS_DISABLED = emailsDisabled(process.env, config.email);

const transporter = nodemailer.createTransport({
  host: config.email.smtp.host,
  port: config.email.smtp.port,
  secure: config.email.smtp.secure,
  auth: {
    user: config.email.fromEmail,
    pass: config.email.smtp.password,
  },
});

const renderOnSubmission = pug.compileFile("src/views/email/onSubmission.pug");
export async function onSubmissionSend(sub: Submission, member: MemberRecord) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent submission confirmation", { submissionId: sub.id });
    return;
  }

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        subject: `Submission Confirmation - ${sub.species_common_name}`,
        html: renderOnSubmission({
          domain: config.server.domain,
          submission: sub,
          member,
        }),
      }),
    { type: "submission_created", context: { submissionId: sub.id, recipient: member.contact_email } }
  );
}

export async function sendChangesRequest(sub: Submission, contact_email: string, content: string) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent changes request", { submissionId: sub.id });
    return;
  }

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: contact_email,
        bcc: DEBUG_EMAIL,
        subject: `Changes Requested - ${sub.species_common_name}`,
        text: content,
      }),
    { type: "changes_request", context: { submissionId: sub.id, recipient: contact_email } }
  );
}

const renderOnChangesRequested = pug.compileFile("src/views/email/onChangesRequested.pug");
export async function onChangesRequested(
  submission: Submission,
  member: MemberRecord,
  reason: string
) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent changes requested", { submissionId: submission.id });
    return;
  }

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        subject: `Changes Requested - ${submission.species_common_name}`,
        html: renderOnChangesRequested({
          domain: config.server.domain,
          submission,
          member,
          reason,
          programContactEmail: config.email.adminsEmail,
        }),
      }),
    { type: "changes_requested", context: { submissionId: submission.id, recipient: member.contact_email } }
  );
}

const renderOnApprove = pug.compileFile("src/views/email/onApproval.pug");
export async function onSubmissionApprove(sub: Submission, member: MemberRecord) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent submission approval", { submissionId: sub.id });
    return;
  }

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        subject: `Submission Approved! - ${sub.species_common_name}`,
        html: renderOnApprove({
          domain: config.server.domain,
          submission: sub,
          member,
          bonusLines: bonusBreakdown(sub),
        }),
      }),
    { type: "submission_approved", context: { submissionId: sub.id, recipient: member.contact_email } }
  );
}

const renderWaitingPeriodComplete = pug.compileFile("src/views/email/onWaitingPeriodComplete.pug");

/** What the member brings to the meeting, by Species type. */
function offspringOf(sub: Pick<Submission, "species_type">): string {
  switch (sub.species_type) {
    case "Plant":
      return "plants";
    case "Coral":
      return "corals";
    default:
      return "fry";
  }
}
/**
 * Reminder sent when a submission's waiting period elapses: bring the fish,
 * plants or coral to a meeting, where a committee member approves it. There is
 * nothing to click; the Submission is already in the approval queue.
 * Non-critical (the daily job logs and continues on failure; it will not be
 * marked reminded, so it retries next run).
 */
export async function onWaitingPeriodComplete(
  sub: Submission,
  member: Pick<MemberRecord, "contact_email" | "display_name">
): Promise<boolean> {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent waiting period complete reminder", {
      submissionId: sub.id,
    });
    return true;
  }

  return sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        subject: `Bring ${sub.species_common_name} to the next meeting`,
        html: renderWaitingPeriodComplete({
          domain: config.server.domain,
          submission: sub,
          member,
          offspring: offspringOf(sub),
        }),
      }),
    {
      type: "waiting_period_complete",
      context: { submissionId: sub.id, recipient: member.contact_email },
    }
  );
}

/** One reset Submission as the letter prints it: its days already formatted, in UTC like every date the Portal prints. */
export type RewitnessLetterRow = Pick<RewitnessPending, "id" | "species_common_name" | "species_latin_name" | "species_type"> & {
  reproducedOn: string;
  witnessedBy: string | null;
  witnessedOn: string | null;
  readyOn: string;
  waitingPeriodOver: boolean;
};

/** The letter's rows from the lifecycle's facts; the demo page builds its preview with it too. */
export function rewitnessLetterRows(submissions: RewitnessPending[]): RewitnessLetterRow[] {
  return submissions.map((s) => ({
    id: s.id,
    species_common_name: s.species_common_name,
    species_latin_name: s.species_latin_name,
    species_type: s.species_type,
    reproducedOn: formatLongDate(s.reproduction_date),
    witnessedBy: s.originalWitness?.name ?? null,
    witnessedOn: s.originalWitness ? formatLongDate(s.originalWitness.date) : null,
    readyOn: formatLongDate(s.readyOn),
    waitingPeriodOver: s.waitingPeriodOver,
  }));
}

const renderRewitnessPending = pug.compileFile("src/views/email/onRewitnessPending.pug");
/**
 * One-off letter after the reset of in-flight Submissions (#524): the
 * member's witnessed Submissions carried no points, so they await a Witness
 * again. Nothing is wrong, the waiting period has not restarted, a committee
 * member will confirm them again, and the points email follows. Returns
 * whether it was delivered, so the script records only the letters that got
 * through.
 */
export async function onRewitnessPending(member: MemberRecord, submissions: RewitnessPending[]): Promise<boolean> {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent re-witness letter", {
      memberId: member.id,
      submissionIds: submissions.map((s) => s.id),
    });
    return true;
  }

  const plural = submissions.length !== 1;
  return sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        replyTo: config.email.adminsEmail,
        subject: plural
          ? `Your ${submissions.length} submissions will be witnessed again`
          : `Your ${submissions[0].species_common_name} submission will be witnessed again`,
        html: renderRewitnessPending({
          domain: config.server.domain,
          member,
          submissions: rewitnessLetterRows(submissions),
          programContactEmail: config.email.adminsEmail,
        }),
      }),
    {
      type: "rewitness_pending",
      context: { memberId: member.id, submissions: submissions.length, recipient: member.contact_email },
    }
  );
}

const renderResetEmail = pug.compileFile("src/views/email/onForgotPassword.pug");
export async function sendResetEmail(email: string, display_name: string, code: string) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent password reset", { email });
    return;
  }

  // Critical: the reset flow can't proceed without this email, so rethrow on failure.
  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: email,
        subject: "Reset Password",
        html: renderResetEmail({
          domain: config.server.domain,
          display_name,
          code,
          programContactEmail: config.email.adminsEmail,
        }),
      }),
    { type: "password_reset", critical: true, context: { recipient: email } }
  );
}

const renderInviteEmail = pug.compileFile("src/views/email/invite.pug");
export async function sendInviteEmail(
  email: string,
  display_name: string,
  code: string,
  member?: MemberRecord,
  submissions?: Submission[]
) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent invite", { email });
    return;
  }

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: email,
        bcc: DEBUG_EMAIL,
        subject: "Welcome to the BASNY Breeders Awards Program!",
        html: renderInviteEmail({
          domain: config.server.domain,
          display_name,
          code,
          member,
          submissions,
        }),
      }),
    { type: "member_invite", context: { recipient: email } }
  );
}

const renderLevelUpgrade = pug.compileFile("src/views/email/onLevelUpgrade.pug");
import type { Program } from "./levelManager";

export async function onLevelUpgrade(
  member: MemberRecord,
  program: Program,
  newLevel: string,
  totalPoints?: number
) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent level upgrade", { memberId: member.id, newLevel });
    return;
  }

  const programNames = {
    fish: "Breeder Awards Program (BAP)",
    plant: "Horticultural Awards Program (HAP)",
    coral: "Coral Awards Program (CAP)",
  };

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        subject: `Congratulations! New ${programNames[program]} Level: ${newLevel}`,
        html: renderLevelUpgrade({
          domain: config.server.domain,
          member,
          program,
          newLevel,
          totalPoints,
        }),
      }),
    { type: "level_upgrade", context: { memberId: member.id, newLevel, recipient: member.contact_email } }
  );
}

/** The columns the Witness letter reads off a Submission as the Witness left it. */
export type WitnessedSubmission = Pick<
  Submission,
  | "id"
  | "species_type"
  | "species_class"
  | "species_common_name"
  | "species_latin_name"
  | "reproduction_date"
  | "witnessed_on"
  | "points"
  | "article_points"
  | "cares_species"
  | "flowered"
  | "sexual_reproduction"
>;

/**
 * The Witness letter's facts, worked out once so the subject line, the
 * template and the demo page cannot disagree. Days arrive formatted, in UTC
 * like every day the Portal prints.
 */
export type WitnessLetter = {
  submissionId: number;
  /** `Witnessed: <common name>, <total> points pending approval` */
  subject: string;
  /** "Your spawn has been witnessed" for fish and inverts; "propagation" for plants and corals */
  heading: string;
  /** BAP, HAP or CAP */
  programAbbreviation: string;
  /** The Program's full name, for the sign-off */
  programName: string;
  witnessName: string;
  witnessedOn: string;
  speciesCommonName: string;
  speciesLatinName: string;
  speciesClass: string;
  /** "Reproduced" for fish and inverts, "Propagated" for plants and corals */
  reproductionLabel: string;
  reproducedOn: string;
  /** Base points first, then each bonus that is set; they add up to `total` */
  lines: BonusLine[];
  total: number;
  /** The one line naming the bonuses still possible after approval, or null when none are */
  laterBonuses: string | null;
  /** No approved Submission of the Species existed at the Witness; never added to the total */
  firstTime: boolean;
  /** The day the waiting period ends */
  readyOn: string;
  /** Fish keep at least 6 healthy fry until then */
  keepFry: boolean;
  /** What the member brings to the meeting: fry, plants or corals */
  offspring: string;
};

/** How the letter names what the member can still see happen after approval. */
const seenLater: Partial<Record<BonusField, string>> = {
  flowered: "flowering",
  sexual_reproduction: "sexual reproduction",
};

/**
 * The sentence naming the bonuses still possible after approval, e.g. "Write
 * an article, or see flowering or sexual reproduction, after approval? Tell
 * the committee and they'll add the bonus." Null when none are.
 */
function laterBonusesLine(program: string, row: WitnessedSubmission): string | null {
  const possible = bonusesStillPossible(program, row);
  if (possible.length === 0) return null;
  const clauses: string[] = [];
  if (possible.includes("article_points")) clauses.push("write an article");
  const seen = possible.flatMap((bonus) => seenLater[bonus] ?? []);
  if (seen.length > 0) clauses.push(`see ${seen.join(" or ")}`);
  const question = clauses.length === 1 ? `${clauses[0]} after approval?` : `${clauses[0]}, or ${clauses[1]}, after approval?`;
  return `${question.charAt(0).toUpperCase()}${question.slice(1)} Tell the committee and they'll add the bonus.`;
}

/** Whether a Species type is a spawn (fish and inverts) rather than a propagation (plants and corals). */
function isSpawn(speciesType: string): boolean {
  return speciesType !== "Plant" && speciesType !== "Coral";
}

/**
 * The Witness letter's facts from the row the Witness left and what the
 * lifecycle knows about the Species. The points come off the row through the
 * one Points rule (`pointsBreakdown`), so the lines add up to the total the
 * subject prints; first-time is never among them.
 */
export function witnessLetter(
  submission: WitnessedSubmission,
  witness: Pick<MemberRecord, "display_name">,
  facts: WitnessedFacts
): WitnessLetter {
  const program = programOfSpeciesType(submission.species_type);
  const { lines, total } = pointsBreakdown(submission);
  const spawn = isSpawn(submission.species_type);
  return {
    submissionId: submission.id,
    subject: `Witnessed: ${submission.species_common_name}, ${total} points pending approval`,
    heading: spawn ? "Your spawn has been witnessed" : "Your propagation has been witnessed",
    programAbbreviation: programMetadata[program].abbreviation,
    programName: programMetadata[program].name,
    witnessName: witness.display_name,
    witnessedOn: formatLongDate(submission.witnessed_on),
    speciesCommonName: submission.species_common_name,
    speciesLatinName: submission.species_latin_name,
    speciesClass: submission.species_class,
    reproductionLabel: spawn ? "Reproduced" : "Propagated",
    reproducedOn: formatLongDate(submission.reproduction_date),
    lines,
    total,
    laterBonuses: laterBonusesLine(program, submission),
    firstTime: facts.firstTime,
    readyOn: formatLongDate(waitingPeriodEndsOn(submission)),
    keepFry: submission.species_type === "Fish",
    offspring: offspringOf(submission),
  };
}

const renderOnWitnessConfirmed = pug.compileFile("src/views/email/onWitnessConfirmed.pug");
/**
 * The one email a member gets when the Witness is confirmed (#526): who
 * witnessed it, the full points breakdown as pending approval, what is still
 * possible, and what happens next. A reply goes to the committee, since a
 * dispute is a reply for now. It replaced the "Screening Approved" and
 * "Witness Confirmed" letters.
 */
export async function onWitnessConfirmed(
  submission: Submission,
  member: MemberRecord,
  witness: MemberRecord,
  facts: WitnessedFacts
) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent witness confirmed", { submissionId: submission.id });
    return;
  }

  const letter = witnessLetter(submission, witness, facts);
  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        replyTo: config.email.adminsEmail,
        subject: letter.subject,
        html: renderOnWitnessConfirmed({
          domain: config.server.domain,
          member,
          letter,
        }),
      }),
    { type: "witness_confirmed", context: { submissionId: submission.id, recipient: member.contact_email } }
  );
}

const renderSpecialtyAward = pug.compileFile("src/views/email/onSpecialtyAward.pug");
/**
 * A Specialty Award is an achievement, not a row that quietly appears in a
 * list. It is announced the same way a Level rise is.
 */
export async function onSpecialtyAward(member: MemberRecord, awardName: string) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent specialty award", {
      memberId: member.id,
      awardName,
    });
    return;
  }

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        subject: `Congratulations! You've earned the ${awardName}`,
        html: renderSpecialtyAward({
          domain: config.server.domain,
          member,
          awardName,
        }),
      }),
    { type: "specialty_award", context: { memberId: member.id, awardName, recipient: member.contact_email } }
  );
}

const renderSubmissionDeleted = pug.compileFile("src/views/email/onSubmissionDeleted.pug");
/**
 * Sent only when a committee member deleted work that was not their own, so a
 * member's Submission does not simply vanish with no explanation.
 */
export async function onSubmissionDeleted(sub: Submission, member: MemberRecord) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent submission deleted", { submissionId: sub.id });
    return;
  }

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        subject: `Submission Removed - ${sub.species_common_name}`,
        html: renderSubmissionDeleted({
          domain: config.server.domain,
          submission: sub,
          member,
          programContactEmail: config.email.adminsEmail,
        }),
      }),
    { type: "submission_deleted", context: { submissionId: sub.id, recipient: member.contact_email } }
  );
}

/** One Submission, as the digest lists it. */
export type DigestItem = {
  id: number;
  memberName: string;
  speciesCommonName: string;
  speciesLatinName: string;
  waitingSince: string | null;
};

/** One queue of one Program, as the digest lists it. */
export type DigestSection = {
  program: string;
  programName: string;
  queue: string;
  title: string;
  submissions: DigestItem[];
};

/** What is still waiting on the committee today. */
export type CommitteeDigest = {
  sections: DigestSection[];
  total: number;
};

const renderCommitteeDigest = pug.compileFile("src/views/email/committeeDigest.pug");
/**
 * The committee's daily digest, replacing the cc on members' letters: a list of
 * what is waiting on them, per Program, sent only while something is waiting.
 */
export async function onCommitteeDigest(recipients: string[], digest: CommitteeDigest) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent committee digest", { items: digest.total });
    return;
  }

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: recipients,
        bcc: DEBUG_EMAIL,
        subject: `BAS Awards: ${digest.total} submission${digest.total === 1 ? "" : "s"} waiting on the committee`,
        html: renderCommitteeDigest({
          domain: config.server.domain,
          digest,
        }),
      }),
    { type: "committee_digest", context: { recipients: recipients.length, items: digest.total } }
  );
}
