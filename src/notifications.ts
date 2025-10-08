import nodemailer from "nodemailer";
import config from "@/config.json";
import { type Submission } from "./db/submissions";
import { getAdminEmails, MemberRecord } from "./db/members";
import * as pug from "pug";

const DEBUG_EMAIL = process.env.DEBUG_EMAIL;
const fromEmail = `BASNY Breeder Awards ${config.fromEmail}`;

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
const renderOnWitnessConfirmed = pug.compileFile("src/views/email/onWitnessConfirmed.pug");
const renderOnWitnessDeclined = pug.compileFile("src/views/email/onWitnessDeclined.pug");
export async function onSubmissionSend(
  sub: Submission,
  member: MemberRecord,
) {
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


export async function sendChangesRequest(
  sub: Submission,
  contact_email: string,
  content: string,
) {
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
export async function onSubmissionApprove(
  sub: Submission,
  member: MemberRecord,
) {
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


export async function sendVerificationEmail(email: string, url: string) {
  return transporter.sendMail({
    from: fromEmail,
    to: email,
    subject: "Verify your email",
    text: `Click the link to verify your account and log in: ${url}`,
  });
}


const renderResetEmail = pug.compileFile("src/views/email/onForgotPassword.pug");
export async function sendResetEmail(email: string, display_name: string, code: string) {
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
export async function sendInviteEmail(email: string, display_name: string, code: string, member?: MemberRecord, submissions?: Submission[]) {
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
  totalPoints?: number,
) {
  const programNames = {
    fish: 'Breeder Awards Program (BAP)',
    plant: 'Horticultural Awards Program (HAP)', 
    coral: 'Coral Awards Program (CAP)',
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

export async function onWitnessConfirmed(
  submission: Submission,
  member: MemberRecord,
  witness: MemberRecord,
) {
  return transporter.sendMail({
    from: fromEmail,
    to: member.contact_email,
    bcc: DEBUG_EMAIL,
    subject: `Witness Confirmed - ${submission.species_common_name}`,
    html: renderOnWitnessConfirmed({
      domain: config.domain,
      submission,
      member,
      witness,
    }),
  });
}

export async function onWitnessDeclined(
  submission: Submission,
  member: MemberRecord,
  reason: string,
) {
  return transporter.sendMail({
    from: fromEmail,
    to: member.contact_email,
    bcc: DEBUG_EMAIL,
    subject: `Witness Review Required - ${submission.species_common_name}`,
    html: renderOnWitnessDeclined({
      domain: config.domain,
      submission,
      member,
      reason,
      programContactEmail: config.adminsEmail,
    }),
  });
}
