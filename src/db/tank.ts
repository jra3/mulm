import { deleteOne, insertOne, query, updateOne } from "./conn";

const tableName = "tank_presets";

type Tank = {
	member_id: number;
	preset_name: string
	tank_size: string | null;
	water_change_volume: string | null;
	water_change_frequency: string | null;
	temperature: string | null;
	ph: string | null;
	gh: string | null;
	specific_gravity: string | null;
	substrate_type: string | null;
	substrate_depth: string | null;
	substrate_color: string | null;

	created_on: string;
	updated_on: string;
};

export async function createTankPreset(tank: Omit<Tank, "created_on" | "updated_on">) {
	return insertOne(tableName, tank);
}

export async function updateTankPreset(tank: Partial<Tank> & { member_id: number, preset_name: string }) {
	return updateOne(
		tableName,
		{ member_id: tank.member_id, preset_name: tank.preset_name },
		{
			updated_on: new Date().toISOString(),
			...tank,
		},
	);
}

export async function queryTankPresets(memberId: number) {
	return query<Tank>(
		`SELECT * FROM ${tableName} WHERE member_id = ? ORDER BY preset_name`,
		[memberId],
	);
}

export async function getTankPreset(memberId: number, presetName: string) {
	const rows = await query<Tank>(
		`SELECT * FROM ${tableName} WHERE member_id = ? AND preset_name = ?`,
		[memberId, presetName],
	);
	return rows.pop();
}

export async function deleteTankPreset(memberId: number, name: string) {
	return deleteOne(tableName, { member_id: memberId, preset_name: name });
}
