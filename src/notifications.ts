import { Resend } from "resend";
import config from "./config.json";
import { type Submission } from "./db/submissions";
import { MemberRecord } from "./db/members";
import * as pug from "pug";

const renderOnSubmission = pug.compileFile("src/views/email/onSubmission.pug");
export async function onSubmissionSend(sub: Submission, member: MemberRecord) {
	const resend = new Resend(config.resendApiKey);
	return resend.emails.send({
		from: config.fromEmail,
		to: member.contact_email,
		bcc: config.adminsEmail,
		subject: `Submission Confirmation - ${sub.species_common_name}`,
		html: renderOnSubmission({
			domain: config.domain,
			submission: sub,
			member,
		}),
	});
}

const renderOnApprove = pug.compileFile("src/views/email/onApproval.pug");
export async function onSubmissionApprove(
	sub: Submission,
	member: MemberRecord,
) {
	const resend = new Resend(config.resendApiKey);
	return resend.emails.send({
		from: config.fromEmail,
		to: member.contact_email,
		subject: `Submission Approved! - ${sub.species_common_name}`,
		html: renderOnApprove({
			domain: config.domain,
			submission: sub,
			member,
		}),
	});
}

export async function sendVerificationEmail(email: string, url: string) {
	const resend = new Resend(config.resendApiKey);
	return resend.emails.send({
		from: config.fromEmail,
		to: email,
		subject: "Verify your email",
		text: `Click the link to verify your account and log in: ${url}`,
	});
}

const renderResetEmail = pug.compileFile("src/views/email/onForgotPassword.pug");
export async function sendResetEmail(email: string, display_name: string, code: string) {
	const resend = new Resend(config.resendApiKey);
	return resend.emails.send({
		from: config.fromEmail,
		to: email,
		subject: "Reset Password",
		html: renderResetEmail({
			domain: config.domain,
			display_name,
			code,
		}),
	});
}
