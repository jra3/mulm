import { FormValues } from "../submissionSchema";
import { getWriteDBConnecton, query } from "./conn";

export type Submission = {
	id: number;

	created_on: Date;
	updated_on: Date;

	member_id: number;
	member_name: string;

	species_type: string;
	species_class: string;
	species_common_name: string;
	species_latin_name: string;
	water_type: string;
	count: string;
	submission_date: string;

	tank_size: string;
	filter_type: string;
	water_change_volume: string;
	water_change_frequency: string;
	temperature: string;
	pH: string;
	GH?: string;
	specific_gravity?: string;
	substrate_type: string;
	substrate_depth: string;
	substrate_color: string;

	submitted_on?: Date;
	approved_on?: Date;
	approved_by?: string;
	points?: number;
};

export function addSubmission(memberId: number, form: FormValues, submit: boolean) {
	try {
		const conn = getWriteDBConnecton();
		const program = (() => {
			switch (form.speciesType) {
				case "Fish":
				case "Invert":
					return "fish";
				case "Plant":
					return "plant";
				case "Coral":
					return "coral";
			}
		})();

		const stmt = conn.prepare(`
			INSERT INTO submissions
			(
				member_id,
				program,
				species_type,
				species_class,
				species_common_name,
				species_latin_name,
				water_type,
				count,

				tank_size,
				filter_type,
				water_change_volume,
				water_change_frequency,
				temperature,
				pH,
				GH,
				specific_gravity,
				substrate_type,
				substrate_depth,
				substrate_color,

				submitted_on
			)
			VALUES
			(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);

		stmt.run(
			memberId,
			program,
			form.speciesType,
			form.speciesClass,
			form.speciesCommonName,
			form.speciesLatinName,
			form.waterType,
			form.count,
			form.tankSize,
			form.filterType,

			form.changeVolume,
			form.changeFrequency,
			form.temperature,
			form.pH,
			form.GH,
			form.specificGravity,
			form.substrateType,
			form.substrateDepth,
			form.substrateColor,

			submit ? new Date().toISOString() : null,
		);
		conn.close();
	} catch (err) {
		console.error(err);
		throw new Error("Failed to add submission");
	}
}

export function getSubmissionsByMember(memberId: number) {
	return query<Submission>(`
		SELECT submissions.*, members.name as member_name
		FROM submissions LEFT JOIN members
		ON submissions.member_id == members.id
		WHERE submissions.member_id = ?`,
		[memberId]);
}

export function getSubmissionById(id: number) {
	const result = query<Submission>(`
		SELECT submissions.*, members.name as member_name
		FROM submissions LEFT JOIN members
		ON submissions.member_id == members.id
		WHERE submissions.id = ?`,
		[id]);
	return result.pop();
}

export function deleteSubmission(id: number) {
	try {
		const conn = getWriteDBConnecton()
		const deleteRow = conn.prepare('DELETE FROM submissions WHERE id = ?');
		const result = deleteRow.run(id);
		return result;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to delete submission");
	}
}

export function getApprovedSubmissionsInDateRange(startDate: Date, endDate: Date, program: string) {
	return query<Submission>(`
		SELECT * FROM submissions
		WHERE submitted_on > ? AND submitted_on < ?
		AND approved_on IS NOT NULL AND points IS NOT NULL
		AND program = ?
	`, [
		startDate.toISOString(),
		endDate.toISOString(),
		program
	]);
}

export function getOutstandingSubmissions(program: string) {
	return query<Submission>(`
		SELECT * FROM submissions
		WHERE submitted_on IS NOT NULL
		AND approved_on IS NULL
		AND program = ?`,
		[program]
	);
}

export function getApprovedSubmissions(program: string) {
	return query<Submission & Required<Pick<Submission, "submitted_on" | "approved_on" | "points">>>(`
		SELECT * FROM submissions
		WHERE submitted_on IS NOT NULL
		AND approved_on IS NOT NULL
		AND points IS NOT NULL
		AND program = ?`,
		[program]
	);
}

export function getAllSubmissions(program: string) {
	return query<Submission>("SELECT * FROM submissions WHERE program = ?", [program]);
}

export function approveSubmission(id: number, points: number, approvedBy: string) {
	try {
		const conn = getWriteDBConnecton();
		const stmt = conn.prepare(`UPDATE submissions SET points = ?, approved_by = ?, approved_on = ? WHERE id = ?`);
		stmt.run(points, approvedBy, new Date().toISOString(), id);
		conn.close();
	} catch (err) {
		console.error(err);
		throw new Error("Failed to update submission");
	}
}

