#!/usr/bin/env tsx

/**
 * Import Aquatic Plants from CSV
 *
 * Reads all_aquatic_plants_unified.csv and generates SQL INSERT statements
 * for populating species_name_group and species_name tables with plant data.
 *
 * Output: db/migrations/021-import-aquatic-plants.sql
 */

import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

interface PlantRow {
  Scientific_Name: string;
  Common_Name: string;
  Vendor: string;
  Product_Type: string;
  Tags: string;
  URL: string;
  Source: string;
  Found_In_Multiple_Sources: string;
}

interface SpeciesGroup {
  scientificName: string;
  genus: string;
  speciesName: string;
  programClass: string;
  commonNames: Set<string>;
  imageLinks: Set<string>;
  externalReferences: Set<string>;
}

// Map plant tags/characteristics to HAP program classes
function inferProgramClass(tags: string, commonName: string): string {
  const tagLower = tags.toLowerCase();
  const nameLower = commonName.toLowerCase();

  // Check for specific plant types in order of specificity
  if (nameLower.includes('sword') || tagLower.includes('sword')) return 'Sword Plants';
  if (nameLower.includes('anubias')) return 'Anubias & Lagenandra';
  if (nameLower.includes('cryptocoryne') || nameLower.includes('crypt ')) return 'Cryptocoryne';
  if (nameLower.includes('aponogeton') || nameLower.includes('crinum')) return 'Apongetons & Criniums';
  if (nameLower.includes('lily') || nameLower.includes('nymphaea')) return 'Water Lilies';
  if (tagLower.includes('floating') || nameLower.includes('frogbit') || nameLower.includes('duckweed')) return 'Floating Plants';
  if (nameLower.includes('moss') || nameLower.includes('riccia') || nameLower.includes('liverwort')) return 'Primitive Plants';
  if (tagLower.includes('stem plant') || nameLower.includes('rotala') || nameLower.includes('ludwigia') || nameLower.includes('hygrophila')) return 'Stem Plants';

  // Default to Rosette Plants for plants that form rosettes (many aquatic plants)
  return 'Rosette Plants';
}

// Parse scientific name into genus and species
function parseScientificName(scientificName: string): { genus: string; species: string } | null {
  if (!scientificName || scientificName.trim() === '') {
    return null;
  }

  const parts = scientificName.trim().split(/\s+/);

  if (parts.length < 2) {
    // Handle single-word names (genus only)
    return { genus: parts[0], species: 'sp.' };
  }

  // Take first word as genus, rest as species (handles subspecies, varieties, etc.)
  const genus = parts[0];
  const species = parts.slice(1).join(' ');

  return { genus, species };
}

// Escape single quotes for SQL
function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

async function main() {
  const csvPath = path.join(process.cwd(), 'all_aquatic_plants_unified.csv');
  const outputPath = path.join(process.cwd(), 'db', 'migrations', '021-import-aquatic-plants.sql');

  console.log('Reading CSV:', csvPath);

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const parseResult = Papa.parse<PlantRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  if (parseResult.errors.length > 0) {
    console.error('CSV parsing errors:', parseResult.errors);
  }

  console.log(`Parsed ${parseResult.data.length} rows`);

  // Group by scientific name
  const speciesMap = new Map<string, SpeciesGroup>();
  let skippedCount = 0;

  for (const row of parseResult.data) {
    const scientificName = row.Scientific_Name?.trim();

    if (!scientificName) {
      skippedCount++;
      continue;
    }

    const parsed = parseScientificName(scientificName);
    if (!parsed) {
      console.warn(`Skipping invalid scientific name: "${scientificName}"`);
      skippedCount++;
      continue;
    }

    if (!speciesMap.has(scientificName)) {
      const programClass = inferProgramClass(row.Tags || '', row.Common_Name || '');

      speciesMap.set(scientificName, {
        scientificName,
        genus: parsed.genus,
        speciesName: parsed.species,
        programClass,
        commonNames: new Set(),
        imageLinks: new Set(),
        externalReferences: new Set(),
      });
    }

    const species = speciesMap.get(scientificName)!;

    // Add common name if present and not empty
    if (row.Common_Name?.trim()) {
      species.commonNames.add(row.Common_Name.trim());
    }

    // Add URL as external reference
    if (row.URL?.trim()) {
      species.externalReferences.add(row.URL.trim());
    }
  }

  console.log(`Found ${speciesMap.size} unique species`);
  console.log(`Skipped ${skippedCount} rows without scientific names`);

  // Generate SQL
  const sql: string[] = [];
  sql.push('-- Up');
  sql.push('-- Import aquatic plants from unified vendor database');
  sql.push('-- Generated from all_aquatic_plants_unified.csv');
  sql.push('');

  let groupIdCounter = 1;
  const groupInserts: string[] = [];
  const nameInserts: string[] = [];

  // Sort by scientific name for consistent output
  const sortedSpecies = Array.from(speciesMap.values()).sort((a, b) =>
    a.scientificName.localeCompare(b.scientificName)
  );

  for (const species of sortedSpecies) {
    // Insert into species_name_group
    const externalRefsJson = species.externalReferences.size > 0
      ? JSON.stringify(Array.from(species.externalReferences).slice(0, 10)) // Limit to 10 URLs
      : null;

    groupInserts.push(
      `INSERT OR IGNORE INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type, base_points, external_references, image_links, is_cares_species)` +
      `\nVALUES ('${escapeSql(species.programClass)}', '${escapeSql(species.genus)}', '${escapeSql(species.speciesName)}', 'Plant', NULL, ${externalRefsJson ? `'${escapeSql(externalRefsJson)}'` : 'NULL'}, NULL, 0);`
    );

    // Insert synonyms into species_name
    // Use last_insert_rowid() to reference the group we just created
    const commonNamesArray = Array.from(species.commonNames);

    if (commonNamesArray.length === 0) {
      // If no common names, use scientific name as both common and scientific
      nameInserts.push(
        `INSERT OR IGNORE INTO species_name (group_id, common_name, scientific_name)\n` +
        `SELECT group_id, '${escapeSql(species.scientificName)}', '${escapeSql(species.scientificName)}'\n` +
        `FROM species_name_group WHERE canonical_genus = '${escapeSql(species.genus)}' AND canonical_species_name = '${escapeSql(species.speciesName)}';`
      );
    } else {
      for (const commonName of commonNamesArray) {
        nameInserts.push(
          `INSERT OR IGNORE INTO species_name (group_id, common_name, scientific_name)\n` +
          `SELECT group_id, '${escapeSql(commonName)}', '${escapeSql(species.scientificName)}'\n` +
          `FROM species_name_group WHERE canonical_genus = '${escapeSql(species.genus)}' AND canonical_species_name = '${escapeSql(species.speciesName)}';`
        );
      }
    }

    groupIdCounter++;
  }

  sql.push('-- Insert species groups');
  sql.push(...groupInserts);
  sql.push('');
  sql.push('-- Insert species name synonyms');
  sql.push(...nameInserts);
  sql.push('');
  sql.push('-- Down');
  sql.push("DELETE FROM species_name_group WHERE species_type = 'Plant';");
  sql.push('');

  // Write to file
  fs.writeFileSync(outputPath, sql.join('\n'), 'utf-8');

  console.log(`\nSQL migration written to: ${outputPath}`);
  console.log(`\nStatistics:`);
  console.log(`  Species groups: ${groupInserts.length}`);
  console.log(`  Name synonyms: ${nameInserts.length}`);
  console.log(`\nProgram class distribution:`);

  const classDistribution = new Map<string, number>();
  for (const species of sortedSpecies) {
    classDistribution.set(
      species.programClass,
      (classDistribution.get(species.programClass) || 0) + 1
    );
  }

  for (const [programClass, count] of Array.from(classDistribution.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${programClass}: ${count}`);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
