import nodemailer from "nodemailer";
import config from "@/config.json";
import { type Submission } from "./db/submissions";
import { getAdminEmails, MemberRecord } from "./db/members";
import * as pug from "pug";
import { logger } from "@/utils/logger";
import { sendEmailWithRetry } from "./services/emailService";

const DEBUG_EMAIL = process.env.DEBUG_EMAIL;
const fromEmail = `BASNY Breeder Awards ${config.email.fromEmail}`;
const EMAILS_DISABLED =
  process.env.NODE_ENV === "test" || // Disable emails in test mode
  config.email.disableEmails === true; // Config killswitch for local development

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
const renderOnScreeningApproved = pug.compileFile("src/views/email/onScreeningApproved.pug");
const renderOnScreeningRejected = pug.compileFile("src/views/email/onScreeningRejected.pug");
export async function onSubmissionSend(sub: Submission, member: MemberRecord) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent submission confirmation", { submissionId: sub.id });
    return;
  }

  const admins = await getAdminEmails();

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        cc: admins,
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

  const admins = await getAdminEmails();

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: contact_email,
        cc: admins,
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

  const admins = await getAdminEmails();

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        cc: admins,
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
        }),
      }),
    { type: "submission_approved", context: { submissionId: sub.id, recipient: member.contact_email } }
  );
}

const renderWaitingPeriodComplete = pug.compileFile("src/views/email/onWaitingPeriodComplete.pug");
/**
 * Nudge sent when a submission's waiting period elapses, prompting the submitter
 * to bring the fish/plant/coral to the next meeting and click "Brought to
 * Meeting" so it enters the approval queue. Non-critical (the daily job logs and
 * continues on failure; it will not be marked reminded, so it retries next run).
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
        subject: `Ready for the next meeting - ${sub.species_common_name}`,
        html: renderWaitingPeriodComplete({
          domain: config.server.domain,
          submission: sub,
          member,
        }),
      }),
    {
      type: "waiting_period_complete",
      context: { submissionId: sub.id, recipient: member.contact_email },
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

export async function onScreeningApproved(
  submission: Submission,
  member: MemberRecord,
  witness: MemberRecord
) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent screening approved", { submissionId: submission.id });
    return;
  }

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        subject: `Screening Approved - ${submission.species_common_name}`,
        html: renderOnScreeningApproved({
          domain: config.server.domain,
          submission,
          member,
          witness,
        }),
      }),
    { type: "screening_approved", context: { submissionId: submission.id, recipient: member.contact_email } }
  );
}

export async function onScreeningRejected(
  submission: Submission,
  member: MemberRecord,
  reason: string
) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent screening rejected", { submissionId: submission.id });
    return;
  }

  await sendEmailWithRetry(
    () =>
      transporter.sendMail({
        from: fromEmail,
        to: member.contact_email,
        bcc: DEBUG_EMAIL,
        subject: `Additional Information Needed - ${submission.species_common_name}`,
        html: renderOnScreeningRejected({
          domain: config.server.domain,
          submission,
          member,
          reason,
          programContactEmail: config.email.adminsEmail,
        }),
      }),
    { type: "screening_rejected", context: { submissionId: submission.id, recipient: member.contact_email } }
  );
}
