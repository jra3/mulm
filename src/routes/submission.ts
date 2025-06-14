import { Response } from 'express';
import { getBapFormTitle, getClassOptions, waterTypes, speciesTypes, foodTypes, spawnLocations, bapDraftForm, bapFields, bapForm, FormValues } from "@/forms/submission";
import { extractValid, isLivestock } from "@/forms/utils";
import { getBodyString, getQueryString } from "@/utils/request";
import { MulmRequest } from "@/sessions";
import { MemberRecord, getMember, getMemberByEmail } from "@/db/members";
import { onSubmissionSend } from "@/notifications";
import * as db from "@/db/submissions";
import { getCanonicalSpeciesName } from "@/db/species";
import { uploadProcessedPhoto, deleteProcessedPhoto, getPhotoUrl } from "@/services/storage";
import { logger } from "@/utils/logger";

export const renderSubmissionForm = (req: MulmRequest, res: Response) => {
const { viewer } = req;
	const form = {
		// auto-fill member name and email if logged in
		member_name: viewer?.display_name,
		member_email: viewer?.contact_email,
		...req.query,
	};

	const selectedType = getQueryString(req, 'species_type', 'Fish');
	res.render("submit", {
		title: getBapFormTitle(selectedType),
		form,
		errors: new Map(),
		classOptions: getClassOptions(selectedType),
		waterTypes,
		speciesTypes,
		foodTypes,
		spawnLocations,
		isLivestock: isLivestock(selectedType),
		isAdmin: Boolean(viewer?.is_admin),
	});
};

export const view = async (req: MulmRequest, res: Response) => {
	// Everyone can view, but owners and admins have extra controls
	const submission = await validateSubmission(req, res);
	if (!submission) {
		return;
	}
	const { viewer } = req;

	const local = (time?: string | null) => {
		if (!time) {
			return undefined;
		}
		const date = new Date(time);
		return date.toLocaleDateString();
	}

	let approver: MemberRecord | undefined;
	if (submission.approved_by != null) {
		approver = await getMember(submission.approved_by);
	}

	const aspect = {
		isSubmitted: submission.submitted_on != null,
		isApproved: submission.approved_on != null,
		isLoggedIn: Boolean(viewer),
		isSelf: viewer && submission.member_id === viewer.id,
		isAdmin: viewer && viewer.is_admin,
	};

	if (viewer && aspect.isSelf && !aspect.isSubmitted) {
		const editAttachments = await db.getSubmissionAttachments(submission.id);
		const editLinks = editAttachments.filter(a => a.type === 'link');
		
		res.render('submit', {
			title: `Edit ${getBapFormTitle(submission.program)}`,
			form: {
				...submission,
				member_name: viewer.display_name,
				member_email: viewer.contact_email,
				link1: editLinks[0]?.handle || '',
				link2: editLinks[1]?.handle || '',
				link3: editLinks[2]?.handle || '',
			},
			errors: new Map(),
			classOptions: getClassOptions(submission.species_type),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(submission.species_type),
			isAdmin: aspect.isAdmin,
			editing: true,
		});
		return;
	}

	const nameGroup = await (async () => {
		if (submission.species_name_id) {
			const name = await getCanonicalSpeciesName(submission.species_name_id);
			if (name) {
				return name;
			}
		}
		const [genus, ...parts] = submission.species_latin_name.split(" ");
		return {
			canonical_genus: genus,
			canonical_species_name: parts.join(" "),
		};
	})();

	const canonicalName = `${nameGroup.canonical_genus} ${nameGroup.canonical_species_name}`;
	
	const attachments = await db.getSubmissionAttachments(submission.id);
	const photos = attachments.filter(a => a.type === 'photo').map(photo => ({
		...photo,
		displayUrl: getPhotoUrl(`${photo.handle}_display.jpg`),
		thumbnailUrl: getPhotoUrl(`${photo.handle}_thumb.jpg`),
		originalUrl: getPhotoUrl(`${photo.handle}_original.jpg`)
	}));
	const links = attachments.filter(a => a.type === 'link');

	res.render('submission/review', {
		submission: {
			...submission,
			reproduction_date: local(submission.reproduction_date),
			submitted_on: local(submission.submitted_on),
			approved_on: local(submission.approved_on),
			approved_by: approver?.display_name,

			foods: (JSON.parse(submission.foods) as string[] ?? []).join(","),
			spawn_locations: (JSON.parse(submission.spawn_locations) as string[] ?? []).join(","),
		},
		canonicalName,
		name: nameGroup,
		photos,
		links,
		...aspect,
	});
}

export async function validateSubmission(req: MulmRequest, res: Response) {
	const subId = parseInt(req.params.subId);
	if (!subId) {
		res.status(400).send("Invalid submission id");
		return;
	}

	const submission = await db.getSubmissionById(subId);
	if (!submission) {
		res.status(404).send("Submission not found");
		return;
	}

	return submission;
}

function parseAndValidateForm(req: MulmRequest): {
	form?: never;
	draft?: never;
	errors: Map<string, string>,
} | {
	form: FormValues,
	draft: boolean
	errors?: never;
} {
	let draft = false;
	let form: FormValues;
	let parsed;

	// Extract link fields before validation since they're not part of the main form schema
	const bodyWithoutLinks = { ...req.body } as Record<string, unknown>;
	delete bodyWithoutLinks.link1;
	delete bodyWithoutLinks.link2;
	delete bodyWithoutLinks.link3;

	if ("draft" in req.body) {
		parsed = bapDraftForm.safeParse(bodyWithoutLinks);
		form = extractValid(bapFields, bodyWithoutLinks);
		draft = true;
	} else {
		parsed = bapForm.safeParse(bodyWithoutLinks);
		form = parsed.data!;
	}

	if (!parsed.success) {
		const errors = new Map<string, string>();
		parsed.error.issues.forEach((issue) => {
			errors.set(String(issue.path[0]), issue.message);
		});

		return { errors };
	}

	form = { ...form, ...parsed.data };
	return { form, draft };
}

function extractAndValidateLinks(body: { link1?: string; link2?: string; link3?: string; }): { links: string[]; errors: Map<string, string> } {
	const links: string[] = [];
	const errors = new Map<string, string>();
	
	const linkFields = [
		{ field: 'link1', value: body.link1 },
		{ field: 'link2', value: body.link2 },
		{ field: 'link3', value: body.link3 }
	];
	
	for (const { field, value } of linkFields) {
		if (value && typeof value === 'string' && value.trim()) {
			try {
				new URL(value.trim()); // This will throw if invalid URL
				links.push(value.trim());
			} catch {
				errors.set(field, 'Please enter a valid URL');
			}
		}
	}
	
	return { links, errors };
}

async function processAttachments(submissionId: number, files: Express.Multer.File[], links: string[]) {
	const attachmentPromises: Promise<number>[] = [];

	if (files && files.length > 0) {
		for (const file of files) {
			try {
				const uploadedImages = await uploadProcessedPhoto(file.buffer, file.originalname, submissionId);
				const photoKey = uploadedImages.original.key.replace('_original.jpg', '');
				attachmentPromises.push(
					db.createSubmissionAttachment(submissionId, 'photo', photoKey)
				);
				logger.info(`Photo attachment created for submission ${submissionId}: ${photoKey}`);
			} catch (error) {
				logger.error(`Failed to upload photo for submission ${submissionId}:`, error);
				throw new Error('Failed to upload photo');
			}
		}
	}

	for (const link of links) {
		if (link && link.trim()) {
			attachmentPromises.push(
				db.createSubmissionAttachment(submissionId, 'link', link.trim())
			);
			logger.info(`Link attachment created for submission ${submissionId}: ${link}`);
		}
	}

	await Promise.all(attachmentPromises);
}

export const create = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	const parseResult = parseAndValidateForm(req);
	const { links, errors: linkErrors } = extractAndValidateLinks(req.body as { link1?: string; link2?: string; link3?: string; });
	
	if (parseResult.errors) {
		// Combine form and link validation errors
		const allErrors = new Map([...parseResult.errors, ...linkErrors]);
		
		const selectedType = getBodyString(req, 'species_type', 'Fish');
		res.render('bapForm/form', {
			title: getBapFormTitle(selectedType),
			form: req.body as unknown,
			errors: allErrors,
			classOptions: getClassOptions(selectedType),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(selectedType),
			isAdmin: Boolean(viewer.is_admin),
		});
		return;
	}
	
	const { form, draft } = parseResult;
	
	if (linkErrors.size > 0) {
		const selectedType = getBodyString(req, 'species_type', 'Fish');
		res.render('bapForm/form', {
			title: getBapFormTitle(selectedType),
			form: req.body as unknown,
			errors: linkErrors,
			classOptions: getClassOptions(selectedType),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(selectedType),
			isAdmin: Boolean(viewer.is_admin),
		});
		return;
	}

	if (form.member_email != viewer.contact_email || form.member_name != viewer.display_name) {
		// Admins can supply any member
		if (!viewer.is_admin) {
			res.status(403).send();
			return;
		}
	}

	const member = await getMemberByEmail(form.member_email!);
	let memberId: number;

	if (!member) {

		/*

		TODO implement me after better-auth

		if (viewer.is_admin) {
			// create a placeholder member
			memberId = createMember(form.contact_email!, form.member_name!);
			member = getMember(memberId)!;
		} else {
			res.status(403).send("User cannot submit for this member");
			return;
		}

		*/

	} else {
		memberId = member.id;
	}

	// TODO figure out how to avoid read after write
	const subId = await db.createSubmission(memberId!, form, !draft);
	const sub = await db.getSubmissionById(subId);

	if (!sub) {
		res.status(500).send("Failed to create submission");
		return;
	}

	if (!draft) {
		await onSubmissionSend(sub, member!);
	}

	const files = req.files as Express.Multer.File[];
	
	try {
		if (files?.length > 0 || links.length > 0) {
			await processAttachments(subId, files || [], links);
		}
	} catch (error) {
		logger.error(`Failed to process attachments for submission ${subId}:`, error);
	}

	res.render('submission/success', {
		title: "Submission Complete",
		member,
		subId,
	});
}

export const update = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	const submission = await validateSubmission(req, res);
	if (!submission) {
		return;
	}

	if (!viewer) {
		res.status(401).send();
		return;
	}

	if (!viewer.is_admin) {
		if (viewer.id !== submission.member_id) {
			res.status(403).send("Submission already submitted");
			return;
		}
	}

	if (viewer?.id !== submission?.member_id && !viewer.is_admin) {
		res.status(403).send();
		return;
	}

	if ("unsubmit" in req.body) {
		await db.updateSubmission(submission.id, { submitted_on: null });
		res.set('HX-Redirect', '/sub/' + submission.id).send();
		return;
	}

	const parseResult = parseAndValidateForm(req);
	const { links, errors: linkErrors } = extractAndValidateLinks(req.body as { link1?: string; link2?: string; link3?: string; });
	
	if (parseResult.errors) {
		// Combine form and link validation errors
		const allErrors = new Map([...parseResult.errors, ...linkErrors]);
		
		const selectedType = getBodyString(req, "species_type", "Fish");
		res.render('bapForm/form', {
			title: `Edit ${getBapFormTitle(selectedType)}`,
			form: req.body as unknown,
			errors: allErrors,
			classOptions: getClassOptions(selectedType),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(selectedType),
			isAdmin: Boolean(viewer.is_admin),
		});
		return;
	}
	
	const { form, draft } = parseResult;
	
	if (linkErrors.size > 0) {
		const selectedType = getBodyString(req, "species_type", "Fish");
		res.render('bapForm/form', {
			title: `Edit ${getBapFormTitle(selectedType)}`,
			form: req.body as unknown,
			errors: linkErrors,
			classOptions: getClassOptions(selectedType),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(selectedType),
			isAdmin: Boolean(viewer.is_admin),
		});
		return;
	}

	// TODO fix silly serial queries at some point
	await db.updateSubmission(submission.id, db.formToDB(submission.member_id, form, !draft));
	const sub = await db.getSubmissionById(submission.id);
	const member = await getMember(submission.member_id);
	if (!draft && sub && member) {
		await onSubmissionSend(sub, member);
	}

	const files = req.files as Express.Multer.File[];
	
	try {
		if (files?.length > 0 || links.length > 0) {
			await processAttachments(submission.id, files || [], links);
		}
	} catch (error) {
		logger.error(`Failed to process attachments for submission ${submission.id}:`, error);
	}

	res.render('submission/success', {
		title: "Edits Saved",
		member,
		subId: submission.id,
	});
}

export const remove = async (req: MulmRequest, res: Response) => {
	const submission = await validateSubmission(req, res);
	if (!submission) {
		return;
	}

	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	// Admin always delete
	if (!viewer.is_admin) {
		// Owner can delete when not submitted
		if (viewer.id !== submission.member_id && submission.submitted_on != null) {
			res.status(403).send();
			return;
		}
	}

	try {
		const attachments = await db.deleteAllSubmissionAttachments(submission.id);
		
		for (const attachment of attachments) {
			if (attachment.type === 'photo') {
				try {
					await deleteProcessedPhoto(attachment.handle);
				} catch (error) {
					logger.error(`Failed to delete photo ${attachment.handle}:`, error);
				}
			}
		}
	} catch (error) {
		logger.error(`Failed to cleanup attachments for submission ${submission.id}:`, error);
	}

	await db.deleteSubmission(submission.id);
}
