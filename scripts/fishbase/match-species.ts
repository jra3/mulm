/**
 * Match our species database against FishBase
 *
 * Usage:
 *   npm run script scripts/fishbase/match-species.ts
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createDuckDBConnection, createFishBaseView } from './duckdb-utils';
import { join } from 'path';

interface OurSpecies {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  species_type: string;
  program_class: string;
}

interface FishBaseMatch {
  SpecCode: number;
  Genus: string;
  Species: string;
  FBname: string | null;
  Length: number | null;
  CommonNameCount?: number;
}

async function main() {
  console.log('\n=== Matching Species Against FishBase ===\n');

  // Connect to our SQLite database
  const dbPath = join(__dirname, '../../db/database.db');
  const sqlite = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  });

  // Get all our fish species
  const ourSpecies: OurSpecies[] = await sqlite.all(`
    SELECT
      group_id,
      canonical_genus,
      canonical_species_name,
      species_type,
      program_class
    FROM species_name_group
    WHERE species_type = 'Fish'
    ORDER BY canonical_genus, canonical_species_name
  `);

  console.log(`Found ${ourSpecies.length} fish species in our database\n`);

  // Connect to DuckDB and create FishBase views
  const duckConn = await createDuckDBConnection();
  console.log('Loading FishBase data...');
  await createFishBaseView(duckConn, 'species');
  await createFishBaseView(duckConn, 'comnames');
  console.log('FishBase data loaded\n');

  // Match each species
  let matchedCount = 0;
  let unmatchedCount = 0;
  const matches: Array<{
    our_species: string;
    fishbase_match: FishBaseMatch | null;
    common_names_available: number;
  }> = [];

  for (const species of ourSpecies) {
    const scientificName = `${species.canonical_genus} ${species.canonical_species_name}`;

    try {
      // Try to find exact match
      const fishbaseResults = await duckConn.all<FishBaseMatch>(`
        SELECT
          SpecCode,
          Genus,
          Species,
          FBname,
          Length
        FROM fb_species
        WHERE LOWER(Genus) = LOWER(?)
          AND LOWER(Species) = LOWER(?)
      `, species.canonical_genus, species.canonical_species_name);

      if (fishbaseResults.length > 0) {
        const match = fishbaseResults[0];

        // Count common names
        const commonNamesCount = await duckConn.all<{ count: number }>(`
          SELECT COUNT(*) as count
          FROM fb_comnames
          WHERE SpecCode = ?
            AND Language = 'English'
        `, match.SpecCode);

        match.CommonNameCount = commonNamesCount[0].count;
        matchedCount++;

        matches.push({
          our_species: scientificName,
          fishbase_match: match,
          common_names_available: match.CommonNameCount,
        });
      } else {
        unmatchedCount++;
        matches.push({
          our_species: scientificName,
          fishbase_match: null,
          common_names_available: 0,
        });
      }
    } catch (error) {
      console.error(`Error matching ${scientificName}:`, error);
      unmatchedCount++;
    }
  }

  // Close DuckDB connection
  await duckConn.close();

  // Print summary
  console.log('\n=== Summary ===\n');
  console.log(`Total species: ${ourSpecies.length}`);
  console.log(`Matched in FishBase: ${matchedCount} (${(matchedCount / ourSpecies.length * 100).toFixed(1)}%)`);
  console.log(`Not found in FishBase: ${unmatchedCount} (${(unmatchedCount / ourSpecies.length * 100).toFixed(1)}%)`);

  // Calculate common name statistics
  const totalCommonNames = matches
    .filter(m => m.fishbase_match)
    .reduce((sum, m) => sum + Number(m.common_names_available), 0);
  const avgCommonNames = matchedCount > 0 ? (totalCommonNames / matchedCount).toFixed(1) : '0';

  console.log(`\nTotal English common names available: ${totalCommonNames}`);
  console.log(`Average common names per matched species: ${avgCommonNames}`);

  // Show top 10 species with most common names
  const topSpecies = matches
    .filter(m => m.fishbase_match)
    .sort((a, b) => b.common_names_available - a.common_names_available)
    .slice(0, 10);

  if (topSpecies.length > 0) {
    console.log('\n=== Top 10 Species with Most Common Names ===\n');
    topSpecies.forEach((m, i) => {
      console.log(`${i + 1}. ${m.our_species} - ${m.common_names_available} names`);
    });
  }

  // Show unmatched species
  const unmatched = matches.filter(m => !m.fishbase_match).slice(0, 20);
  if (unmatched.length > 0) {
    console.log('\n=== Sample of Unmatched Species (first 20) ===\n');
    unmatched.forEach((m, i) => {
      console.log(`${i + 1}. ${m.our_species}`);
    });
  }

  console.log('\n');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
