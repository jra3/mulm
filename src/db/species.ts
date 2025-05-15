import { writeConn, query } from "./conn";

type NameSynonym = {
	/** Not a phylogenetic class. The species class for the BAP program */
	program_class: string;
	canonical_genus: string;
	canonical_species_name: string;
	common_name: string;
	/** Typically a simple combination of genus and species */
	latin_name: string;
}

export async function querySpeciesNames() {
	return query<NameSynonym>(`
		SELECT
			species_name_group.group_id as name_group_id,
			species_name_group.program_class as program_class,
			species_name_group.canonical_genus as canonical_genus,
			species_name_group.canonical_species_name as canonical_species_name,
			species_name.common_name as common_name,
			species_name.scientific_name as scientific_name
		FROM species_name_group LEFT JOIN species_name
		ON species_name_group.group_id = species_name.group_id
	`);
}

export async function recordName(data: NameSynonym) {
	const db = writeConn;
	try {
		db.exec('BEGIN TRANSACTION;');
		const groupStmt = await db.prepare(`
			INSERT INTO species_name_group(
				program_class,
				canonical_genus,
				canonical_species_name
			) VALUES (?, ?, ?)
			ON CONFLICT(canonical_genus, canonical_species_name)
			DO UPDATE SET group_id = group_id
			RETURNING group_id;
		`);
		const { group_id } = await groupStmt.get(data.program_class, data.canonical_genus, data.canonical_species_name);
		groupStmt.finalize();

		const nameStmt = await db.prepare(`
			INSERT INTO species_name(
				group_id,
				common_name,
				scientific_name
			)
			VALUES (?, ?, ?)
			ON CONFLICT(common_name, scientific_name)
			DO UPDATE SET group_id = group_id;
		`);
		await nameStmt.run(group_id, data.common_name, data.latin_name);
		nameStmt.finalize();

		await db.exec('COMMIT;');
		return group_id as number;
	} catch (err) {
		await db.exec('ROLLBACK;');
		console.error(err);
		throw new Error("Failed to record species name");
	}
}

export async function mergeSpecies(canonicalGroupId: number, defunctGroupId: number) {
	const db = writeConn;
	try {
		await db.exec('BEGIN TRANSACTION;');

		const updateStmt = await db.prepare(`
			UPDATE species_name
			SET group_id = ?
			WHERE group_id = ?
		`);
		await updateStmt.run(canonicalGroupId, defunctGroupId);

		const deleteStmt = await db.prepare(`
			DELETE FROM species_name_group
			WHERE group_id = ?
		`);
		await deleteStmt.run(defunctGroupId);

		await db.exec('COMMIT;');
	} catch (err) {
		await db.exec('ROLLBACK;');
		console.error(err);
		throw new Error("Failed to merge species groups");
	}

}

export async function getCanonicalSpeciesName(speciesNameId: number) {
	const rows = await query<{
		program_class: string;
		canonical_genus: string;
		canonical_species_name: string;
	}>(`
		SELECT species_name_group.*
		FROM species_name JOIN species_name_group
		ON species_name.group_id = species_name_group.group_id
		WHERE species_name.name_id = ?`,
		[speciesNameId]
	);
	return rows.pop();
}

/*

(async () => {
	await init();

	const entry: NameSynonym = {
		program_class: "Catfish & Loaches",
		canonical_genus: "Corydoras",
		canonical_species_name: "CW010",
		common_name: "Gold Lazer Corys",
		latin_name: "Corydoras CW 10",
	};
	await recordName(entry);
	console.log(await querySpeciesNames());
})();

*/
