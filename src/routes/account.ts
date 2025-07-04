import { checkPassword, makePasswordEntry } from "@/auth";
import { getMemberPassword, createOrUpdatePassword, updateMember, getGoogleAccountByMemberId, deleteGoogleAccount } from "@/db/members";
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

	const [
		googleURL,
		googleAccount
	] = await Promise.all([
		getGoogleOAuthURL(),
		getGoogleAccountByMemberId(viewer.id),
	]);

	res.render("account/page", {
		title: "Account Settings",
		viewer,
		googleURL,
		googleAccount,
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
			googleURL: getGoogleOAuthURL(),
			errors,
		});
		return;
	}

	const form = parsed.data;

	try {
		if (form.current_password && form.password) {
			const currentPasswordEntry = await getMemberPassword(viewer.id);
			// Not set, or we have correct password
			// Need better logic here...
			if (!currentPasswordEntry || await checkPassword(currentPasswordEntry, form.current_password)) {
				const passwordEntry = await makePasswordEntry(form.password)
				await createOrUpdatePassword(viewer.id, passwordEntry)
				// Updated password!
			} else {
				errors.set("password", "Password incorrect");
			}
		}
	} catch (e: unknown) {
		console.error(e);
		errors.set("password", "Unknown error");
	}

	await updateMember(viewer.id, {
		display_name: form.display_name,
		contact_email: form.email,
	});

	res.render("account/settings", {
		viewer: {
			display_name: form.display_name,
			contact_email: form.email,
			googleURL: getGoogleOAuthURL(),
		},
		errors,
	});
}

export const unlinkGoogleAccount = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	await deleteGoogleAccount(String(req.params.sub), viewer.id);
	res.send("Unlinked Google account");
}

