import { ApprovalFormValues } from "@/forms/approval";
import { FormValues } from "@/forms/submission";
import { writeConn, query } from "./conn";
import { logger } from "@/utils/logger";

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
	
	article_points?: number | null;
	first_time_species?: boolean | null;
	flowered?: boolean | null;
	sexual_reproduction?: boolean | null;
	
	witnessed_by: number | null;
	witnessed_on: string | null;
	witness_verification_status: 'pending' | 'confirmed' | 'declined';
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
				logger.warn('Unknown species type', form.species_type);
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
		witness_verification_status: submit ? 'pending' as const : undefined,
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

		try {
			const result = await stmt.run(values);
			return result.lastID as number;
		} finally {
			await stmt.finalize();
		}
	} catch (err) {
		logger.error('Failed to add submission', err);
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

	expr += ` ORDER BY submitted_on DESC`;

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
		try {
			return deleteRow.run(id);
		} finally {
			await deleteRow.finalize();
		}
	} catch (err) {
		logger.error('Failed to delete submission', err);
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

export async function getOutstandingSubmissions(program: string) {
	const { filterEligibleSubmissions } = await import("@/utils/waitingPeriod");
	
	const allWitnessed = await query<Submission>(
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
		AND witness_verification_status = 'confirmed'
		AND program = ?`,
		[program],
	);
	
	return filterEligibleSubmissions(allWitnessed);
}

export function getWitnessQueue(program: string) {
	return query<Submission>(
		`
		SELECT
			submissions.*,
			members.display_name as member_name
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE submitted_on IS NOT NULL
		AND witness_verification_status = 'pending'
		AND program = ?
		ORDER BY submitted_on ASC`,
		[program],
	);
}

export function getWaitingPeriodSubmissions(program: string) {
	return query<Submission>(
		`
		SELECT
			submissions.*,
			members.display_name as member_name,
			witnessed_members.display_name as witnessed_by_name
		FROM submissions 
		JOIN members ON submissions.member_id == members.id
		LEFT JOIN members as witnessed_members ON submissions.witnessed_by == witnessed_members.id
		WHERE submitted_on IS NOT NULL
		AND witness_verification_status = 'confirmed'
		AND approved_on IS NULL
		AND program = ?
		ORDER BY witnessed_on ASC`,
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
		AND witness_verification_status = 'confirmed'
		GROUP BY program`);
	return Object.fromEntries(rows.map((row) => [row.program, row.count]));
}

export async function getWitnessQueueCounts() {
	const rows = await query<{ count: number; program: string }>(`
		SELECT COUNT(1) as count, program
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE submitted_on IS NOT NULL
		AND witness_verification_status = 'pending'
		GROUP BY program`);
	return Object.fromEntries(rows.map((row) => [row.program, row.count]));
}

export async function confirmWitness(submissionId: number, witnessAdminId: number) {
	try {
		const conn = writeConn;
		const stmt = await conn.prepare(`
			UPDATE submissions SET
				witnessed_by = ?,
				witnessed_on = ?,
				witness_verification_status = 'confirmed'
			WHERE id = ?`);
		await stmt.run(witnessAdminId, new Date().toISOString(), submissionId);
	} catch (err) {
		logger.error('Failed to confirm witness', err);
		throw new Error("Failed to confirm witness");
	}
}

export async function declineWitness(submissionId: number, witnessAdminId: number) {
	try {
		const conn = writeConn;
		const stmt = await conn.prepare(`
			UPDATE submissions SET
				witnessed_by = ?,
				witnessed_on = ?,
				witness_verification_status = 'declined'
			WHERE id = ?`);
		await stmt.run(witnessAdminId, new Date().toISOString(), submissionId);
	} catch (err) {
		logger.error('Failed to decline witness', err);
		throw new Error("Failed to decline witness");
	}
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
		try {
			const result = await stmt.run(...values, id);
			return result.changes;
		} finally {
			await stmt.finalize();
		}
	} catch (err) {
		logger.error('Failed to update submission', err);
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
		try {
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
		} finally {
			await stmt.finalize();
		}
	} catch (err) {
		logger.error('Failed to update submission', err);
		throw new Error("Failed to update submission");
	}
}
