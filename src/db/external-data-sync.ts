/**
 * External Data Sync Database Operations
 *
 * Functions for managing external species data sync operations (FishBase, Wikipedia, GBIF, etc.)
 * Follows database best practices from src/db/README.md
 */

import type { Database } from "sqlite";
import { logger } from "@/utils/logger";

/**
 * External data source types
 */
export type ExternalDataSource = "fishbase" | "wikipedia" | "gbif" | "iucn_images";

/**
 * Sync status types for tracking sync attempts
 */
export type ExternalSyncStatus = "success" | "error" | "not_found" | "skipped";

/**
 * Sync log entry from external_data_sync_log table
 */
export interface ExternalDataSyncLogEntry {
  id: number;
  group_id: number;
  source: ExternalDataSource;
  sync_date: string;
  status: ExternalSyncStatus;
  links_added: number;
  images_added: number;
  error_message: string | null;
}

/**
 * Species with missing external data
 */
export interface SpeciesWithMissingExternalData {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  submission_count: number;
  last_external_sync: string | null;
}

/**
 * Species needing external data sync (never synced or old data)
 */
export interface SpeciesNeedingExternalSync {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  last_external_sync: string | null;
  days_since_sync: number | null;
}

/**
 * External data sync statistics
 */
export interface ExternalDataSyncStats {
  total_species: number;
  species_with_external_links: number;
  species_with_images: number;
  total_syncs: number;
  successful_syncs: number;
  error_count: number;
  last_sync_date: string | null;
  by_source: Record<ExternalDataSource, {
    total_syncs: number;
    successful_syncs: number;
    last_sync_date: string | null;
  }>;
}

/**
 * Record an external data sync operation
 *
 * @param db - Database connection
 * @param groupId - Species group ID
 * @param source - Data source name
 * @param status - Sync status
 * @param linksAdded - Number of external references added
 * @param imagesAdded - Number of images added
 * @param errorMessage - Optional error message if sync failed
 * @returns ID of the inserted log entry
 */
export async function recordExternalDataSync(
  db: Database,
  groupId: number,
  source: ExternalDataSource,
  status: ExternalSyncStatus,
  linksAdded: number = 0,
  imagesAdded: number = 0,
  errorMessage?: string
): Promise<number> {
  try {
    const now = new Date().toISOString();

    const result = await db.run(
      `INSERT INTO external_data_sync_log
       (group_id, source, sync_date, status, links_added, images_added, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [groupId, source, now, status, linksAdded, imagesAdded, errorMessage || null]
    );

    // Update last_external_sync timestamp on species
    if (status === "success") {
      await db.run(
        `UPDATE species_name_group
         SET last_external_sync = ?
         WHERE group_id = ?`,
        [now, groupId]
      );
    }

    logger.info(
      `Recorded external data sync: source=${source}, group_id=${groupId}, status=${status}`
    );

    return result.lastID!;
  } catch (error) {
    logger.error("Failed to record external data sync", error);
    throw error;
  }
}

/**
 * Get sync log entries for a species
 *
 * @param db - Database connection
 * @param groupId - Species group ID
 * @param source - Optional filter by data source
 * @param limit - Max number of entries to return (default 100)
 * @returns Array of sync log entries, most recent first
 */
export async function getSpeciesSyncLog(
  db: Database,
  groupId: number,
  source?: ExternalDataSource,
  limit = 100
): Promise<ExternalDataSyncLogEntry[]> {
  try {
    let query = `
      SELECT id, group_id, source, sync_date, status,
             links_added, images_added, error_message
      FROM external_data_sync_log
      WHERE group_id = ?
    `;
    const params: (number | string)[] = [groupId];

    if (source) {
      query += ` AND source = ?`;
      params.push(source);
    }

    query += ` ORDER BY sync_date DESC LIMIT ?`;
    params.push(limit);

    const entries = await db.all<ExternalDataSyncLogEntry[]>(query, params);
    return entries;
  } catch (error) {
    logger.error("Failed to get species sync log", error);
    throw error;
  }
}

/**
 * Get all sync log entries (for admin dashboard)
 *
 * @param db - Database connection
 * @param source - Optional filter by data source
 * @param status - Optional filter by status
 * @param limit - Max number of entries to return (default 100)
 * @returns Array of sync log entries, most recent first
 */
export async function getAllSyncLog(
  db: Database,
  source?: ExternalDataSource,
  status?: ExternalSyncStatus,
  limit = 100
): Promise<ExternalDataSyncLogEntry[]> {
  try {
    let query = `
      SELECT id, group_id, source, sync_date, status,
             links_added, images_added, error_message
      FROM external_data_sync_log
      WHERE 1=1
    `;
    const params: (number | string)[] = [];

    if (source) {
      query += ` AND source = ?`;
      params.push(source);
    }

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY sync_date DESC LIMIT ?`;
    params.push(limit);

    const entries = await db.all<ExternalDataSyncLogEntry[]>(query, params);
    return entries;
  } catch (error) {
    logger.error("Failed to get all sync log", error);
    throw error;
  }
}

/**
 * Get species with submissions but missing external data
 *
 * @param db - Database connection
 * @param minSubmissions - Minimum number of submissions (default 1)
 * @returns Array of species that have submissions but no external data
 */
export async function getSpeciesWithMissingExternalData(
  db: Database,
  minSubmissions = 1
): Promise<SpeciesWithMissingExternalData[]> {
  try {
    const species = await db.all<SpeciesWithMissingExternalData[]>(
      `SELECT
         sng.group_id,
         sng.canonical_genus,
         sng.canonical_species_name,
         COUNT(DISTINCT s.submission_id) as submission_count,
         sng.last_external_sync
       FROM species_name_group sng
       INNER JOIN species_scientific_name ssn ON sng.group_id = ssn.group_id
       INNER JOIN submissions s ON s.scientific_name_id = ssn.scientific_name_id
       WHERE s.status = 'approved'
       AND NOT EXISTS (
         SELECT 1 FROM species_external_references ser
         WHERE ser.group_id = sng.group_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM species_images si
         WHERE si.group_id = sng.group_id
       )
       GROUP BY sng.group_id, sng.canonical_genus, sng.canonical_species_name, sng.last_external_sync
       HAVING COUNT(DISTINCT s.submission_id) >= ?
       ORDER BY submission_count DESC, sng.canonical_genus, sng.canonical_species_name`,
      [minSubmissions]
    );

    return species;
  } catch (error) {
    logger.error("Failed to get species with missing external data", error);
    throw error;
  }
}

/**
 * Get species needing external data sync (never synced or old data)
 *
 * @param db - Database connection
 * @param daysOld - Consider data stale if older than this many days (default 90)
 * @returns Array of species needing sync, prioritized by those with submissions
 */
export async function getSpeciesNeedingExternalSync(
  db: Database,
  daysOld = 90
): Promise<SpeciesNeedingExternalSync[]> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();

    const species = await db.all<SpeciesNeedingExternalSync[]>(
      `SELECT
         sng.group_id,
         sng.canonical_genus,
         sng.canonical_species_name,
         sng.last_external_sync,
         CASE
           WHEN sng.last_external_sync IS NULL THEN NULL
           ELSE CAST((julianday('now') - julianday(sng.last_external_sync)) AS INTEGER)
         END as days_since_sync
       FROM species_name_group sng
       WHERE sng.last_external_sync IS NULL
          OR sng.last_external_sync < ?
       ORDER BY
         days_since_sync DESC NULLS FIRST,
         sng.canonical_genus,
         sng.canonical_species_name`,
      [cutoffISO]
    );

    return species;
  } catch (error) {
    logger.error("Failed to get species needing external sync", error);
    throw error;
  }
}

/**
 * Get external data sync statistics
 *
 * @param db - Database connection
 * @returns Statistics about external data population and sync operations
 */
export async function getExternalDataSyncStats(
  db: Database
): Promise<ExternalDataSyncStats> {
  try {
    // Get overall statistics
    const overall = await db.get<{
      total_species: number;
      species_with_links: number;
      species_with_images: number;
    }>(
      `SELECT
         COUNT(DISTINCT sng.group_id) as total_species,
         COUNT(DISTINCT CASE WHEN ser.group_id IS NOT NULL THEN sng.group_id END) as species_with_links,
         COUNT(DISTINCT CASE WHEN si.group_id IS NOT NULL THEN sng.group_id END) as species_with_images
       FROM species_name_group sng
       LEFT JOIN species_external_references ser ON sng.group_id = ser.group_id
       LEFT JOIN species_images si ON sng.group_id = si.group_id`
    );

    // Get sync operation statistics
    const syncStats = await db.get<{
      total_syncs: number;
      successful_syncs: number;
      error_count: number;
      last_sync_date: string | null;
    }>(
      `SELECT
         COUNT(*) as total_syncs,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_syncs,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
         MAX(sync_date) as last_sync_date
       FROM external_data_sync_log`
    );

    // Get per-source statistics
    const sourceStats = await db.all<Array<{
      source: ExternalDataSource;
      total_syncs: number;
      successful_syncs: number;
      last_sync_date: string | null;
    }>>(
      `SELECT
         source,
         COUNT(*) as total_syncs,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_syncs,
         MAX(sync_date) as last_sync_date
       FROM external_data_sync_log
       GROUP BY source`
    );

    const bySource: Record<ExternalDataSource, {
      total_syncs: number;
      successful_syncs: number;
      last_sync_date: string | null;
    }> = {
      fishbase: { total_syncs: 0, successful_syncs: 0, last_sync_date: null },
      wikipedia: { total_syncs: 0, successful_syncs: 0, last_sync_date: null },
      gbif: { total_syncs: 0, successful_syncs: 0, last_sync_date: null },
      iucn_images: { total_syncs: 0, successful_syncs: 0, last_sync_date: null },
    };

    for (const stat of sourceStats) {
      const source: ExternalDataSource = stat.source;
      const stats = {
        total_syncs: stat.total_syncs,
        successful_syncs: stat.successful_syncs,
        last_sync_date: stat.last_sync_date,
      };
      bySource[source] = stats;
    }

    return {
      total_species: overall?.total_species || 0,
      species_with_external_links: overall?.species_with_links || 0,
      species_with_images: overall?.species_with_images || 0,
      total_syncs: syncStats?.total_syncs || 0,
      successful_syncs: syncStats?.successful_syncs || 0,
      error_count: syncStats?.error_count || 0,
      last_sync_date: syncStats?.last_sync_date || null,
      by_source: bySource,
    };
  } catch (error) {
    logger.error("Failed to get external data sync stats", error);
    throw error;
  }
}
