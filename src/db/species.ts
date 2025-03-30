import { getWriteDBConnecton } from "./conn";
import { v4 as uuidv4 } from "uuid";

export type KnownSpecies = {
	latin_name: string;
	common_name: string;
	first_submission: number;
	species_id: string;
};

/**
 * returns a non-zero value if a new species name was created.
 */
export function assureSpecies(
	latinName: string,
	commonName: string,
	submissionId: number,
) {
	try {
		const conn = getWriteDBConnecton()
		const insertStmt = conn.prepare(`
			INSERT INTO known_species
			(latin_name, common_name, first_submission, species_id)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(latin_name, common_name) DO NOTHING;
		`);

		const result = insertStmt.run(latinName, commonName, submissionId, uuidv4());
		return result.lastInsertRowid;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to record known species");
	}
}

export function mergeSpecies(authoritativeId: number, alternateId: number) {
	try {
		const conn = getWriteDBConnecton()
		const insertStmt = conn.prepare(`
			INSERT INTO known_species_assoc
			(authoritative_id, alternate_id)
			VALUES (?, ?);
		`);

		const result = insertStmt.run(authoritativeId, alternateId);
		return result.lastInsertRowid;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to merge species");
	}
}

export function updateAuthoritativeSpecies(currentId: number, newId: number) {
	try {
		const conn = getWriteDBConnecton()
		const updateStmt = conn.prepare(`
			UPDATE known_specied_assoc
			SET authoritative_id = ?
			WHERE authoritative_id = ?;
		`);
		updateStmt.run(newId, currentId);
	} catch (err) {
		console.error(err);
		throw new Error("Failed to update authoritative speies");
	}
}

