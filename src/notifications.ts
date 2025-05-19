import nodemailer from "nodemailer";
import config from "./config.json";
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
		subject: `Chages Requested - ${sub.species_common_name}`,
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
		}),
	});
}


const renderInviteEmail = pug.compileFile("src/views/email/invite.pug");
export async function sendInviteEmail(email: string, display_name: string, code: string) {
	return transporter.sendMail({
		from: fromEmail,
		to: email,
		bcc: DEBUG_EMAIL,
		subject: "Welcome to the BASNY Breeders Awards Program!",
		html: renderInviteEmail({
			domain: config.domain,
			display_name,
			code,
		}),
	});
}
