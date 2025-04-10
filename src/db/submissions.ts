import { ApprovalFormValues } from "../forms/approval";
import { FormValues } from "../forms/submission";
import { getWriteDBConnecton, query } from "./conn";

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
	water_type: string;
	count: string;
	reproduction_date: string;

	foods: string;
	spawn_locations: string;

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

	submitted_on?: string;
	approved_on?: string;
	approved_by?: number;
	points?: number;
	total_points?: number;

};


export function createSubmission(memberId: number, form: FormValues, submit: boolean) {
	try {
		const conn = getWriteDBConnecton();

		const program = (() => {
			switch (form.species_type) {
				case "Fish":
				case "Invert":
					return "fish";
				case "Plant":
					return "plant";
				case "Coral":
					return "coral";
				default:
					console.log("Unknown species type: ", form.species_type);
					throw new Error("Unknown species type");
			}
		})();

		const arrayToJSON = (formField: unknown) => {
			if (Array.isArray(formField)) {
				return JSON.stringify(formField.filter(v => v !== ""));
			}
			return undefined;
		}

		const entries = {
			member_id: memberId,
			program,
			...form,
			submitted_on: submit ? new Date().toISOString() : null,
			member_name: undefined,
			member_email: undefined,
			foods: arrayToJSON(form.foods),
			spawn_locations: arrayToJSON(form.spawn_locations),
			supplement_type: arrayToJSON(form.supplement_type),
			supplement_regimen: arrayToJSON(form.supplement_regimen),
		};

		const fields = [];
		const values = [];
		const marks = [];
		for (const [field, value] of Object.entries(entries)) {
			if (value === undefined) {
				continue;
			}
			fields.push(field);
			values.push(value);
			marks.push('?');
		}

		const stmt = conn.prepare(`
			INSERT INTO submissions
			(${fields.join(', ')})
			VALUES
			(${marks.join(', ')})`
		);

		const result = stmt.run(values);
		conn.close();
		return result.lastInsertRowid;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to add submission");
	}
}


export function getSubmissionsByMember(memberId: number, includeUnsubmitted: boolean, includeUnapproved: boolean) {
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

	return query<Submission>(expr,	[memberId]);
}


export function getSubmissionById(id: number) {
	const result = query<Submission>(`
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
	`, [
		startDate.toISOString(),
		endDate.toISOString(),
		program
	]);
}


export function getOutstandingSubmissions(program: string) {
	return query<Submission>(`
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
		[program]
	);
}

export function getOutstandingSubmissionsCounts() {
	const rows = query<{ count: number, program: string }>(`
		SELECT COUNT(1) as count, program
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE submitted_on IS NOT NULL
		AND approved_on IS NULL
		GROUP BY program`,
	);
	return Object.fromEntries(rows.map(row => [ row.program, row.count ]))
}

export function getApprovedSubmissions(program: string) {
	return query<Submission & Required<Pick<Submission, "submitted_on" | "approved_on" | "points" | "total_points">>>(`
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
		[program]
	);
}


export function getAllSubmissions(program: string) {
	return query<Submission>(`
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
		FROM submissions WHERE program = ? `, [program]);
}


export function updateSubmission(id: number, updates: Partial<Submission>) {
	const fields = Object.keys(updates);
	const values = Object.values(updates);
	const setClause = fields.map(field => `${field} = ?`).join(', ');

	try {
		const conn = getWriteDBConnecton();
		const stmt = conn.prepare(`UPDATE submissions SET ${setClause} WHERE id = ?`);
		const result = stmt.run(...values, id);
		conn.close();
		return result.changes;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to update submission");
	}
}


export function approveSubmission(approvedBy: number, id: number, updates: ApprovalFormValues) {
	try {
		const conn = getWriteDBConnecton();
		const { points, article_points, first_time_species, flowered, sexual_reproduction } = updates;
		const stmt = conn.prepare(`
			UPDATE submissions SET
				points = ?,
				article_points = ?,
				first_time_species = ?,
				flowered = ?,
				sexual_reproduction = ?,
				approved_by = ?,
				approved_on = ?
			WHERE id = ?`);
		stmt.run(
			points,
			article_points,
			first_time_species ? 1 : 0,
			flowered ? 1 : 0,
			sexual_reproduction ? 1 : 0,
			approvedBy,
			new Date().toISOString(),
			id);
		conn.close();
	} catch (err) {
		console.error(err);
		throw new Error("Failed to update submission");
	}
}
