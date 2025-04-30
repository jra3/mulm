import { AuthCode, checkPassword, generateRandomCode, makePasswordEntry } from "@/auth";
import { createAuthCode, getAuthCode } from "@/db/auth";
import { createMember, createOrUpdatePassword, getMember, getMemberByEmail, getMemberPassword } from "@/db/members";
import { forgotSchema, loginSchema, resetSchema, signupSchema } from "@/forms/login";
import { validateFormResult } from "@/forms/utils";
import { sendResetEmail } from "@/notifications";
import { createUserSession, destroyUserSession, MulmRequest } from "@/sessions";
import { Response } from "express";


export const signup = async (req: MulmRequest, res: Response) => {
	const errors = new Map<string, string>();
	const onError = () => {
		res.render("account/signup", {
			viewer: {
				display_name: req.body.display_name,
				contact_email: req.body.email,
			},
			errors,
		});
	};

	const parsed = signupSchema.safeParse(req.body);
	if (!validateFormResult(parsed, errors, onError)) {
		return;
	}

	const body = parsed.data;
	try {
		const memberId = await createMember(
			body.email,
			body.display_name,
			{ password: body.password },
		);
		createUserSession(req, res, memberId);
		res.set("HX-redirect", "/").send();
	} catch (e: unknown) {
		console.error(e);
		errors.set("form", "Failed to create new member account");
		onError();
	}
};

export const passwordLogin = async (req: MulmRequest, res: Response) => {
	const data = loginSchema.parse(req.body);
	const member = getMemberByEmail(data.email);
	if (member != undefined) {
		const pass = getMemberPassword(member.id);
		if (await checkPassword(pass, data.password)) {
			createUserSession(req, res, member.id);
			res.set("HX-Redirect", "/").send();
		}
	}
	res.send("Incorrect email or password");
}

// Clears the session cookies and deletes the session from the db
export const logout = (req: MulmRequest, res: Response) => {
	destroyUserSession(req, res);
	res.redirect("/");
}

export const validateForgotPassword = async (req: MulmRequest, res: Response) => {
	const code = req.query.code = req.query.code?.toString();
	if (code == undefined) {
		res.status(400).send("Missing code");
		return;
	}

	const codeEntry = getAuthCode(code);
	if (codeEntry == undefined || codeEntry.purpose != "password_reset") {
		res.status(400).send("Invalid code");
		return;
	}

	const now = new Date(Date.now());
	if (codeEntry.expires_on < now) {
		res.status(400).send("Code expired");
		return;
	}

	const member = getMember(codeEntry.member_id);
	if (member == undefined) {
		res.status(400).send("Member not found");
		return;
	}

	res.render("account/resetPassword", {
		email: member.contact_email,
		code: code,
		errors: new Map<string, string>(),
	})
}

export const sendForgotPassword = async (req: MulmRequest, res: Response) => {
	console.log("asdfuasdf");

	const errors = new Map<string, string>();
	const renderDialog = () => {
		res.render("account/forgotPassword", {
			...req.body,
			errors,
		});
	};

	const parsed = forgotSchema.safeParse(req.body);
	if (!validateFormResult(parsed, errors, renderDialog)) {
		return;
	}

	const member = getMemberByEmail(parsed.data.email);
	if (member == undefined) {
		// should fake success to prevent email enumeration
		errors.set("success", "Check your email for a reset link.");
		renderDialog();
		return;
	}

	const code: AuthCode = {
		member_id: member.id,
		code: generateRandomCode(24),
		expires_on: new Date(Date.now() + 60 * 60 * 1000),
		purpose: "password_reset",
	}
	console.log(1);
	createAuthCode(code);
	console.log(2);
	await sendResetEmail(member.contact_email, member.display_name, code.code);
	console.log(3);
	errors.set("success", "Check your email for a reset link.");
	renderDialog();
}

export const resetPassword = async (req: MulmRequest, res: Response) => {
	const errors = new Map<string, string>();

	const renderPage = () => {
		res.render("account/resetPassword", {
			errors,
		});
	};

	const parsed = resetSchema.safeParse(req.body);
	if (!validateFormResult(parsed, errors, renderPage)) {
		return;
	}

	const now = new Date(Date.now());
	const codeEntry = getAuthCode(parsed.data.code);
	if (codeEntry == undefined || codeEntry.purpose != "password_reset") {
		errors.set("form", "Invalid code");
	} else if (codeEntry.expires_on < now) {
		errors.set("form", "Code expired");
	} else {
		const member = getMember(codeEntry.member_id);
		if (member == undefined) {
			errors.set("form", "Member not found");
		} else {
			try {
				const passwordEntry = await makePasswordEntry(parsed.data.password);
				createOrUpdatePassword(member.id, passwordEntry);
				createUserSession(req, res, member.id);
				res.set("HX-redirect", "/").send();
				return;
			} catch (e: unknown) {
				console.error(e);
				errors.set("form", "Failed to reset password");
			}
		}
	}

	renderPage();
}

