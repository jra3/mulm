/**
 * IUCN Red List Admin Routes
 *
 * Admin dashboard for managing IUCN conservation status syncing
 */

import { Response } from "express";
import { MulmRequest } from "@/sessions";
import {
  getIucnSyncStats,
  getIucnSyncLog,
  getSpeciesWithMissingIucn,
  getSpeciesNeedingResync,
  updateIucnData,
  recordIucnSync,
} from "@/db/iucn";
import { db } from "@/db/conn";
import { IUCNClient } from "@/integrations/iucn";
import { logger } from "@/utils/logger";
import * as z from "zod";

/**
 * Zod Schemas for IUCN Admin Routes
 */

// Schema for POST /admin/iucn/sync
const syncSpeciesSchema = z.object({
  mode: z.enum(["missing", "stale", "all", "single"]).default("missing"),
  groupId: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : undefined))
    .refine((val) => val === undefined || !isNaN(val), {
      message: "Invalid species ID",
    }),
  daysOld: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 365))
    .refine((val) => !isNaN(val) && val > 0, {
      message: "Days must be a positive number",
    }),
});

// Schema for GET /admin/iucn/log (query params)
const syncLogQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 1))
    .refine((val) => !isNaN(val) && val > 0, {
      message: "Page must be a positive number",
    }),
  status: z.enum(["success", "not_found", "api_error", "rate_limited", "csv_import"]).optional(),
});

/**
 * GET /admin/iucn
 * Main IUCN sync dashboard
 */
export const showDashboard = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  try {
    const database = db();

    // Get comprehensive statistics
    const stats = await getIucnSyncStats(database);

    // Get recent sync log (last 50 entries)
    const recentLog = await getIucnSyncLog(database, undefined, 50);

    // Enhance log entries with species names
    const logWithNames = await Promise.all(
      recentLog.map(async (entry) => {
        const species = await database.get<{
          canonical_genus: string;
          canonical_species_name: string;
          iucn_redlist_category: string | null;
          iucn_population_trend: string | null;
        }>(
          `SELECT canonical_genus, canonical_species_name, iucn_redlist_category, iucn_population_trend
           FROM species_name_group WHERE group_id = ?`,
          entry.group_id
        );
        return {
          ...entry,
          species_name: species
            ? `${species.canonical_genus} ${species.canonical_species_name}`
            : "Unknown",
          current_category: species?.iucn_redlist_category ?? undefined,
          population_trend: species?.iucn_population_trend ?? undefined,
        };
      })
    );

    res.render("admin/iucnDashboard", {
      title: "IUCN Red List Sync Dashboard",
      stats,
      recentLog: logWithNames,
    });
  } catch (error) {
    logger.error("Failed to load IUCN dashboard", error);
    res.status(500).send("Failed to load dashboard");
  }
};

/**
 * POST /admin/iucn/sync
 * Trigger IUCN sync operation
 */
export const syncSpecies = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  // Validate request body with Zod
  const parsed = syncSpeciesSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).send(parsed.error.issues[0]?.message ?? "Invalid request");
    return;
  }

  const { mode: syncMode, groupId, daysOld } = parsed.data;

  try {
    const database = db(true); // Need write access for syncing
    const iucnClient = new IUCNClient();

    // Test API connection first
    const connectionOk = await iucnClient.testConnection();
    if (!connectionOk) {
      logger.error("IUCN API connection test failed", {
        adminId: viewer.id,
        mode: syncMode,
      });
      res.status(503).send("IUCN API is not accessible. Please try again later.");
      return;
    }

    // Determine which species to sync
    type SpeciesForSync = { group_id: number; genus: string; species: string };
    let speciesToSync: SpeciesForSync[] = [];

    if (syncMode === "single" && groupId) {
      const species = await database.get<SpeciesForSync>(
        `SELECT group_id, canonical_genus as genus, canonical_species_name as species
         FROM species_name_group WHERE group_id = ?`,
        groupId
      );
      if (species) {
        speciesToSync = [species];
      }
    } else if (syncMode === "missing") {
      const missing = await getSpeciesWithMissingIucn(database);
      speciesToSync = missing.map((s: { group_id: number; canonical_genus: string; canonical_species_name: string }) => ({
        group_id: s.group_id,
        genus: s.canonical_genus,
        species: s.canonical_species_name,
      }));
    } else if (syncMode === "stale") {
      const stale = await getSpeciesNeedingResync(database, daysOld);
      speciesToSync = stale.map((s: { group_id: number; canonical_genus: string; canonical_species_name: string }) => ({
        group_id: s.group_id,
        genus: s.canonical_genus,
        species: s.canonical_species_name,
      }));
    } else if (syncMode === "all") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allSpecies: any[] = await database.all(
        `SELECT group_id, canonical_genus as genus, canonical_species_name as species
         FROM species_name_group ORDER BY canonical_genus, canonical_species_name`
      );
      speciesToSync = allSpecies as SpeciesForSync[];
    }

    logger.info("Starting IUCN sync", {
      adminId: viewer.id,
      mode: syncMode,
      speciesCount: speciesToSync.length,
    });

    // Start sync (this will be slow due to rate limiting)
    // For now, sync synchronously. In future, could use a background job queue
    let successCount: number = 0;
    let notFoundCount: number = 0;
    let errorCount: number = 0;

    for (const species of speciesToSync) {
      try {
        const scientificName = `${species.genus} ${species.species}`;
        const result = await iucnClient.getSpeciesByName(scientificName);

        if (result) {
          // Success - update species data
          await updateIucnData(database, species.group_id, {
            category: result.category,
            taxonId: result.taxonid,
            populationTrend: result.population_trend || undefined,
          });
          await recordIucnSync(database, species.group_id, "success", {
            category: result.category,
            taxonId: result.taxonid,
            populationTrend: result.population_trend || undefined,
          });
          successCount++;
        } else {
          // Not found in IUCN database (common for aquarium species)
          await recordIucnSync(database, species.group_id, "not_found");
          notFoundCount++;
        }
      } catch (error) {
        // API error
        logger.error(`IUCN sync failed for ${species.genus} ${species.species}`, error);
        await recordIucnSync(
          database,
          species.group_id,
          "api_error",
          undefined,
          error instanceof Error ? error.message : "Unknown error"
        );
        errorCount++;
      }
    }

    logger.info("IUCN sync complete", {
      adminId: viewer.id,
      mode: syncMode,
      total: speciesToSync.length,
      success: successCount,
      notFound: notFoundCount,
      errors: errorCount,
    });

    // Return updated stats as HTMX fragment
    const updatedStats = await getIucnSyncStats(database);
    res.render("admin/iucnStatsCards", {
      stats: updatedStats,
      syncComplete: true,
      syncResults: {
        total: speciesToSync.length,
        success: successCount,
        notFound: notFoundCount,
        errors: errorCount,
      },
    });
  } catch (error) {
    logger.error("IUCN sync operation failed", error);
    res.status(500).send("Sync operation failed. Please check logs.");
  }
};

/**
 * GET /admin/iucn/status
 * Get current sync status (for polling during long syncs)
 * Returns HTMX fragment with progress
 */
export const getSyncStatus = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  try {
    const database = db();
    const stats = await getIucnSyncStats(database);

    res.render("admin/iucnStatsCards", {
      stats,
      syncComplete: false,
    });
  } catch (error) {
    logger.error("Failed to get sync status", error);
    res.status(500).send("Failed to get status");
  }
};

/**
 * GET /admin/iucn/log
 * Full detailed sync log page
 */
export const showSyncLog = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  // Validate query params with Zod
  const parsed = syncLogQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).send(parsed.error.issues[0]?.message ?? "Invalid query parameters");
    return;
  }

  const { page, status: statusFilter } = parsed.data;
  const limit = 100;
  const offset = (page - 1) * limit;

  try {
    const database = db();

    // Get filtered log entries
    let query = `
      SELECT
        l.id, l.group_id, l.sync_date, l.status, l.category_found, l.error_message,
        s.canonical_genus, s.canonical_species_name, s.iucn_redlist_category
      FROM iucn_sync_log l
      JOIN species_name_group s ON l.group_id = s.group_id
    `;
    const params: (string | number)[] = [];

    if (statusFilter) {
      query += ` WHERE l.status = ?`;
      params.push(statusFilter);
    }

    query += ` ORDER BY l.sync_date DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const log = await database.all(query, ...params);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) as total FROM iucn_sync_log`;
    if (statusFilter) {
      countQuery += ` WHERE status = ?`;
    }
    const countResult = await database.get<{ total: number }>(
      countQuery,
      ...(statusFilter ? [statusFilter] : [])
    );
    const totalPages = Math.ceil((countResult?.total ?? 0) / limit);

    res.render("admin/iucnSyncLog", {
      title: "IUCN Sync Log",
      log,
      statusFilter,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount: countResult?.total ?? 0,
        limit,
      },
    });
  } catch (error) {
    logger.error("Failed to load sync log", error);
    res.status(500).send("Failed to load log");
  }
};

/**
 * GET /admin/iucn/missing
 * List species missing IUCN data
 */
export const showMissingSpecies = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  try {
    const database = db();
    const missing = await getSpeciesWithMissingIucn(database);

    res.render("admin/iucnMissingSpecies", {
      title: "Species Missing IUCN Data",
      species: missing,
      totalCount: missing.length,
    });
  } catch (error) {
    logger.error("Failed to load missing species", error);
    res.status(500).send("Failed to load data");
  }
};
