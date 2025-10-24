/**
 * Bulk Sync IUCN Red List Data from API
 *
 * Synchronizes conservation status data from the IUCN Red List API for all species
 * in the database. Respects API rate limits and provides resume capability.
 *
 * Usage:
 *   npm run script scripts/sync-iucn-data.ts [options]
 *
 * Options:
 *   --dry-run              Preview changes without updating database
 *   --limit N              Process only N species (for testing)
 *   --missing-only         Only sync species without IUCN data
 *   --stale-only [days]    Only sync species with data older than N days (default: 365)
 *   --species-id ID        Sync single species by group ID
 *   --verbose              Show detailed progress information
 *   --resume              Resume from last failed sync
 *
 * Examples:
 *   npm run script scripts/sync-iucn-data.ts --dry-run --limit 10
 *   npm run script scripts/sync-iucn-data.ts --missing-only
 *   npm run script scripts/sync-iucn-data.ts --species-id 42
 *   npm run script scripts/sync-iucn-data.ts --stale-only 365
 */

import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import config from "../src/config.json";
import { getIUCNClient, IUCNAPIError } from "../src/integrations/iucn";
import {
  updateIucnData,
  recordIucnSync,
  getSpeciesWithMissingIucn,
  getSpeciesNeedingResync,
  type IUCNData,
  type SyncStatus,
} from "../src/db/iucn";

interface CLIOptions {
  dryRun: boolean;
  limit?: number;
  missingOnly: boolean;
  staleOnly?: number;
  speciesId?: number;
  verbose: boolean;
  resume: boolean;
}

interface SpeciesForSync {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  program_class?: string;
  iucn_redlist_category?: string;
}

interface SyncResult {
  total: number;
  success: number;
  notFound: number;
  errors: number;
  skipped: number;
}

// Parse command line arguments
function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    dryRun: false,
    missingOnly: false,
    verbose: false,
    resume: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      options.dryRun = true;
    } else if (args[i] === "--limit" && i + 1 < args.length) {
      options.limit = parseInt(args[++i]);
    } else if (args[i] === "--missing-only") {
      options.missingOnly = true;
    } else if (args[i] === "--stale-only") {
      const days = i + 1 < args.length && !args[i + 1].startsWith("--") ? parseInt(args[++i]) : 365;
      options.staleOnly = days;
    } else if (args[i] === "--species-id" && i + 1 < args.length) {
      options.speciesId = parseInt(args[++i]);
    } else if (args[i] === "--verbose") {
      options.verbose = true;
    } else if (args[i] === "--resume") {
      options.resume = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Bulk Sync IUCN Red List Data from API

Usage:
  npm run script scripts/sync-iucn-data.ts [options]

Options:
  --dry-run              Preview changes without updating database
  --limit N              Process only N species (for testing)
  --missing-only         Only sync species without IUCN data
  --stale-only [days]    Only sync species with data older than N days (default: 365)
  --species-id ID        Sync single species by group ID
  --verbose              Show detailed progress information
  --resume               Resume from last failed sync
  --help, -h             Show this help message

Examples:
  # Test with 10 species (dry run)
  npm run script scripts/sync-iucn-data.ts --dry-run --limit 10

  # Sync only species missing IUCN data
  npm run script scripts/sync-iucn-data.ts --missing-only

  # Sync single species
  npm run script scripts/sync-iucn-data.ts --species-id 42

  # Re-sync species with data older than 1 year
  npm run script scripts/sync-iucn-data.ts --stale-only 365

Performance:
  - Rate limited to 2 seconds between API calls (IUCN requirement)
  - ~10 minutes per 300 species
  - ~35 minutes for 1000 species
  `);
}

// Get species to sync based on options
async function getSpeciesToSync(db: Database, options: CLIOptions): Promise<SpeciesForSync[]> {
  if (options.speciesId) {
    // Single species by ID
    const species = await db.get<SpeciesForSync>(
      `SELECT group_id, canonical_genus, canonical_species_name, program_class
       FROM species_name_group WHERE group_id = ?`,
      [options.speciesId]
    );
    return species ? [species] : [];
  }

  if (options.missingOnly) {
    // Only species without IUCN data
    return await getSpeciesWithMissingIucn(db);
  }

  if (options.staleOnly !== undefined) {
    // Only species with old data
    return await getSpeciesNeedingResync(db, options.staleOnly);
  }

  // All species (default)
  let query = `
    SELECT group_id, canonical_genus, canonical_species_name, program_class, iucn_redlist_category
    FROM species_name_group
    ORDER BY canonical_genus, canonical_species_name
  `;

  if (options.limit) {
    query += ` LIMIT ${options.limit}`;
  }

  return await db.all<SpeciesForSync[]>(query);
}

// Sync a single species
async function syncSpecies(
  db: Database,
  client: ReturnType<typeof getIUCNClient>,
  species: SpeciesForSync,
  options: CLIOptions
): Promise<{ status: SyncStatus; category?: string; error?: string }> {
  const scientificName = `${species.canonical_genus} ${species.canonical_species_name}`;

  if (options.verbose) {
    console.log(`  Querying IUCN API for: ${scientificName}`);
  }

  try {
    // Query IUCN API
    const iucnData = await client.getSpecies(species.canonical_genus, species.canonical_species_name);

    if (!iucnData) {
      // Not found in IUCN database
      if (!options.dryRun) {
        await recordIucnSync(db, species.group_id, "not_found");
      }
      return { status: "not_found" };
    }

    // Found - update database
    const data: IUCNData = {
      category: iucnData.category,
      taxonId: iucnData.taxonid,
      populationTrend: iucnData.population_trend,
    };

    if (!options.dryRun) {
      await updateIucnData(db, species.group_id, data);
      await recordIucnSync(db, species.group_id, "success", data);
    }

    return { status: "success", category: iucnData.category };
  } catch (error) {
    // API error
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (error instanceof IUCNAPIError) {
      if (error.statusCode === 429) {
        // Rate limited
        if (!options.dryRun) {
          await recordIucnSync(db, species.group_id, "rate_limited", undefined, errorMessage);
        }
        return { status: "rate_limited", error: errorMessage };
      }
    }

    // General API error
    if (!options.dryRun) {
      await recordIucnSync(db, species.group_id, "api_error", undefined, errorMessage);
    }
    return { status: "api_error", error: errorMessage };
  }
}

// Main sync function
async function syncIUCNData() {
  const options = parseArgs();

  console.log("\n=== IUCN Red List Bulk Sync ===\n");
  console.log(`Mode: ${options.dryRun ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log(`Verbose: ${options.verbose ? "YES" : "NO"}`);

  if (options.speciesId) {
    console.log(`Target: Single species (ID: ${options.speciesId})`);
  } else if (options.missingOnly) {
    console.log(`Target: Species without IUCN data`);
  } else if (options.staleOnly) {
    console.log(`Target: Species with data older than ${options.staleOnly} days`);
  } else {
    console.log(`Target: All species${options.limit ? ` (limit: ${options.limit})` : ""}`);
  }

  console.log("");

  // Connect to database
  console.log("Connecting to database...");
  const db = await open({
    filename: config.databaseFile,
    driver: sqlite3.Database,
  });

  // Get IUCN client
  console.log("Initializing IUCN API client...");
  const client = getIUCNClient();

  // Get species to sync
  console.log("Loading species list...");
  const allSpecies = await getSpeciesToSync(db, options);

  if (allSpecies.length === 0) {
    console.log("\nNo species found to sync. Exiting.");
    await db.close();
    return;
  }

  console.log(`Found ${allSpecies.length} species to sync\n`);

  // Initialize result counters
  const result: SyncResult = {
    total: allSpecies.length,
    success: 0,
    notFound: 0,
    errors: 0,
    skipped: 0,
  };

  // Process each species
  const startTime = Date.now();

  for (let i = 0; i < allSpecies.length; i++) {
    const species = allSpecies[i];
    const scientificName = `${species.canonical_genus} ${species.canonical_species_name}`;

    // Progress indicator
    const progress = `[${i + 1}/${allSpecies.length}]`;
    console.log(`${progress} ${scientificName}`);

    // Check if already has recent data (skip if staleOnly not set)
    if (!options.missingOnly && !options.staleOnly && species.iucn_redlist_category) {
      if (options.verbose) {
        console.log(`  ↪ Already has IUCN data: ${species.iucn_redlist_category} (skipping)`);
      }
      result.skipped++;
      continue;
    }

    // Sync the species
    const syncResult = await syncSpecies(db, client, species, options);

    if (syncResult.status === "success") {
      console.log(`  ✓ ${syncResult.category}`);
      result.success++;
    } else if (syncResult.status === "not_found") {
      if (options.verbose) {
        console.log(`  ○ Not in IUCN database`);
      }
      result.notFound++;
    } else {
      console.log(`  ✗ Error: ${syncResult.error}`);
      result.errors++;
    }

    // Estimate time remaining
    if ((i + 1) % 50 === 0 || i === allSpecies.length - 1) {
      const elapsed = Date.now() - startTime;
      const perSpecies = elapsed / (i + 1);
      const remaining = (allSpecies.length - (i + 1)) * perSpecies;
      const remainingMin = Math.round(remaining / 60000);
      console.log(`  ⏱ Estimated time remaining: ${remainingMin} minutes\n`);
    }
  }

  await db.close();

  // Print summary
  const totalTime = Math.round((Date.now() - startTime) / 1000);

  console.log("\n=== Sync Summary ===\n");
  console.log(`Total species processed: ${result.total}`);
  console.log(`✓ Successful: ${result.success}`);
  console.log(`○ Not found in IUCN: ${result.notFound}`);
  console.log(`✗ Errors: ${result.errors}`);
  console.log(`↪ Skipped (already has data): ${result.skipped}`);
  console.log(`⏱ Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);

  if (options.dryRun) {
    console.log("\n⚠️  DRY RUN MODE - No changes were made to the database");
    console.log("Run without --dry-run to apply changes");
  } else {
    console.log("\n✓ Sync complete!");
  }

  console.log("");
}

// Run sync
syncIUCNData().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
