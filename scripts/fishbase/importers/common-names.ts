/**
 * Import common names from FishBase into our species database
 *
 * Usage:
 *   npm run script scripts/fishbase/importers/common-names.ts                # Dry-run (preview)
 *   npm run script scripts/fishbase/importers/common-names.ts -- --execute   # Actually import
 *   npm run script scripts/fishbase/importers/common-names.ts -- --limit=10  # Test with 10 species
 *   npm run script scripts/fishbase/importers/common-names.ts -- --db=/path/to/db  # Custom DB path
 *   DB_PATH=/path/to/db npm run script scripts/fishbase/importers/common-names.ts  # Using env var
 */

import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { createDuckDBConnection, createFishBaseView } from '../duckdb-utils';
import { join } from 'path';

interface OurSpecies {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
}

interface ExistingCommonName {
  common_name_id: number;
  common_name: string;
}

interface FishBaseCommonName {
  ComName: string;
  Language: string;
  SpecCode: number;
}

interface ImportCandidate {
  group_id: number;
  scientific_name: string;
  common_name: string;
  is_duplicate: boolean;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getExistingCommonNames(sqlite: Database, groupId: number): Promise<Set<string>> {
  const existing: ExistingCommonName[] = await sqlite.all(`
    SELECT common_name_id, common_name
    FROM species_common_name
    WHERE group_id = ?
  `, groupId);

  return new Set(existing.map((n: ExistingCommonName) => n.common_name.toLowerCase().trim()));
}

async function main() {
  const args = process.argv.slice(2);
  const executeImport = args.includes('--execute');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  const dbArg = args.find(arg => arg.startsWith('--db='));
  const customDbPath = dbArg ? dbArg.split('=')[1] : null;

  console.log('\n=== FishBase Common Names Importer ===\n');
  console.log(`Mode: ${executeImport ? '🔴 EXECUTE (will modify database)' : '🟡 DRY-RUN (preview only)'}`);
  if (limit) {
    console.log(`Limit: Processing first ${limit} species only`);
  }
  console.log('');

  // Connect to our SQLite database
  // Priority: --db argument > DB_PATH env var > default path
  const dbPath = customDbPath || process.env.DB_PATH || join(__dirname, '../../../db/database.db');
  console.log(`Database: ${dbPath}\n`);
  const sqlite = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: executeImport ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY,
  });

  // Get our fish species
  let query = `
    SELECT
      group_id,
      canonical_genus,
      canonical_species_name
    FROM species_name_group
    WHERE species_type = 'Fish'
    ORDER BY canonical_genus, canonical_species_name
  `;

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const ourSpecies: OurSpecies[] = await sqlite.all(query);
  console.log(`Found ${ourSpecies.length} fish species in our database\n`);

  // Connect to DuckDB and load FishBase data
  console.log('Loading FishBase data...');
  const duckConn = await createDuckDBConnection();
  await createFishBaseView(duckConn, 'species');
  await createFishBaseView(duckConn, 'comnames');
  console.log('FishBase data loaded\n');

  // Track statistics
  let processedCount = 0;
  let matchedCount = 0;
  let totalNewNames = 0;
  let totalDuplicates = 0;
  const importCandidates: ImportCandidate[] = [];

  console.log('Matching species and fetching common names...\n');

  for (const species of ourSpecies) {
    processedCount++;
    const scientificName = `${species.canonical_genus} ${species.canonical_species_name}`;

    if (processedCount % 50 === 0) {
      console.log(`  Processed ${processedCount}/${ourSpecies.length} species...`);
    }

    try {
      // Find species in FishBase
      const fishbaseSpecies = await duckConn.all<{ SpecCode: number }>(`
        SELECT SpecCode
        FROM fb_species
        WHERE LOWER(Genus) = LOWER(?)
          AND LOWER(Species) = LOWER(?)
        LIMIT 1
      `, species.canonical_genus, species.canonical_species_name);

      if (fishbaseSpecies.length === 0) {
        continue; // Species not found in FishBase
      }

      matchedCount++;
      const specCode = fishbaseSpecies[0].SpecCode;

      // Get English common names
      const commonNames = await duckConn.all<FishBaseCommonName>(`
        SELECT DISTINCT ComName, Language, SpecCode
        FROM fb_comnames
        WHERE SpecCode = ?
          AND Language = 'English'
          AND ComName IS NOT NULL
          AND TRIM(ComName) != ''
        ORDER BY ComName
      `, specCode);

      if (commonNames.length === 0) {
        continue; // No common names available
      }

      // Get existing names for this species
      const existingNames = await getExistingCommonNames(sqlite, species.group_id);

      // Check which names are new
      for (const fbName of commonNames) {
        const commonName = fbName.ComName.trim();
        const isDuplicate = existingNames.has(commonName.toLowerCase());

        importCandidates.push({
          group_id: species.group_id,
          scientific_name: scientificName,
          common_name: commonName,
          is_duplicate: isDuplicate,
        });

        if (isDuplicate) {
          totalDuplicates++;
        } else {
          totalNewNames++;
        }
      }

      // Add small delay to avoid rate limiting
      if (processedCount % 10 === 0) {
        await sleep(100);
      }

    } catch (error: any) {
      if (error.message && error.message.includes('429')) {
        console.log(`\n⚠️  Rate limited by Hugging Face at species ${processedCount}. Waiting 10 seconds...`);
        await sleep(10000);
        // Retry this species
        processedCount--;
        continue;
      }
      console.error(`Error processing ${scientificName}:`, error.message);
    }
  }

  await duckConn.close();

  // Print statistics
  console.log('\n=== Import Summary ===\n');
  console.log(`Total species processed: ${processedCount}`);
  console.log(`Species matched in FishBase: ${matchedCount}`);
  console.log(`Total common names found: ${importCandidates.length}`);
  console.log(`New names to import: ${totalNewNames}`);
  console.log(`Duplicate names (will skip): ${totalDuplicates}`);

  // Show sample of what will be imported
  const newCandidates = importCandidates.filter(c => !c.is_duplicate);
  if (newCandidates.length > 0) {
    console.log('\n=== Sample of New Names (first 20) ===\n');
    newCandidates.slice(0, 20).forEach(c => {
      console.log(`  ${c.scientific_name} → "${c.common_name}"`);
    });

    if (newCandidates.length > 20) {
      console.log(`  ... and ${newCandidates.length - 20} more`);
    }
  }

  // Execute import if requested
  if (executeImport && totalNewNames > 0) {
    console.log('\n=== Executing Import ===\n');

    await sqlite.exec('BEGIN TRANSACTION');

    try {
      let importedCount = 0;

      for (const candidate of newCandidates) {
        await sqlite.run(`
          INSERT INTO species_common_name (group_id, common_name)
          VALUES (?, ?)
        `, candidate.group_id, candidate.common_name);

        importedCount++;

        if (importedCount % 100 === 0) {
          console.log(`  Imported ${importedCount}/${totalNewNames} names...`);
        }
      }

      await sqlite.exec('COMMIT');
      console.log(`\n✅ Successfully imported ${importedCount} common names!`);
    } catch (error) {
      await sqlite.exec('ROLLBACK');
      console.error('\n❌ Import failed, rolled back transaction:', error);
      throw error;
    }
  } else if (!executeImport && totalNewNames > 0) {
    console.log('\n💡 To execute this import, run:');
    console.log('   npm run script scripts/fishbase/importers/common-names.ts -- --execute');
  } else if (totalNewNames === 0) {
    console.log('\n✅ No new names to import (all existing names are already in the database)');
  }

  await sqlite.close();
  console.log('');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
