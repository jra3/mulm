/**
 * Import IUCN conservation status data from CARES species CSV file
 *
 * This script imports IUCN Red List conservation status data from a CSV file
 * (typically from CARES Fish Preservation Program) and populates the species_name_group
 * table with IUCN classification data.
 *
 * The CARES CSV uses prefixed codes (CVU, CEN, CCR, etc.) which are mapped to
 * standard IUCN categories (VU, EN, CR, etc.).
 *
 * Usage:
 *   npm run script scripts/import-cares-iucn-data.ts [options]
 *
 * Options:
 *   --csv-file <path>   Path to CSV file (default: ./cares_species.csv)
 *   --dry-run           Preview changes without updating database
 *   --verbose           Show detailed progress information
 *
 * CSV Format:
 *   Expected columns: family, family_common_name, scientific_name, classification,
 *                     iucn_classification, assessment_date, etc.
 *
 * Example:
 *   npm run script scripts/import-cares-iucn-data.ts --dry-run
 *   npm run script scripts/import-cares-iucn-data.ts --csv-file ~/Downloads/cares.csv
 */

import * as fs from "fs/promises";
import * as path from "path";
import { parse } from "csv-parse/sync";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import config from "../src/config.json";

// CARES uses "C" prefix for their classifications
// Map them to standard IUCN categories
const CARES_TO_IUCN_MAP: Record<string, string> = {
  // CARES codes (with C prefix)
  CVU: "VU", // CARES Vulnerable → Vulnerable
  CEN: "EN", // CARES Endangered → Endangered
  CCR: "CR", // CARES Critically Endangered → Critically Endangered
  CNT: "NT", // CARES Near Threatened → Near Threatened
  CEW: "EW", // CARES Extinct in Wild → Extinct in Wild
  CDD: "DD", // CARES Data Deficient → Data Deficient
  CLC: "LC", // CARES Least Concern → Least Concern
  CNE: "NE", // CARES Not Evaluated → Not Evaluated
  CCN: "CR", // Alternate CARES CR notation
  CWU: "VU", // Alternate CARES VU notation

  // Standard IUCN codes (pass through)
  VU: "VU",
  EN: "EN",
  CR: "CR",
  NT: "NT",
  EW: "EW",
  EX: "EX",
  DD: "DD",
  LC: "LC",
  NE: "NE",
};

interface CSVRow {
  family?: string;
  family_common_name?: string;
  scientific_name: string;
  classification?: string;
  iucn_classification?: string;
  assessment_date?: string;
  iucn_assessment_date?: string;
  authority?: string;
  authority_link?: string;
  species_link?: string;
}

interface ParsedSpecies {
  scientificName: string;
  genus: string;
  species: string;
  iucnCategory: string;
  rawClassification: string;
}

interface ImportResult {
  matched: number;
  notFound: number;
  updated: number;
  skipped: number;
  errors: number;
}

// Parse command line arguments
function parseArgs(): { csvFile: string; dryRun: boolean; verbose: boolean } {
  const args = process.argv.slice(2);
  let csvFile = "./cares_species.csv";
  let dryRun = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--csv-file" && i + 1 < args.length) {
      csvFile = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--verbose") {
      verbose = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Import IUCN conservation status data from CARES species CSV file

Usage:
  npm run script scripts/import-cares-iucn-data.ts [options]

Options:
  --csv-file <path>   Path to CSV file (default: ./cares_species.csv)
  --dry-run           Preview changes without updating database
  --verbose           Show detailed progress information
  --help, -h          Show this help message

Example:
  npm run script scripts/import-cares-iucn-data.ts --dry-run
  npm run script scripts/import-cares-iucn-data.ts --csv-file ~/Downloads/cares.csv
      `);
      process.exit(0);
    }
  }

  return { csvFile, dryRun, verbose };
}

// Parse scientific name into genus and species
function parseScientificName(name: string): { genus: string; species: string } | null {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  return {
    genus: parts[0],
    species: parts[1],
  };
}

// Map CARES classification code to standard IUCN category
function mapToIUCN(classification: string): string | null {
  const normalized = classification.trim().toUpperCase();

  // Direct mapping
  if (CARES_TO_IUCN_MAP[normalized]) {
    return CARES_TO_IUCN_MAP[normalized];
  }

  // Try to extract code from longer string (e.g., "Critically Endangered (CR)")
  const match = normalized.match(/\b(EX|EW|CR|EN|VU|NT|LC|DD|NE|C[A-Z]{2})\b/);
  if (match) {
    const code = match[1];
    return CARES_TO_IUCN_MAP[code] || null;
  }

  return null;
}

// Parse CSV file
async function parseCSV(filePath: string): Promise<ParsedSpecies[]> {
  console.log(`Reading CSV file: ${filePath}`);

  const fileContent = await fs.readFile(filePath, "utf-8");
  const records: CSVRow[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Found ${records.length} rows in CSV`);

  const parsed: ParsedSpecies[] = [];
  let skipped = 0;

  for (const row of records) {
    // Get classification from either column
    const rawClassification = row.classification || row.iucn_classification || "";

    if (!rawClassification) {
      skipped++;
      continue;
    }

    const iucnCategory = mapToIUCN(rawClassification);
    if (!iucnCategory) {
      console.warn(`Warning: Could not map classification "${rawClassification}" for ${row.scientific_name}`);
      skipped++;
      continue;
    }

    const parsed_name = parseScientificName(row.scientific_name);
    if (!parsed_name) {
      console.warn(`Warning: Could not parse scientific name "${row.scientific_name}"`);
      skipped++;
      continue;
    }

    parsed.push({
      scientificName: row.scientific_name,
      genus: parsed_name.genus,
      species: parsed_name.species,
      iucnCategory,
      rawClassification,
    });
  }

  console.log(`Parsed ${parsed.length} species with valid IUCN classifications`);
  console.log(`Skipped ${skipped} rows (missing or invalid classification)`);

  return parsed;
}

// Find species group ID by scientific name
async function findSpeciesGroup(
  db: Database,
  genus: string,
  species: string,
  verbose: boolean
): Promise<number | null> {
  // Try to match by canonical name
  const result = await db.get(
    `
    SELECT group_id
    FROM species_name_group
    WHERE canonical_genus = ? AND canonical_species_name = ?
    `,
    [genus, species]
  );

  if (result) {
    if (verbose) {
      console.log(`  ✓ Found group_id ${result.group_id} for ${genus} ${species}`);
    }
    return result.group_id;
  }

  // Try to match by scientific name variants
  const variantResult = await db.get(
    `
    SELECT sng.group_id
    FROM species_name_group sng
    INNER JOIN species_scientific_name ssn ON sng.group_id = ssn.group_id
    WHERE ssn.scientific_name = ?
    `,
    [`${genus} ${species}`]
  );

  if (variantResult) {
    if (verbose) {
      console.log(`  ✓ Found group_id ${variantResult.group_id} via scientific name variant`);
    }
    return variantResult.group_id;
  }

  return null;
}

// Update species group with IUCN data
async function updateSpeciesGroup(
  db: Database,
  groupId: number,
  iucnCategory: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    console.log(`  [DRY RUN] Would update group_id ${groupId} with IUCN category: ${iucnCategory}`);
    return;
  }

  const now = new Date().toISOString();

  await db.run(
    `
    UPDATE species_name_group
    SET iucn_redlist_category = ?,
        iucn_last_updated = ?
    WHERE group_id = ?
    `,
    [iucnCategory, now, groupId]
  );

  // Log to sync table
  await db.run(
    `
    INSERT INTO iucn_sync_log (group_id, sync_date, status, category_found, error_message)
    VALUES (?, ?, ?, ?, ?)
    `,
    [groupId, now, "csv_import", iucnCategory, null]
  );
}

// Main import function
async function importIUCNData() {
  const { csvFile, dryRun, verbose } = parseArgs();

  console.log("\n=== IUCN Data Import from CARES CSV ===\n");
  console.log(`CSV File: ${csvFile}`);
  console.log(`Dry Run: ${dryRun ? "YES (no changes will be made)" : "NO"}`);
  console.log(`Verbose: ${verbose ? "YES" : "NO"}`);
  console.log("");

  // Check if CSV file exists
  try {
    await fs.access(csvFile);
  } catch (error) {
    console.error(`Error: CSV file not found: ${csvFile}`);
    console.error("\nYou can:");
    console.error("  1. Download CARES species data from https://caresforfish.org/");
    console.error("  2. Specify a different CSV file with --csv-file <path>");
    console.error("  3. Run with --help to see usage information");
    process.exit(1);
  }

  // Parse CSV
  const species = await parseCSV(csvFile);

  if (species.length === 0) {
    console.log("\nNo valid species found in CSV. Exiting.");
    process.exit(0);
  }

  // Connect to database
  console.log("\nConnecting to database...");
  const db = await open({
    filename: config.databaseFile,
    driver: sqlite3.Database,
  });

  const result: ImportResult = {
    matched: 0,
    notFound: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  // Process each species
  console.log("\nProcessing species...\n");

  for (let i = 0; i < species.length; i++) {
    const sp = species[i];

    if (verbose || i % 50 === 0) {
      console.log(`[${i + 1}/${species.length}] ${sp.scientificName} (${sp.iucnCategory})`);
    }

    try {
      const groupId = await findSpeciesGroup(db, sp.genus, sp.species, verbose);

      if (groupId) {
        result.matched++;

        // Check if already has IUCN data
        const existing = await db.get(
          "SELECT iucn_redlist_category FROM species_name_group WHERE group_id = ?",
          [groupId]
        );

        if (existing?.iucn_redlist_category) {
          if (verbose) {
            console.log(
              `  ℹ Skipping - already has IUCN data: ${existing.iucn_redlist_category}`
            );
          }
          result.skipped++;
        } else {
          await updateSpeciesGroup(db, groupId, sp.iucnCategory, dryRun);
          result.updated++;
          if (verbose) {
            console.log(`  ✓ Updated`);
          }
        }
      } else {
        result.notFound++;
        if (verbose) {
          console.log(`  ✗ Not found in database`);
        }
      }
    } catch (error) {
      result.errors++;
      console.error(`  ✗ Error: ${(error as Error).message}`);
    }
  }

  await db.close();

  // Print summary
  console.log("\n=== Import Summary ===\n");
  console.log(`Total species in CSV: ${species.length}`);
  console.log(`Matched in database: ${result.matched}`);
  console.log(`Not found in database: ${result.notFound}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Skipped (already has data): ${result.skipped}`);
  console.log(`Errors: ${result.errors}`);

  if (dryRun) {
    console.log("\n⚠️  DRY RUN MODE - No changes were made to the database");
    console.log("Run without --dry-run to apply changes");
  } else {
    console.log("\n✓ Import complete!");
  }

  console.log("");
}

// Run import
importIUCNData().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
