import { FormValues } from "@/forms/submission";
import { writeConn, query, withTransaction } from "./conn";
import { logger } from "@/utils/logger";
import { filterQueue, queueSql, type QueueName } from "@/lifecycle/queues";
import { totalPointsSql } from "@/points";
import type { Database } from "sqlite";
import { speciesOfSubmissionJoinSql } from "@/species";

// New normalized table types
export type SubmissionImage = {
  id: number;
  submission_id: number;
  r2_key: string;
  public_url: string;
  file_size: number;
  uploaded_at: string;
  content_type: string;
  display_order: number;
};

export type SubmissionSupplement = {
  id: number;
  submission_id: number;
  supplement_type: string;
  supplement_regimen: string;
  display_order: number;
};

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
  /** The Species the Submission is bound to, or null. */
  species_id: number | null;
  water_type: string;
  count: string;
  reproduction_date: string;

  foods: string;
  spawn_locations: string;
  propagation_method: string | null;
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
  light_type: string | null;
  light_strength: string | null;
  light_hours: string | null;
  co2: string | null;
  co2_description: string | null;
  supplement_type: string;
  supplement_regimen: string;

  notes: string | null;
  images: string | null;
  video_url: string | null;

  submitted_on: string | null;
  approved_on: string | null;
  approved_by: number | null;
  points: number | null;
  total_points?: number;

  article_points?: number | null;
  first_time_species?: boolean | null;
  cares_species?: boolean | null;
  flowered?: boolean | null;
  sexual_reproduction?: boolean | null;

  witnessed_by: number | null;
  witnessed_on: string | null;
  /**
   * `declined` is DEAD. Declining a Witness emailed the member and left the
   * Submission where nothing could move it out; it is deleted, and a committee
   * member who wants more requests changes instead. The value stays in the
   * union because production rows may still carry it - `deriveState` reads
   * those as awaiting a Witness, which makes them actionable again. Nothing
   * writes it.
   */
  witness_verification_status: "pending" | "confirmed" | "declined";

  /**
   * DEAD COLUMNS. The Denied state is deleted: zero denials were ever recorded,
   * the 2009 manual contains no denial language, and requesting changes is the
   * refusal path. Nothing reads or writes these three; they are kept rather
   * than dropped so this change needs no migration, and are candidates for a
   * later one.
   */
  denied_on: string | null;
  denied_by: number | null;
  denied_reason: string | null;

  changes_requested_on: string | null;
  changes_requested_by: number | null;
  changes_requested_reason: string | null;

  final_submission_on: string | null;
  final_submission_reminder_sent_on: string | null;

  is_cares_species?: number | null;
};

/** A Submission as a queue listing shows it, with the joins those pages read. */
export type QueueSubmission = Submission & {
  witnessed_by_name?: string | null;
};

/** The Program a Species type belongs to: Fish and Invert are the fish Program. */
export function programOfSpeciesType(speciesType: string): "fish" | "plant" | "coral" {
  switch (speciesType) {
    case "Fish":
    case "Invert":
      return "fish";
    case "Plant":
      return "plant";
    case "Coral":
      return "coral";
    default:
      logger.warn("Unknown species type", speciesType);
      throw new Error("Unknown species type");
  }
}

/**
 * The form-to-database mapper: a Submission's *contents*, as columns.
 *
 * It maps the form and nothing else. `submitted_on` and
 * `witness_verification_status` are lifecycle columns and are set by the
 * transition that earns them - stamping the Witness `pending` here on every
 * non-draft save is what silently discarded a committee member's confirmed
 * inspection.
 */
export function formToRow(memberId: number, form: FormValues): SubmissionRow {
  const program = form.species_type === undefined ? undefined : programOfSpeciesType(form.species_type);

  const arrayToJSON = (formField: unknown) => {
    if (Array.isArray(formField)) {
      return JSON.stringify(formField.filter((v) => v !== ""));
    }
    return undefined;
  };

  return {
    member_id: memberId,
    program,
    ...form,
    member_name: undefined,
    member_email: undefined,
    // The binding is the lifecycle's to decide (`bindingAfterSave`), never the form's to write.
    species_id: undefined,
    foods: arrayToJSON(form.foods),
    spawn_locations: arrayToJSON(form.spawn_locations),
    // Images and supplements live in their own normalized tables.
    images: undefined,
    supplement_type: undefined,
    supplement_regimen: undefined,
  };
}

/** The columns a write may set. Mapped values, already validated. */
export type SubmissionRow = Record<string, unknown>;

/**
 * Insert a Submission row and its supplements. Takes mapped values; deciding
 * what a new Submission's lifecycle columns should be is the module's job.
 */
export async function createSubmissionRow(
  row: SubmissionRow,
  supplements: Array<{ type: string; regimen: string }> = []
): Promise<number> {
  try {
    return await withTransaction(async (db) => {
      const entries = Object.entries(row).filter(([, value]) => value !== undefined);

      const stmt = await db.prepare(`
        INSERT INTO submissions
        (${entries.map(([field]) => field).join(", ")})
        VALUES
        (${entries.map(() => "?").join(", ")})`);

      const result = await stmt.run(entries.map(([, value]) => value));
      await stmt.finalize();

      const submissionId = result.lastID as number;

      if (supplements.length > 0) {
        await setSubmissionSupplements(submissionId, supplements, db);
      }

      return submissionId;
    });
  } catch (err) {
    logger.error("Failed to add submission", err);
    throw new Error("Failed to add submission");
  }
}

export function getSubmissionsByMember(
  memberId: number,
  includeUnsubmitted: boolean,
  includeUnapproved: boolean
) {
  let expr = `
		SELECT
			submissions.*,
			${totalPointsSql("submissions")} as total_points,
			members.display_name as member_name,
			sng.is_cares_species
		FROM submissions
		LEFT JOIN members ON submissions.member_id == members.id
		${speciesOfSubmissionJoinSql("submissions", "sng")}
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
  const result = await query<Submission>(
    `
		SELECT
			submissions.*,
			${totalPointsSql("submissions")} as total_points,
			members.display_name as member_name
		FROM submissions LEFT JOIN members
		ON submissions.member_id == members.id
		WHERE submissions.id = ?`,
    [id]
  );
  return result.pop();
}

/**
 * Delete a Submission and its child rows.
 *
 * Every foreign key in this schema is unenforced in production - the pragma is
 * set only in tests - so `ON DELETE CASCADE` is decorative and the children go
 * explicitly. Authorization is not this function's business: the lifecycle
 * module decides who may delete what.
 */
export async function deleteSubmissionRow(db: Database, id: number) {
  for (const table of ["submission_images", "submission_supplements", "submission_notes"]) {
    const child = await db.prepare(`DELETE FROM ${table} WHERE submission_id = ?`);
    try {
      await child.run(id);
    } finally {
      await child.finalize();
    }
  }

  const deleteRow = await db.prepare("DELETE FROM submissions WHERE id = ?");
  try {
    return await deleteRow.run(id);
  } finally {
    await deleteRow.finalize();
  }
}

export function getApprovedSubmissionsInDateRange(startDate: Date, endDate: Date, program: string) {
  return query<Submission>(
    `
		SELECT
			submissions.*,
			${totalPointsSql("submissions")} as total_points,
			members.display_name as member_name
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE reproduction_date > ? AND reproduction_date < ?
		AND approved_on IS NOT NULL AND points IS NOT NULL
		AND program = ?
	`,
    [startDate.toISOString(), endDate.toISOString(), program]
  );
}

/**
 * The rows of one queue, for one Program.
 *
 * The membership rule is not written here: `queueSql` states the half a query
 * can express and `filterQueue` applies the per-species waiting period the SQL
 * cannot. This used to be six near-identical predicates, and one of them was
 * missing a condition.
 */
export async function getQueue(queue: QueueName, program: string) {
  const rows = await query<QueueSubmission>(
    `
		SELECT
			submissions.*,
			${totalPointsSql("submissions")} as total_points,
			members.display_name as member_name,
			witnessed_members.display_name as witnessed_by_name,
			sng.is_cares_species
		FROM submissions
		JOIN members ON submissions.member_id == members.id
		LEFT JOIN members as witnessed_members ON submissions.witnessed_by == witnessed_members.id
		${speciesOfSubmissionJoinSql("submissions", "sng")}
		WHERE ${queueSql(queue)}
		AND program = ?
		ORDER BY submissions.submitted_on ASC`,
    [program]
  );

  return filterQueue(queue, rows);
}

/** How many Submissions each Program has in `queue`. */
export async function getQueueCounts(queue: QueueName): Promise<Record<string, number>> {
  const rows = await query<QueueSubmission>(
    `
		SELECT submissions.*, members.display_name as member_name
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE ${queueSql(queue)}`
  );

  const counts: Record<string, number> = {};
  for (const row of filterQueue(queue, rows)) {
    counts[row.program] = (counts[row.program] ?? 0) + 1;
  }
  return counts;
}



/**
 * Idempotently record that the final-submission reminder has been emailed.
 * The `IS NULL` guard makes a concurrent/duplicate send a no-op.
 */
export async function markFinalSubmissionReminderSent(submissionId: number): Promise<void> {
  const stmt = await writeConn.prepare(
    `UPDATE submissions SET final_submission_reminder_sent_on = ?
      WHERE id = ? AND final_submission_reminder_sent_on IS NULL`
  );
  try {
    await stmt.run(new Date().toISOString(), submissionId);
  } finally {
    await stmt.finalize();
  }
}



export function getApprovedSubmissions(program: string) {
  return query<
    Submission &
      Required<Pick<Submission, "submitted_on" | "approved_on" | "points" | "total_points">>
  >(
    `
		SELECT
			submissions.*,
			${totalPointsSql("submissions")} as total_points,
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

type UpdateFor<T> = Partial<{
  [K in keyof T]: T[K] | null | undefined;
}>;

export async function updateSubmission(id: number, updates: UpdateFor<Submission>) {
  const entries = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  );
  const fields = Object.keys(entries);
  const values = Object.values(entries);
  const setClause = fields.map((field) => `${field} = ?`).join(", ");

  try {
    const conn = writeConn;
    const stmt = await conn.prepare(`UPDATE submissions SET ${setClause} WHERE id = ?`);
    try {
      const result = await stmt.run(...values, id);
      return result.changes;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error("Failed to update submission", err);
    throw new Error("Failed to update submission");
  }
}


/**
 * Get all submissions approved today (in local time)
 * @returns Array of approved submissions from today with member names and total points
 */
export function getTodayApprovedSubmissions() {
  return query<
    Submission &
      Required<Pick<Submission, "submitted_on" | "approved_on" | "points" | "total_points">>
  >(
    `
		SELECT
			submissions.*,
			${totalPointsSql("submissions")} as total_points,
			members.display_name as member_name
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE DATE(approved_on) = DATE('now', 'localtime')
		AND approved_on IS NOT NULL
		AND points IS NOT NULL
		ORDER BY approved_on DESC`,
    []
  );
}

/**
 * Get all submissions approved in the last 48 hours
 * @returns Array of approved submissions from the last 48 hours with member names and total points
 */
export function getLast48HoursApprovedSubmissions() {
  return query<
    Submission &
      Required<Pick<Submission, "submitted_on" | "approved_on" | "points" | "total_points">>
  >(
    `
		SELECT
			submissions.*,
			${totalPointsSql("submissions")} as total_points,
			members.display_name as member_name
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE datetime(approved_on) >= datetime('now', '-2 days')
		AND approved_on IS NOT NULL
		AND points IS NOT NULL
		ORDER BY approved_on DESC`,
    []
  );
}

/**
 * Get all submissions approved in the last 30 days
 * @returns Array of approved submissions from the last 30 days with member names and total points
 */
export function getLast30DaysApprovedSubmissions() {
  return query<
    Submission &
      Required<Pick<Submission, "submitted_on" | "approved_on" | "points" | "total_points">>
  >(
    `
		SELECT
			submissions.*,
			${totalPointsSql("submissions")} as total_points,
			members.display_name as member_name
		FROM submissions JOIN members
		ON submissions.member_id == members.id
		WHERE datetime(approved_on) >= datetime('now', '-30 days')
		AND approved_on IS NOT NULL
		AND points IS NOT NULL
		ORDER BY approved_on DESC`,
    []
  );
}

// ============================================================================
// Submission Images - New normalized table functions
// ============================================================================

/**
 * Get all images for a submission
 */
export function getSubmissionImages(submissionId: number): Promise<SubmissionImage[]> {
  return query<SubmissionImage>(
    `SELECT * FROM submission_images
     WHERE submission_id = ?
     ORDER BY display_order ASC`,
    [submissionId]
  );
}

/**
 * Get all images for multiple submissions in one query (avoids N+1 problem)
 * Returns a Map of submissionId -> images[]
 */
export async function getSubmissionImagesForMultiple(
  submissionIds: number[]
): Promise<Map<number, SubmissionImage[]>> {
  if (submissionIds.length === 0) {
    return new Map();
  }

  const placeholders = submissionIds.map(() => "?").join(",");
  const allImages = await query<SubmissionImage>(
    `SELECT * FROM submission_images
     WHERE submission_id IN (${placeholders})
     ORDER BY submission_id, display_order ASC`,
    submissionIds
  );

  // Group images by submission_id
  const imagesBySubmission = new Map<number, SubmissionImage[]>();
  for (const image of allImages) {
    const existing = imagesBySubmission.get(image.submission_id) || [];
    existing.push(image);
    imagesBySubmission.set(image.submission_id, existing);
  }

  return imagesBySubmission;
}

/**
 * Add an image to a submission
 */
export async function addSubmissionImage(
  submissionId: number,
  imageData: Omit<SubmissionImage, "id" | "submission_id" | "display_order">
): Promise<number> {
  try {
    // Get current max display order
    const maxOrder = await query<{ max_order: number | null }>(
      "SELECT MAX(display_order) as max_order FROM submission_images WHERE submission_id = ?",
      [submissionId]
    );
    const nextOrder = (maxOrder[0]?.max_order ?? -1) + 1;

    const stmt = await writeConn.prepare(`
      INSERT INTO submission_images
      (submission_id, r2_key, public_url, file_size, uploaded_at, content_type, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      const result = await stmt.run(
        submissionId,
        imageData.r2_key,
        imageData.public_url,
        imageData.file_size,
        imageData.uploaded_at,
        imageData.content_type,
        nextOrder
      );
      return result.lastID as number;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error("Failed to add submission image", err);
    // Preserve constraint errors for better error messages
    if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
      throw err;
    }
    throw new Error("Failed to add submission image");
  }
}

/**
 * Delete an image from a submission by R2 key
 */
export async function deleteSubmissionImage(
  submissionId: number,
  r2Key: string
): Promise<void> {
  try {
    const stmt = await writeConn.prepare(
      "DELETE FROM submission_images WHERE submission_id = ? AND r2_key = ?"
    );
    try {
      await stmt.run(submissionId, r2Key);
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error("Failed to delete submission image", err);
    throw new Error("Failed to delete submission image");
  }
}

// ============================================================================
// Submission Supplements - New normalized table functions
// ============================================================================

/**
 * Get all supplements for a submission
 */
export function getSubmissionSupplements(
  submissionId: number
): Promise<SubmissionSupplement[]> {
  return query<SubmissionSupplement>(
    `SELECT * FROM submission_supplements
     WHERE submission_id = ?
     ORDER BY display_order ASC`,
    [submissionId]
  );
}

/**
 * Get all supplements for multiple submissions in one query (avoids N+1 problem)
 * Returns a Map of submissionId -> supplements[]
 */
export async function getSubmissionSupplementsForMultiple(
  submissionIds: number[]
): Promise<Map<number, SubmissionSupplement[]>> {
  if (submissionIds.length === 0) {
    return new Map();
  }

  const placeholders = submissionIds.map(() => "?").join(",");
  const allSupplements = await query<SubmissionSupplement>(
    `SELECT * FROM submission_supplements
     WHERE submission_id IN (${placeholders})
     ORDER BY submission_id, display_order ASC`,
    submissionIds
  );

  // Group supplements by submission_id
  const supplementsBySubmission = new Map<number, SubmissionSupplement[]>();
  for (const supplement of allSupplements) {
    const existing = supplementsBySubmission.get(supplement.submission_id) || [];
    existing.push(supplement);
    supplementsBySubmission.set(supplement.submission_id, existing);
  }

  return supplementsBySubmission;
}

/**
 * Internal helper to set supplements within an existing transaction
 */
async function setSubmissionSupplementsInTransaction(
  db: Database,
  submissionId: number,
  supplements: Array<{ type: string; regimen: string }>
): Promise<void> {
  // Delete existing supplements
  const deleteStmt = await db.prepare(
    "DELETE FROM submission_supplements WHERE submission_id = ?"
  );
  await deleteStmt.run(submissionId);
  await deleteStmt.finalize();

  // Insert new supplements
  if (supplements.length > 0) {
    const insertStmt = await db.prepare(`
      INSERT INTO submission_supplements
      (submission_id, supplement_type, supplement_regimen, display_order)
      VALUES (?, ?, ?, ?)
    `);

    for (let i = 0; i < supplements.length; i++) {
      const supp = supplements[i];
      if (supp.type || supp.regimen) {
        // Only insert if at least one field is non-empty
        await insertStmt.run(submissionId, supp.type, supp.regimen, i);
      }
    }

    await insertStmt.finalize();
  }
}

/**
 * Set supplements for a submission (replaces all existing)
 * Can be called standalone or within an existing transaction
 */
export async function setSubmissionSupplements(
  submissionId: number,
  supplements: Array<{ type: string; regimen: string }>,
  db?: Database
): Promise<void> {
  try {
    if (db) {
      // Use existing transaction
      return await setSubmissionSupplementsInTransaction(db, submissionId, supplements);
    } else {
      // Create new transaction
      return await withTransaction(async (transactionDb) => {
        return await setSubmissionSupplementsInTransaction(transactionDb, submissionId, supplements);
      });
    }
  } catch (err) {
    logger.error("Failed to set submission supplements", err);
    throw new Error("Failed to set submission supplements");
  }
}
