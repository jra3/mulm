import { Resend } from 'resend';
import config from './config.json';
import { type Submission } from "./db/submissions";
import { MemberRecord } from "./db/members";
import * as pug from "pug";

const renderOnSubmission = pug.compileFile('src/views/email/onSubmission.pug');
export function onSubmissionSend(sub: Submission, member: MemberRecord) {
	const resend = new Resend(config.resendApiKey);
	resend.emails.send({
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

const renderOnApprove = pug.compileFile('src/views/email/onApproval.pug');
export function onSubmissionApprove(sub: Submission, member: MemberRecord) {
	const resend = new Resend(config.resendApiKey);
	resend.emails.send({
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
