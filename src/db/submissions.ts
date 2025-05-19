import { ApprovalFormValues } from "@/forms/approval";
import { FormValues } from "@/forms/submission";
import { writeConn, query } from "./conn";

export type Submission = {
	id: number;
	program: string;

	created_on: Date;
	updated_on: Date;

	member_id: number;
	member_name: string;

	species_type: string;
	species_class: string;
	species_common_name: string;
	species_latin_name: string;
	species_name_id: number | null;
	water_type: string;
	count: string;
	reproduction_date: string;

	foods: string;
	spawn_locations: string;
	tank_size: string | null;
	filter_type: string | null;
	water_change_volume: string | null;
	water_change_frequency: string | null;
	temperature: string | null;
	ph: string | null;
	gh: string | null;
	specific_gravity: string | null;
	substrate_type: string | null;
	substrate_depth: string | null;
	substrate_color: string | null;

	submitted_on: string | null;
	approved_on: string | null;
	approved_by: number | null;
	points: number | null;
	total_points?: number;
};

export function formToDB(memberId: number, form: FormValues, submit: boolean) {
	const program = (() => {
		switch (form.species_type) {
			case "Fish":
			case "Invert":
				return "fish";
			case "Plant":
				return "plant";
			case "Coral":
				return "coral";
			case undefined:
				return undefined;
			default:
				console.log("Unknown species type: ", form.species_type);
				throw new Error("Unknown species type");
		}
	})();

	const arrayToJSON = (formField: unknown) => {
		if (Array.isArray(formField)) {
			return JSON.stringify(formField.filter((v) => v !== ""));
		}
		return undefined;
	};

	return {
		member_id: memberId,
		program,
		submitted_on: submit ? new Date().toISOString() : undefined,
		...form,
		member_name: undefined,
		member_email: undefined,
		foods: arrayToJSON(form.foods),
		spawn_locations: arrayToJSON(form.spawn_locations),
		supplement_type: arrayToJSON(form.supplement_type),
		supplement_regimen: arrayToJSON(form.supplement_regimen),
	};
}

export async function createSubmission(
	memberId: number,
	form: FormValues,
	submit: boolean,
) {
	try {
		const conn = writeConn;
		const entries = formToDB(memberId, form, submit);

		const fields = [];
		const values = [];
		const marks = [];
		for (const [field, value] of Object.entries(entries)) {
			if (value === undefined) {
				continue;
			}
			fields.push(field);
			values.push(value);
			marks.push("?");
		}

		const stmt = await conn.prepare(`
			INSERT INTO submissions
			(${fields.join(", ")})
			VALUES
			(${marks.join(", ")})`);

		const result = await stmt.run(values);
		return result.lastID as number;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to add submission");
	}
}

export function getSubmissionsByMember(
	memberId: string,
	includeUnsubmitted: boolean,
	includeUnapproved: boolean,
) {
	let expr = `
		SELECT
			submissions.*,
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
			members.display_name as member_name
		FROM submissions LEFT JOIN members
		ON submissions.member_id == members.id
		WHERE submissions.member_id = ?`;

	if (!includeUnsubmitted) {
		expr += ` AND submitted_on IS NOT NULL`;
	}

	if (!includeUnapproved) {
		expr += ` AND approved_on IS NOT NULL`;
	}

	return query<Submission>(expr, [memberId]);
}

export async function getSubmissionById(id: number) {
	const result = await query<Submission>(`
		SELECT
			submissions.*,
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
			members.display_name as member_name
		FROM submissions LEFT JOIN members
		ON submissions.member_id == members.id
		WHERE submissions.id = ?`,
		[id],
	);
	return result.pop();
}

export async function deleteSubmission(id: number) {
	try {
		const conn = writeConn;
		const deleteRow = await conn.prepare("DELETE FROM submissions WHERE id = ?");
		return deleteRow.run(id);
	} catch (err) {
		console.error(err);
		throw new Error("Failed to delete submission");
	}
}

export function getApprovedSubmissionsInDateRange(
	startDate: Date,
	endDate: Date,
	program: string,
) {
	return query<Submission>(
		`
		SELECT
			submissions.*,
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
			members.display_name as member_name
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE reproduction_date > ? AND reproduction_date < ?
		AND approved_on IS NOT NULL AND points IS NOT NULL
		AND program = ?
	`,
		[startDate.toISOString(), endDate.toISOString(), program],
	);
}

export function getOutstandingSubmissions(program: string) {
	return query<Submission>(
		`
		SELECT
			submissions.*,
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
			members.display_name as member_name
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE submitted_on IS NOT NULL
		AND approved_on IS NULL
		AND program = ?`,
		[program],
	);
}

export async function getOutstandingSubmissionsCounts() {
	const rows = await query<{ count: number; program: string }>(`
		SELECT COUNT(1) as count, program
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE submitted_on IS NOT NULL
		AND approved_on IS NULL
		GROUP BY program`);
	return Object.fromEntries(rows.map((row) => [row.program, row.count]));
}

export function getApprovedSubmissions(program: string) {
	return query<
		Submission &
			Required<
				Pick<
					Submission,
					"submitted_on" | "approved_on" | "points" | "total_points"
				>
			>
	>(
		`
		SELECT
			submissions.*,
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
			members.display_name as member_name
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE submitted_on IS NOT NULL
		AND approved_on IS NOT NULL
		AND points IS NOT NULL
		AND program = ?`,
		[program],
	);
}

export function getAllSubmissions(program: string) {
	return query<Submission>(
		`
		SELECT
			submissions.*,
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
			members.display_name as member_name
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		FROM submissions WHERE program = ? `,
		[program],
	);
}

type UpdateFor<T> = Partial<{
	[K in keyof T]: T[K] | null | undefined;
}>;

export async function updateSubmission(id: number, updates: UpdateFor<Submission>) {
	const entries = Object.fromEntries(
		Object.entries(updates).filter(([, value]) => value !== undefined),
	);
	const fields = Object.keys(entries);
	const values = Object.values(entries);
	const setClause = fields.map((field) => `${field} = ?`).join(", ");

	try {
		const conn = writeConn;
		const stmt = await conn.prepare(
			`UPDATE submissions SET ${setClause} WHERE id = ?`,
		);
		const result = await stmt.run(...values, id);
		return result.changes;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to update submission");
	}
}

export async function approveSubmission(
	approvedBy: number,
	id: number,
	speciesNameId: number,
	updates: ApprovalFormValues,
) {
	try {
		const conn = writeConn;
		const {
			points,
			article_points,
			first_time_species,
			flowered,
			sexual_reproduction,
		} = updates;
		const stmt = await conn.prepare(`
			UPDATE submissions SET
			  species_name_id = ?,
				points = ?,
				article_points = ?,
				first_time_species = ?,
				flowered = ?,
				sexual_reproduction = ?,
				approved_by = ?,
				approved_on = ?
			WHERE id = ?`);
		await stmt.run(
			speciesNameId,
			points,
			article_points,
			first_time_species ? 1 : 0,
			flowered ? 1 : 0,
			sexual_reproduction ? 1 : 0,
			approvedBy,
			new Date().toISOString(),
			id,
		);
	} catch (err) {
		console.error(err);
		throw new Error("Failed to update submission");
	}
}
