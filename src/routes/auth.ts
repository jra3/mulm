import { checkPassword } from "@/auth";
import { createMember, getMemberByEmail, getMemberPassword } from "@/db/members";
import { forgotSchema, loginSchema, signupSchema } from "@/forms/login";
import { validateFormResult } from "@/forms/utils";
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

export const forgotPassword = async (req: MulmRequest, res: Response) => {
	const errors = new Map<string, string>();
	const onError = () => {
		res.render("account/forgotPassword", {
			...req.body,
			errors,
		});
	};

	const parsed = forgotSchema.safeParse(req.body);
	if (!validateFormResult(parsed, errors, onError)) {
		return;
	}

	// create a code, put it in the db, send the user an email with the code
	// the code should have an expiration time

	//await auth.api.forgetPassword({
	//	headers: fromNodeHeaders(req.headers),
	//	body: {
	//		email: req.body.email,
	//		redirectTo: "/reset-password",
	//	},
	//});

	errors.set("form", "Check your email for a reset link.");
	onError();
}
