/**
 * IUCN Red List Database Operations
 *
 * Functions for managing IUCN conservation status data in the database.
 * Follows database best practices from src/db/README.md
 */

import type { Database } from "sqlite";
import type { IUCNCategory, PopulationTrend } from "@/integrations/iucn";
import { logger } from "@/utils/logger";

/**
 * IUCN data to be stored/updated
 */
export interface IUCNData {
  category: IUCNCategory;
  taxonId?: number;
  populationTrend?: PopulationTrend;
  url?: string;
}

/**
 * Sync status types for tracking sync attempts
 */
export type SyncStatus = "success" | "not_found" | "api_error" | "rate_limited" | "csv_import";

/**
 * Sync log entry from iucn_sync_log table
 */
export interface IUCNSyncLogEntry {
  id: number;
  group_id: number;
  sync_date: string;
  status: SyncStatus;
  category_found: string | null;
  error_message: string | null;
}

/**
 * Species with missing IUCN data
 */
export interface SpeciesWithMissingIUCN {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  program_class: string;
}

/**
 * Species needing resync (old data)
 */
export interface SpeciesNeedingResync {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  iucn_redlist_category: IUCNCategory;
  iucn_last_updated: string;
  days_since_update: number;
}

/**
 * IUCN sync statistics
 */
export interface IUCNSyncStats {
  total_syncs: number;
  successful_syncs: number;
  not_found_count: number;
  error_count: number;
  last_sync_date: string | null;
}

/**
 * Update IUCN data for a species group
 *
 * @param db - Database connection
 * @param groupId - Species group ID
 * @param data - IUCN data to update
 * @returns Number of rows affected (should be 1)
 * @throws {Error} If species group not found or database error
 */
export async function updateIucnData(
  db: Database,
  groupId: number,
  data: IUCNData
): Promise<number> {
  try {
    const now = new Date().toISOString();

    const updates: string[] = ["iucn_redlist_category = ?", "iucn_last_updated = ?"];
    const values: (string | number | null)[] = [data.category, now];

    if (data.taxonId !== undefined) {
      updates.push("iucn_redlist_id = ?");
      values.push(data.taxonId);
    }

    if (data.populationTrend !== undefined) {
      updates.push("iucn_population_trend = ?");
      values.push(data.populationTrend);
    }

    if (data.url !== undefined) {
      updates.push("iucn_redlist_url = ?");
      values.push(data.url);
    }

    values.push(groupId);

    const stmt = await db.prepare(
      `UPDATE species_name_group
       SET ${updates.join(", ")}
       WHERE group_id = ?`
    );

    try {
      const result = await stmt.run(...values);

      if (!result.changes || result.changes === 0) {
        throw new Error(`Species group ${groupId} not found`);
      }

      return result.changes;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("CHECK constraint")) {
      logger.error("Invalid IUCN data", { groupId, data, error: err.message });
      throw new Error(`Invalid IUCN category or population trend`);
    }
    if (err instanceof Error && err.message.includes("not found")) {
      throw err; // Rethrow our own "not found" error
    }
    logger.error("Failed to update IUCN data", { groupId, error: err });
    throw new Error("Failed to update IUCN data");
  }
}

/**
 * Record a sync attempt in the iucn_sync_log table
 *
 * @param db - Database connection
 * @param groupId - Species group ID
 * @param status - Sync status
 * @param data - IUCN data if found (optional)
 * @param errorMessage - Error message if failed (optional)
 * @returns ID of the created log entry
 * @throws {Error} If database error occurs
 */
export async function recordIucnSync(
  db: Database,
  groupId: number,
  status: SyncStatus,
  data?: IUCNData,
  errorMessage?: string
): Promise<number> {
  try {
    const now = new Date().toISOString();

    const stmt = await db.prepare(
      `INSERT INTO iucn_sync_log (group_id, sync_date, status, category_found, error_message)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`
    );

    try {
      const result = await stmt.get<{ id: number }>(
        groupId,
        now,
        status,
        data?.category || null,
        errorMessage || null
      );
      return result!.id;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error("Failed to record IUCN sync", { groupId, status, error: err });
    throw new Error("Failed to record sync log");
  }
}

/**
 * Get sync log entries
 *
 * @param db - Database connection
 * @param groupId - Filter by species group ID (optional)
 * @param limit - Max number of entries to return (optional)
 * @returns Array of sync log entries, most recent first
 */
export async function getIucnSyncLog(
  db: Database,
  groupId?: number,
  limit?: number
): Promise<IUCNSyncLogEntry[]> {
  let query = `
    SELECT id, group_id, sync_date, status, category_found, error_message
    FROM iucn_sync_log
  `;

  const params: (number | undefined)[] = [];

  if (groupId !== undefined) {
    query += " WHERE group_id = ?";
    params.push(groupId);
  }

  query += " ORDER BY id DESC";

  if (limit !== undefined) {
    query += " LIMIT ?";
    params.push(limit);
  }

  return await db.all(query, params);
}

/**
 * Get species that don't have IUCN data yet
 *
 * @param db - Database connection
 * @returns Array of species without IUCN data
 */
export async function getSpeciesWithMissingIucn(
  db: Database
): Promise<SpeciesWithMissingIUCN[]> {
  return await db.all(`
    SELECT group_id, canonical_genus, canonical_species_name, program_class
    FROM species_name_group
    WHERE iucn_redlist_category IS NULL
    ORDER BY canonical_genus, canonical_species_name
  `);
}

/**
 * Get species that have old IUCN data needing resync
 *
 * @param db - Database connection
 * @param daysOld - Consider data stale after this many days
 * @returns Array of species with stale IUCN data
 */
export async function getSpeciesNeedingResync(
  db: Database,
  daysOld: number
): Promise<SpeciesNeedingResync[]> {
  return await db.all(
    `
    SELECT
      group_id,
      canonical_genus,
      canonical_species_name,
      iucn_redlist_category,
      iucn_last_updated,
      CAST((julianday('now') - julianday(iucn_last_updated)) AS INTEGER) as days_since_update
    FROM species_name_group
    WHERE iucn_redlist_category IS NOT NULL
      AND iucn_last_updated IS NOT NULL
      AND julianday('now') - julianday(iucn_last_updated) > ?
    ORDER BY iucn_last_updated ASC
    `,
    [daysOld]
  );
}

/**
 * Get statistics about IUCN sync operations
 *
 * @param db - Database connection
 * @returns Sync statistics
 */
export async function getIucnSyncStats(db: Database): Promise<IUCNSyncStats> {
  const stats = await db.get<IUCNSyncStats>(`
    SELECT
      COUNT(*) as total_syncs,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_syncs,
      SUM(CASE WHEN status = 'not_found' THEN 1 ELSE 0 END) as not_found_count,
      SUM(CASE WHEN status IN ('api_error', 'rate_limited') THEN 1 ELSE 0 END) as error_count,
      MAX(sync_date) as last_sync_date
    FROM iucn_sync_log
  `);

  if (!stats) {
    return {
      total_syncs: 0,
      successful_syncs: 0,
      not_found_count: 0,
      error_count: 0,
      last_sync_date: null,
    };
  }

  return {
    total_syncs: stats.total_syncs || 0,
    successful_syncs: stats.successful_syncs || 0,
    not_found_count: stats.not_found_count || 0,
    error_count: stats.error_count || 0,
    last_sync_date: stats.last_sync_date || null,
  };
}

// ============================================================================
// Canonical Name Recommendations
// ============================================================================

/**
 * Status of a canonical name recommendation
 */
export type RecommendationStatus = "pending" | "accepted" | "rejected";

/**
 * Canonical name recommendation entry
 */
export interface CanonicalRecommendation {
  id: number;
  group_id: number;
  current_canonical_genus: string;
  current_canonical_species: string;
  suggested_canonical_genus: string;
  suggested_canonical_species: string;
  iucn_taxon_id: number;
  iucn_url: string | null;
  reason: string;
  status: RecommendationStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: number | null;
}

/**
 * Create a new canonical name recommendation
 *
 * @param db - Database connection
 * @param recommendation - Recommendation data
 * @returns ID of the created recommendation
 * @throws {Error} If database error occurs or duplicate pending recommendation exists
 */
export async function createCanonicalRecommendation(
  db: Database,
  recommendation: {
    groupId: number;
    currentGenus: string;
    currentSpecies: string;
    suggestedGenus: string;
    suggestedSpecies: string;
    iucnTaxonId: number;
    iucnUrl?: string;
    reason: string;
  }
): Promise<number> {
  try {
    const stmt = await db.prepare(
      `INSERT INTO iucn_canonical_recommendations (
        group_id,
        current_canonical_genus,
        current_canonical_species,
        suggested_canonical_genus,
        suggested_canonical_species,
        iucn_taxon_id,
        iucn_url,
        reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`
    );

    try {
      const result = await stmt.get<{ id: number }>(
        recommendation.groupId,
        recommendation.currentGenus,
        recommendation.currentSpecies,
        recommendation.suggestedGenus,
        recommendation.suggestedSpecies,
        recommendation.iucnTaxonId,
        recommendation.iucnUrl || null,
        recommendation.reason
      );
      return result!.id;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
      throw new Error(`Pending recommendation already exists for group ${recommendation.groupId}`);
    }
    logger.error("Failed to create canonical recommendation", {
      recommendation,
      error: err,
    });
    throw new Error("Failed to create canonical recommendation");
  }
}

/**
 * Get canonical name recommendations
 *
 * @param db - Database connection
 * @param filters - Optional filters
 * @returns Array of recommendations
 */
export async function getCanonicalRecommendations(
  db: Database,
  filters?: {
    groupId?: number;
    status?: RecommendationStatus;
    limit?: number;
  }
): Promise<CanonicalRecommendation[]> {
  let query = `
    SELECT
      id,
      group_id,
      current_canonical_genus,
      current_canonical_species,
      suggested_canonical_genus,
      suggested_canonical_species,
      iucn_taxon_id,
      iucn_url,
      reason,
      status,
      created_at,
      reviewed_at,
      reviewed_by
    FROM iucn_canonical_recommendations
  `;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters?.groupId !== undefined) {
    conditions.push("group_id = ?");
    params.push(filters.groupId);
  }

  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY created_at DESC";

  if (filters?.limit) {
    query += " LIMIT ?";
    params.push(filters.limit);
  }

  return await db.all(query, params);
}

/**
 * Accept a canonical name recommendation and apply the change
 *
 * This updates the species group's canonical name and adds the old name as a synonym.
 *
 * @param db - Database connection
 * @param recommendationId - ID of the recommendation to accept
 * @param reviewedBy - Member ID of the admin accepting the recommendation
 * @returns true if successful
 * @throws {Error} If recommendation not found or database error
 */
export async function acceptCanonicalRecommendation(
  db: Database,
  recommendationId: number,
  reviewedBy: number
): Promise<boolean> {
  try {
    // Get the recommendation
    const rec = await db.get<CanonicalRecommendation>(
      `SELECT * FROM iucn_canonical_recommendations WHERE id = ? AND status = 'pending'`,
      [recommendationId]
    );

    if (!rec) {
      throw new Error(`Pending recommendation ${recommendationId} not found`);
    }

    // Perform the update in a transaction
    await db.run("BEGIN TRANSACTION");

    try {
      const now = new Date().toISOString();

      // 1. Update the canonical name in species_name_group
      const updateResult = await db.run(
        `UPDATE species_name_group
         SET canonical_genus = ?,
             canonical_species_name = ?
         WHERE group_id = ?`,
        [rec.suggested_canonical_genus, rec.suggested_canonical_species, rec.group_id]
      );

      if (!updateResult.changes || updateResult.changes === 0) {
        throw new Error(`Species group ${rec.group_id} not found`);
      }

      // 2. Add old canonical name as a scientific name synonym (if not already present)
      const oldScientificName = `${rec.current_canonical_genus} ${rec.current_canonical_species}`;
      const existingSynonym = await db.get<{ scientific_name_id: number }>(
        `SELECT scientific_name_id FROM species_scientific_name
         WHERE group_id = ? AND scientific_name = ?`,
        [rec.group_id, oldScientificName]
      );

      if (!existingSynonym) {
        await db.run(
          `INSERT INTO species_scientific_name (group_id, scientific_name)
           VALUES (?, ?)`,
          [rec.group_id, oldScientificName]
        );
      }

      // 3. Mark recommendation as accepted
      await db.run(
        `UPDATE iucn_canonical_recommendations
         SET status = 'accepted',
             reviewed_at = ?,
             reviewed_by = ?
         WHERE id = ?`,
        [now, reviewedBy, recommendationId]
      );

      await db.run("COMMIT");
      return true;
    } catch (err) {
      await db.run("ROLLBACK");
      throw err;
    }
  } catch (err) {
    logger.error("Failed to accept canonical recommendation", {
      recommendationId,
      reviewedBy,
      error: err,
    });
    // Re-throw our own errors with their original messages
    if (err instanceof Error && err.message.includes("not found")) {
      throw err;
    }
    throw new Error("Failed to accept canonical recommendation");
  }
}

/**
 * Reject a canonical name recommendation
 *
 * @param db - Database connection
 * @param recommendationId - ID of the recommendation to reject
 * @param reviewedBy - Member ID of the admin rejecting the recommendation
 * @returns true if successful
 * @throws {Error} If recommendation not found or database error
 */
export async function rejectCanonicalRecommendation(
  db: Database,
  recommendationId: number,
  reviewedBy: number
): Promise<boolean> {
  try {
    const now = new Date().toISOString();

    const result = await db.run(
      `UPDATE iucn_canonical_recommendations
       SET status = 'rejected',
           reviewed_at = ?,
           reviewed_by = ?
       WHERE id = ? AND status = 'pending'`,
      [now, reviewedBy, recommendationId]
    );

    if (!result.changes || result.changes === 0) {
      throw new Error(`Pending recommendation ${recommendationId} not found`);
    }

    return true;
  } catch (err) {
    logger.error("Failed to reject canonical recommendation", {
      recommendationId,
      reviewedBy,
      error: err,
    });
    // Re-throw our own errors with their original messages
    if (err instanceof Error && err.message.includes("not found")) {
      throw err;
    }
    throw new Error("Failed to reject canonical recommendation");
  }
}
