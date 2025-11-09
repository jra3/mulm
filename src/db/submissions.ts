import { ApprovalFormValues } from "@/forms/approval";
import { FormValues } from "@/forms/submission";
import { writeConn, query, withTransaction } from "./conn";
import { logger } from "@/utils/logger";
import { ValidationError, AuthorizationError, StateError } from "@/utils/errors";

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
  common_name_id: number | null;
  scientific_name_id: number | null;
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
  witness_verification_status: "pending" | "confirmed" | "declined";

  denied_on: string | null;
  denied_by: number | null;
  denied_reason: string | null;

  changes_requested_on: string | null;
  changes_requested_by: number | null;
  changes_requested_reason: string | null;

  is_cares_species?: number | null;
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
        logger.warn("Unknown species type", form.species_type);
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
    witness_verification_status: submit ? ("pending" as const) : undefined,
    ...form,
    member_name: undefined,
    member_email: undefined,
    foods: arrayToJSON(form.foods),
    spawn_locations: arrayToJSON(form.spawn_locations),
    // Note: supplements are excluded - they're saved to submission_supplements table
    supplement_type: undefined,
    supplement_regimen: undefined,
  };
}

export async function createSubmission(memberId: number, form: FormValues, submit: boolean) {
  try {
    return await withTransaction(async (db) => {
      // Prepare submission data (excluding supplements - they go to normalized table)
      const entries = formToDB(memberId, form, submit);

      // Extract supplements before inserting
      const supplementTypes = form.supplement_type;
      const supplementRegimens = form.supplement_regimen;

      // Remove supplements from entries (they'll go to normalized table)
      delete entries.supplement_type;
      delete entries.supplement_regimen;

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

      const stmt = await db.prepare(`
        INSERT INTO submissions
        (${fields.join(", ")})
        VALUES
        (${marks.join(", ")})`);

      const result = await stmt.run(values);
      await stmt.finalize();

      const submissionId = result.lastID as number;

      // Save supplements to normalized table
      if (Array.isArray(supplementTypes) && Array.isArray(supplementRegimens)) {
        const supplements = [];
        const maxLength = Math.max(supplementTypes.length, supplementRegimens.length);
        for (let i = 0; i < maxLength; i++) {
          const type = supplementTypes[i] || "";
          const regimen = supplementRegimens[i] || "";
          if (type || regimen) {
            supplements.push({ type, regimen });
          }
        }
        if (supplements.length > 0) {
          await setSubmissionSupplements(submissionId, supplements);
        }
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
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.cares_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
			members.display_name as member_name,
			sng.is_cares_species
		FROM submissions
		LEFT JOIN members ON submissions.member_id == members.id
		LEFT JOIN species_common_name cn ON submissions.common_name_id = cn.common_name_id
		LEFT JOIN species_scientific_name scin ON submissions.scientific_name_id = scin.scientific_name_id
		LEFT JOIN species_name_group sng ON (cn.group_id = sng.group_id OR scin.group_id = sng.group_id)
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
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.cares_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
			members.display_name as member_name
		FROM submissions LEFT JOIN members
		ON submissions.member_id == members.id
		WHERE submissions.id = ?`,
    [id]
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
    logger.error("Failed to delete submission", err);
    throw new Error("Failed to delete submission");
  }
}

/**
 * Delete a submission with permission validation
 * @param submissionId - ID of submission to delete
 * @param userId - ID of user attempting deletion
 * @param isAdmin - Whether user is an admin
 * @throws Error if not authorized or submission not found
 */
export async function deleteSubmissionWithAuth(
  submissionId: number,
  userId: number,
  isAdmin: boolean
): Promise<void> {
  try {
    return await withTransaction(async (db) => {
      // Get current submission
      const stmt = await db.prepare(`
        SELECT id, member_id, approved_on
        FROM submissions WHERE id = ?`);
      const current: Submission[] = await stmt.all(submissionId);
      await stmt.finalize();

      if (!current[0]) {
        throw new Error("Submission not found");
      }

      const submission = current[0];

      // Admin can delete anything
      if (isAdmin) {
        const deleteStmt = await db.prepare("DELETE FROM submissions WHERE id = ?");
        await deleteStmt.run(submissionId);
        await deleteStmt.finalize();
        logger.info(`Admin ${userId} deleted submission ${submissionId}`);
        return;
      }

      // Non-admin: must be owner
      if (submission.member_id !== userId) {
        throw new Error("Cannot delete another member's submission");
      }

      // Owner can only delete unapproved submissions
      if (submission.approved_on) {
        throw new Error("Cannot delete approved submissions");
      }

      // Delete allowed
      const deleteStmt = await db.prepare("DELETE FROM submissions WHERE id = ?");
      await deleteStmt.run(submissionId);
      await deleteStmt.finalize();
      logger.info(`Member ${userId} deleted their submission ${submissionId}`);
    });
  } catch (err) {
    logger.error("Failed to delete submission with auth", err);
    throw err;
  }
}

export function getApprovedSubmissionsInDateRange(startDate: Date, endDate: Date, program: string) {
  return query<Submission>(
    `
		SELECT
			submissions.*,
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.cares_species, 0) * 5) +
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
    [startDate.toISOString(), endDate.toISOString(), program]
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
				(IFNULL(submissions.cares_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
			members.display_name as member_name,
			sng.is_cares_species
		FROM submissions
		JOIN members ON submissions.member_id == members.id
		LEFT JOIN species_common_name cn ON submissions.common_name_id = cn.common_name_id
		LEFT JOIN species_scientific_name scin ON submissions.scientific_name_id = scin.scientific_name_id
		LEFT JOIN species_name_group sng ON (cn.group_id = sng.group_id OR scin.group_id = sng.group_id)
		WHERE submitted_on IS NOT NULL
		AND approved_on IS NULL
		AND witness_verification_status = 'confirmed'
		AND program = ?`,
    [program]
  );

  return filterEligibleSubmissions(allWitnessed);
}

export function getWitnessQueue(program: string) {
  return query<Submission>(
    `
		SELECT
			submissions.*,
			members.display_name as member_name,
			sng.is_cares_species
		FROM submissions
		JOIN members ON submissions.member_id == members.id
		LEFT JOIN species_common_name cn ON submissions.common_name_id = cn.common_name_id
		LEFT JOIN species_scientific_name scin ON submissions.scientific_name_id = scin.scientific_name_id
		LEFT JOIN species_name_group sng ON (cn.group_id = sng.group_id OR scin.group_id = sng.group_id)
		WHERE submitted_on IS NOT NULL
		AND witness_verification_status = 'pending'
		AND program = ?
		ORDER BY submitted_on ASC`,
    [program]
  );
}

export function getWaitingPeriodSubmissions(program: string) {
  return query<Submission>(
    `
		SELECT
			submissions.*,
			members.display_name as member_name,
			witnessed_members.display_name as witnessed_by_name,
			sng.is_cares_species
		FROM submissions
		JOIN members ON submissions.member_id == members.id
		LEFT JOIN members as witnessed_members ON submissions.witnessed_by == witnessed_members.id
		LEFT JOIN species_common_name cn ON submissions.common_name_id = cn.common_name_id
		LEFT JOIN species_scientific_name scin ON submissions.scientific_name_id = scin.scientific_name_id
		LEFT JOIN species_name_group sng ON (cn.group_id = sng.group_id OR scin.group_id = sng.group_id)
		WHERE submitted_on IS NOT NULL
		AND witness_verification_status = 'confirmed'
		AND approved_on IS NULL
		AND program = ?
		ORDER BY witnessed_on ASC`,
    [program]
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
  const startTime = Date.now();

  try {
    logger.info("Starting witness confirmation", {
      submissionId,
      witnessAdminId,
      timestamp: new Date().toISOString(),
    });

    return await withTransaction(async (db) => {
      // Check current state and prevent self-witnessing - use transaction db
      const stmt = await db.prepare(`
				SELECT id, member_id, witness_verification_status, species_common_name
				FROM submissions WHERE id = ?`);
      const current: Submission[] = await stmt.all(submissionId);
      await stmt.finalize();

      // Validate submission exists
      if (!current[0]) {
        throw new ValidationError("Submission not found", "submissionId", submissionId);
      }

      const submission = current[0];

      // Validate authorization - prevent self-witnessing
      if (submission.member_id === witnessAdminId) {
        throw new AuthorizationError(
          "Cannot witness your own submission",
          witnessAdminId,
          "confirm_witness"
        );
      }

      // Validate state - must be pending
      if (submission.witness_verification_status !== "pending") {
        throw new StateError(
          "Submission not in pending witness state",
          "pending",
          submission.witness_verification_status
        );
      }

      // Perform update
      const updateStmt = await db.prepare(`
				UPDATE submissions SET
					witnessed_by = ?,
					witnessed_on = ?,
					witness_verification_status = 'confirmed'
				WHERE id = ? AND witness_verification_status = 'pending'`);

      const result = await updateStmt.run(witnessAdminId, new Date().toISOString(), submissionId);
      await updateStmt.finalize();

      // Verify update succeeded (race condition check)
      if (result.changes === 0) {
        throw new StateError("Submission state changed during operation", "pending", "unknown");
      }

      const duration = Date.now() - startTime;
      logger.info("Witness confirmation successful", {
        submissionId,
        witnessAdminId,
        speciesName: submission.species_common_name,
        duration: `${duration}ms`,
      });
    });
  } catch (err) {
    const duration = Date.now() - startTime;

    // Handle custom errors with appropriate logging
    if (
      err instanceof ValidationError ||
      err instanceof AuthorizationError ||
      err instanceof StateError
    ) {
      logger.warn("Witness confirmation failed - business rule violation", {
        submissionId,
        witnessAdminId,
        errorType: err.name,
        errorCode: err.code,
        errorMessage: err.message,
        context: err.context,
        duration: `${duration}ms`,
      });
    } else {
      // System/unexpected errors
      logger.error("Witness confirmation failed - system error", {
        submissionId,
        witnessAdminId,
        error: err instanceof Error ? err.message : String(err),
        duration: `${duration}ms`,
      });
    }

    throw err;
  }
}

export async function declineWitness(submissionId: number, witnessAdminId: number) {
  const startTime = Date.now();

  try {
    logger.info("Starting witness decline", {
      submissionId,
      witnessAdminId,
      timestamp: new Date().toISOString(),
    });

    return await withTransaction(async (db) => {
      // Check current state and prevent self-witnessing - use transaction db
      const stmt = await db.prepare(`
				SELECT id, member_id, witness_verification_status, species_common_name
				FROM submissions WHERE id = ?`);
      const current: Submission[] = await stmt.all(submissionId);
      await stmt.finalize();

      // Validate submission exists
      if (!current[0]) {
        throw new ValidationError("Submission not found", "submissionId", submissionId);
      }

      const submission = current[0];

      // Validate authorization - prevent self-witnessing
      if (submission.member_id === witnessAdminId) {
        throw new AuthorizationError(
          "Cannot witness your own submission",
          witnessAdminId,
          "decline_witness"
        );
      }

      // Validate state - must be pending
      if (submission.witness_verification_status !== "pending") {
        throw new StateError(
          "Submission not in pending witness state",
          "pending",
          submission.witness_verification_status
        );
      }

      // Perform update
      const updateStmt = await db.prepare(`
				UPDATE submissions SET
					witnessed_by = ?,
					witnessed_on = ?,
					witness_verification_status = 'declined'
				WHERE id = ? AND witness_verification_status = 'pending'`);

      const result = await updateStmt.run(witnessAdminId, new Date().toISOString(), submissionId);
      await updateStmt.finalize();

      // Verify update succeeded (race condition check)
      if (result.changes === 0) {
        throw new StateError("Submission state changed during operation", "pending", "unknown");
      }

      const duration = Date.now() - startTime;
      logger.info("Witness decline successful", {
        submissionId,
        witnessAdminId,
        speciesName: submission.species_common_name,
        duration: `${duration}ms`,
      });
    });
  } catch (err) {
    const duration = Date.now() - startTime;

    // Handle custom errors with appropriate logging
    if (
      err instanceof ValidationError ||
      err instanceof AuthorizationError ||
      err instanceof StateError
    ) {
      logger.warn("Witness decline failed - business rule violation", {
        submissionId,
        witnessAdminId,
        errorType: err.name,
        errorCode: err.code,
        errorMessage: err.message,
        context: err.context,
        duration: `${duration}ms`,
      });
    } else {
      // System/unexpected errors
      logger.error("Witness decline failed - system error", {
        submissionId,
        witnessAdminId,
        error: err instanceof Error ? err.message : String(err),
        duration: `${duration}ms`,
      });
    }

    throw err;
  }
}

/**
 * Request changes on a submission (admin action)
 * Validates submission state and sets changes_requested fields
 * Throws errors for invalid states (draft, approved, denied)
 */
export async function requestChanges(
  submissionId: number,
  adminId: number,
  reason: string
): Promise<void> {
  try {
    return await withTransaction(async (db) => {
      // Get current submission state
      const stmt = await db.prepare(`
        SELECT id, submitted_on, approved_on, denied_on
        FROM submissions WHERE id = ?`);
      const current: Submission[] = await stmt.all(submissionId);
      await stmt.finalize();

      if (!current[0]) {
        throw new Error("Submission not found");
      }

      // Validate submission state
      if (!current[0].submitted_on) {
        throw new Error("Cannot request changes on draft submissions");
      }

      if (current[0].approved_on) {
        throw new Error("Cannot request changes on approved submissions");
      }

      if (current[0].denied_on) {
        throw new Error("Cannot request changes on denied submissions");
      }

      // Set changes_requested fields
      const updateStmt = await db.prepare(`
        UPDATE submissions SET
          changes_requested_on = ?,
          changes_requested_by = ?,
          changes_requested_reason = ?
        WHERE id = ?`);

      const result = await updateStmt.run(new Date().toISOString(), adminId, reason, submissionId);
      await updateStmt.finalize();

      if (result.changes === 0) {
        throw new Error("Failed to update submission");
      }

      logger.info(`Changes requested for submission ${submissionId} by admin ${adminId}`);
    });
  } catch (err) {
    logger.error("Failed to request changes", err);
    throw err;
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
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.cares_species, 0) * 5) +
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

export async function approveSubmission(
  approvedBy: number,
  id: number,
  speciesIds: { common_name_id: number; scientific_name_id: number },
  updates: ApprovalFormValues
) {
  try {
    return await withTransaction(async (db) => {
      // Get current submission state
      const stmt = await db.prepare(`
        SELECT id, submitted_on, approved_on, denied_on, witness_verification_status
        FROM submissions WHERE id = ?`);
      const current: Submission[] = await stmt.all(id);
      await stmt.finalize();

      if (!current[0]) {
        throw new Error("Submission not found");
      }

      // Validate submission state
      if (!current[0].submitted_on) {
        throw new Error("Cannot approve draft submissions");
      }

      if (current[0].approved_on) {
        throw new Error("Cannot approve already approved submissions");
      }

      if (current[0].denied_on) {
        throw new Error("Cannot approve denied submissions");
      }

      // Update submission with approval data
      const {
        points,
        article_points,
        first_time_species,
        flowered,
        sexual_reproduction,
        cares_species,
      } = updates;
      const updateStmt = await db.prepare(`
        UPDATE submissions SET
          common_name_id = ?,
          scientific_name_id = ?,
          points = ?,
          article_points = ?,
          first_time_species = ?,
          cares_species = ?,
          flowered = ?,
          sexual_reproduction = ?,
          approved_by = ?,
          approved_on = ?
        WHERE id = ?`);

      const result = await updateStmt.run(
        speciesIds.common_name_id,
        speciesIds.scientific_name_id,
        points,
        article_points,
        first_time_species ? 1 : 0,
        cares_species ? 1 : 0,
        flowered ? 1 : 0,
        sexual_reproduction ? 1 : 0,
        approvedBy,
        new Date().toISOString(),
        id
      );
      await updateStmt.finalize();

      if (result.changes === 0) {
        throw new Error("Failed to update submission");
      }

      logger.info(`Submission ${id} approved by admin ${approvedBy} with ${points} base points`);
    });
  } catch (err) {
    logger.error("Failed to approve submission", err);
    throw err;
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
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.cares_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
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
			submissions.points +
				IFNULL(submissions.article_points, 0) +
				(IFNULL(submissions.first_time_species, 0) * 5) +
				(IFNULL(submissions.cares_species, 0) * 5) +
				(IFNULL(submissions.flowered, 0) * submissions.points) +
				(IFNULL(submissions.sexual_reproduction, 0) * submissions.points)
				as total_points,
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
 * Set supplements for a submission (replaces all existing)
 */
export async function setSubmissionSupplements(
  submissionId: number,
  supplements: Array<{ type: string; regimen: string }>
): Promise<void> {
  try {
    return await withTransaction(async (db) => {
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
    });
  } catch (err) {
    logger.error("Failed to set submission supplements", err);
    throw new Error("Failed to set submission supplements");
  }
}
