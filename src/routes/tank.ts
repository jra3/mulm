import { Response } from 'express';
import { validateFormResult } from "@/forms/utils";
import { MulmRequest } from "@/sessions";
import { createTankPreset, deleteTankPreset, queryTankPresets, updateTankPreset } from "@/db/tank";
import { tankSettingsSchema } from "@/forms/tank";


export const view = (req: MulmRequest, res: Response) => {
	return res.render("bapForm/tank", {
		form: req.query,
		errors: new Map<string, string>(),
	});
}


export const create = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	const memberId = viewer.id;

	const errors = new Map<string, string>();
	const parsed = tankSettingsSchema.safeParse(req.body);
	if (!validateFormResult(parsed, errors)) {
		return;
	}

	// TODO handle getting name[Symbol]..

	await createTankPreset({
		...parsed.data,
		member_id: memberId,
	});

	res.send("Saved!");
}


export const update = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	const memberId = viewer.id;

	const errors = new Map<string, string>();
	const parsed = tankSettingsSchema.safeParse(req.body);
	if (!validateFormResult(parsed, errors)) {
		return;
	}

	await updateTankPreset({
		...parsed.data,
		member_id: memberId,
	});

	res.send("Saved!");
}


export const remove = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	const memberId = viewer.id;
	const name = req.params.name;
	await deleteTankPreset(memberId, name);
	res.send();
}


export function saveTankForm(req: MulmRequest, res: Response) {
	res.render("bapForm/saveTankForm", {
		errors: new Map<string, string>(),
		form: {},
	});
}


export async function loadTankList(req: MulmRequest, res: Response) {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}
	const memberId = viewer.id;
	const presets = await queryTankPresets(memberId);


	const filtered = presets.map(
		preset => Object.fromEntries(
			Object.entries(preset)
				.filter(([, v]) => v !== null))
	);

	res.render("bapForm/loadTankList", {
		presets: filtered,
	});
}

