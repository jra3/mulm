import { checkPassword, makePasswordEntry } from "@/auth";
import { getMemberPassword, createOrUpdatePassword, updateMember } from "@/db/members";
import { updateSchema } from "@/forms/login";
import { getGoogleOAuthURL } from "@/oauth";
import { MulmRequest } from "@/sessions";
import { Response } from "express";

export const viewAccountSettings = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	res.render("account/page", {
		title: "Account Settings",
		viewer,
		googleURL: await getGoogleOAuthURL(),
		errors: new Map(),
	});
};

export const updateAccountSettings = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	const errors = new Map<string, string>();
	const parsed = updateSchema.safeParse(req.body);
	if (!parsed.success) {
		parsed.error.issues.forEach((issue) => {
			errors.set(String(issue.path[0]), issue.message);
		});

		res.render("account/settings", {
			viewer,
			//googleURL: await getGoogleLinkURL(req),
			errors,
		});
		return;
	}

	const form = parsed.data;

	try {
		if (form.current_password && form.password) {
			const currentPasswordEntry = getMemberPassword(viewer.id);
			// Not set, or we have correct password
			// Need better logic here...
			if (!currentPasswordEntry || await checkPassword(currentPasswordEntry, form.current_password)) {
				const passwordEntry = await makePasswordEntry(form.password)
				createOrUpdatePassword(viewer.id, passwordEntry)
				// Updated password!
			} else {
				errors.set("password", "Password incorrect");
			}
		}
	} catch (e: unknown) {
		console.error(e);
		errors.set("password", "Unknown error");
	}

	updateMember(viewer.id, {
		display_name: form.display_name,
		contact_email: form.email,
	});

	res.render("account/settings", {
		viewer: {
			display_name: form.display_name,
			contact_email: form.email,
			googleURL: await getGoogleOAuthURL(),
		},
		errors,
	});

}
