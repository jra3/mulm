#!/usr/bin/env tsx

/**
 * Export All Species Data
 *
 * Generates a comprehensive CSV file containing all species from the database
 * with all fields and synonyms. Optimized for viewing/editing in Google Sheets.
 *
 * Output: all_species_export.csv
 */

import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import config from '../src/config.json';

interface SpeciesRow {
  group_id: number;
  species_type: string;
  program_class: string;
  canonical_genus: string;
  canonical_species_name: string;
  base_points: number | null;
  is_cares_species: number;
  external_references: string | null;
  common_names: string | null;
  scientific_names: string | null;
  synonym_count: number;
}

interface ExportRow {
  group_id: number;
  species_type: string;
  program_class: string;
  canonical_genus: string;
  canonical_species_name: string;
  scientific_name: string;
  common_names: string;
  scientific_names: string;
  base_points: string;
  is_cares_species: string;
  external_references: string;
  synonym_count: number;
}

async function main() {
  console.log('Opening database...');

  // Open database connection
  const db = await open({
    filename: config.databaseFile,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  });

  console.log('Querying species database...');

  // Query all species with their synonyms
  const stmt = await db.prepare(`
    SELECT
      sng.group_id,
      sng.species_type,
      sng.program_class,
      sng.canonical_genus,
      sng.canonical_species_name,
      sng.base_points,
      sng.is_cares_species,
      sng.external_references,
      GROUP_CONCAT(sn.common_name, ' | ') as common_names,
      GROUP_CONCAT(sn.scientific_name, ' | ') as scientific_names,
      COUNT(sn.name_id) as synonym_count
    FROM species_name_group sng
    LEFT JOIN species_name sn ON sng.group_id = sn.group_id
    GROUP BY sng.group_id
    ORDER BY
      sng.species_type,
      sng.program_class,
      sng.canonical_genus,
      sng.canonical_species_name
  `);

  const species = await stmt.all<SpeciesRow[]>();
  await stmt.finalize();
  await db.close();

  console.log(`Found ${species.length} species`);

  // Transform to export format
  const exportRows: ExportRow[] = species.map((row) => {
    // Parse external references JSON
    let externalRefs = '';
    if (row.external_references) {
      try {
        const refs = JSON.parse(row.external_references) as string[];
        externalRefs = refs.join(', ');
      } catch {
        // Ignore parse errors
      }
    }

    return {
      group_id: row.group_id,
      species_type: row.species_type,
      program_class: row.program_class,
      canonical_genus: row.canonical_genus,
      canonical_species_name: row.canonical_species_name,
      scientific_name: `${row.canonical_genus} ${row.canonical_species_name}`,
      common_names: row.common_names || '',
      scientific_names: row.scientific_names || '',
      base_points: row.base_points !== null ? String(row.base_points) : '',
      is_cares_species: row.is_cares_species === 1 ? 'YES' : 'NO',
      external_references: externalRefs,
      synonym_count: row.synonym_count,
    };
  });

  // Generate CSV
  const csv = Papa.unparse(exportRows, {
    header: true,
    columns: [
      'group_id',
      'species_type',
      'program_class',
      'canonical_genus',
      'canonical_species_name',
      'scientific_name',
      'common_names',
      'scientific_names',
      'base_points',
      'is_cares_species',
      'external_references',
      'synonym_count',
    ],
  });

  // Write to file
  const outputPath = path.join(process.cwd(), 'all_species_export.csv');
  fs.writeFileSync(outputPath, csv, 'utf-8');

  console.log(`\n✓ CSV exported to: ${outputPath}`);
  console.log(`\nStatistics:`);
  console.log(`  Total species: ${species.length}`);

  // Count by species type
  const byType = new Map<string, number>();
  const byTypeWithPoints = new Map<string, number>();
  const byTypeCares = new Map<string, number>();

  for (const row of species) {
    byType.set(row.species_type, (byType.get(row.species_type) || 0) + 1);

    if (row.base_points !== null) {
      byTypeWithPoints.set(
        row.species_type,
        (byTypeWithPoints.get(row.species_type) || 0) + 1
      );
    }

    if (row.is_cares_species === 1) {
      byTypeCares.set(row.species_type, (byTypeCares.get(row.species_type) || 0) + 1);
    }
  }

  console.log('\nBy Species Type:');
  for (const [type, count] of Array.from(byType.entries()).sort((a, b) => b[1] - a[1])) {
    const withPoints = byTypeWithPoints.get(type) || 0;
    const caresCount = byTypeCares.get(type) || 0;
    console.log(
      `  ${type}: ${count} total, ${withPoints} with points, ${caresCount} CARES`
    );
  }

  // Count by program class (top 10)
  const byClass = new Map<string, number>();
  for (const row of species) {
    byClass.set(row.program_class, (byClass.get(row.program_class) || 0) + 1);
  }

  console.log('\nTop 10 Program Classes:');
  const sortedClasses = Array.from(byClass.entries()).sort((a, b) => b[1] - a[1]);
  for (const [programClass, count] of sortedClasses.slice(0, 10)) {
    console.log(`  ${programClass}: ${count}`);
  }

  // Overall statistics
  const withPoints = species.filter((s) => s.base_points !== null).length;
  const withoutPoints = species.length - withPoints;
  const caresTotal = species.filter((s) => s.is_cares_species === 1).length;
  const totalSynonyms = species.reduce((sum, s) => sum + s.synonym_count, 0);

  console.log(`\nOverall Statistics:`);
  console.log(`  Species with points: ${withPoints} (${((withPoints / species.length) * 100).toFixed(1)}%)`);
  console.log(`  Species without points: ${withoutPoints} (${((withoutPoints / species.length) * 100).toFixed(1)}%)`);
  console.log(`  CARES species: ${caresTotal}`);
  console.log(`  Total name variants: ${totalSynonyms}`);
  console.log(`  Average variants per species: ${(totalSynonyms / species.length).toFixed(1)}`);

  console.log(`\n✓ Ready to import into Google Sheets!`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
