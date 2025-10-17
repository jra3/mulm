import nodemailer from "nodemailer";
import config from "@/config.json";
import { type Submission } from "./db/submissions";
import { getAdminEmails, MemberRecord } from "./db/members";
import * as pug from "pug";
import { logger } from "@/utils/logger";

const DEBUG_EMAIL = process.env.DEBUG_EMAIL;
const fromEmail = `BASNY Breeder Awards ${config.fromEmail}`;
const EMAILS_DISABLED = true; // Set to false to re-enable emails

const transporter = nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: config.smtpSecure,
  auth: {
    user: config.fromEmail,
    pass: config.smtpPassword,
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

  return transporter.sendMail({
    from: fromEmail,
    to: member.contact_email,
    cc: admins,
    bcc: DEBUG_EMAIL,
    subject: `Submission Confirmation - ${sub.species_common_name}`,
    html: renderOnSubmission({
      domain: config.domain,
      submission: sub,
      member,
    }),
  });
}

export async function sendChangesRequest(sub: Submission, contact_email: string, content: string) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent changes request", { submissionId: sub.id });
    return;
  }

  const admins = await getAdminEmails();

  return transporter.sendMail({
    from: fromEmail,
    to: contact_email,
    cc: admins,
    bcc: DEBUG_EMAIL,
    subject: `Changes Requested - ${sub.species_common_name}`,
    text: content,
  });
}

const renderOnApprove = pug.compileFile("src/views/email/onApproval.pug");
export async function onSubmissionApprove(sub: Submission, member: MemberRecord) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent submission approval", { submissionId: sub.id });
    return;
  }

  return transporter.sendMail({
    from: fromEmail,
    to: member.contact_email,
    bcc: DEBUG_EMAIL,
    subject: `Submission Approved! - ${sub.species_common_name}`,
    html: renderOnApprove({
      domain: config.domain,
      submission: sub,
      member,
    }),
  });
}

const renderResetEmail = pug.compileFile("src/views/email/onForgotPassword.pug");
export async function sendResetEmail(email: string, display_name: string, code: string) {
  if (EMAILS_DISABLED) {
    logger.info("Email disabled - would have sent password reset", { email });
    return;
  }

  return transporter.sendMail({
    from: fromEmail,
    to: email,
    subject: "Reset Password",
    html: renderResetEmail({
      domain: config.domain,
      display_name,
      code,
      programContactEmail: config.adminsEmail,
    }),
  });
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

  return transporter.sendMail({
    from: fromEmail,
    to: email,
    bcc: DEBUG_EMAIL,
    subject: "Welcome to the BASNY Breeders Awards Program!",
    html: renderInviteEmail({
      domain: config.domain,
      display_name,
      code,
      member,
      submissions,
    }),
  });
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

  return transporter.sendMail({
    from: fromEmail,
    to: member.contact_email,
    bcc: DEBUG_EMAIL,
    subject: `Congratulations! New ${programNames[program]} Level: ${newLevel}`,
    html: renderLevelUpgrade({
      domain: config.domain,
      member,
      program,
      newLevel,
      totalPoints,
    }),
  });
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

  return transporter.sendMail({
    from: fromEmail,
    to: member.contact_email,
    bcc: DEBUG_EMAIL,
    subject: `Screening Approved - ${submission.species_common_name}`,
    html: renderOnScreeningApproved({
      domain: config.domain,
      submission,
      member,
      witness,
    }),
  });
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

  return transporter.sendMail({
    from: fromEmail,
    to: member.contact_email,
    bcc: DEBUG_EMAIL,
    subject: `Additional Information Needed - ${submission.species_common_name}`,
    html: renderOnScreeningRejected({
      domain: config.domain,
      submission,
      member,
      reason,
      programContactEmail: config.adminsEmail,
    }),
  });
}
