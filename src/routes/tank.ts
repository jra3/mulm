import { Response } from 'express';
import { validateFormResult } from "@/forms/utils";
import { MulmRequest } from "@/sessions";
import { createTankPreset, deleteTankPreset, getTankPreset, updateTankPreset } from "@/db/tank";
import { tankSettingsSchema } from "@/forms/tank";


export const view = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	const memberId = viewer.id;
	const name = req.params.name;

	const tank = await getTankPreset(memberId, name);

	return res.render("bapForm/tank", { tank });
}

export const create = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	const memberId = viewer.id;
	const name = req.params.name;

	const errors = new Map<string, string>();
	const parsed = tankSettingsSchema.safeParse(req.body);
	if (!validateFormResult(parsed, errors)) {
		return;
	}

	// TODO handle getting name[Symbol]..

	await createTankPreset({
		...parsed.data,
		member_id: memberId,
		preset_name: name,
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
	const name = req.params.name;

	const errors = new Map<string, string>();
	const parsed = tankSettingsSchema.safeParse(req.body);
	if (!validateFormResult(parsed, errors)) {
		return;
	}

	await updateTankPreset({
		...parsed.data,
		member_id: memberId,
		preset_name: name,
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
	// TODO What do i sent back
	res.send();
}
