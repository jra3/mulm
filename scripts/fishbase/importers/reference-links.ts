/**
 * Import FishBase reference links and SpecCodes
 *
 * This script:
 * - Matches species against FishBase to get SpecCode
 * - Stores SpecCode in fishbase_spec_code field
 * - Adds FishBase URL to external_references JSON array
 *
 * Usage:
 *   npm run script scripts/fishbase/importers/reference-links.ts                # Dry-run (preview)
 *   npm run script scripts/fishbase/importers/reference-links.ts -- --execute   # Actually import
 *   npm run script scripts/fishbase/importers/reference-links.ts -- --limit=10  # Test with 10 species
 */

import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { createDuckDBConnection, createFishBaseView } from '../duckdb-utils';
import { join } from 'path';

interface OurSpecies {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  external_references: string | null;
  fishbase_spec_code: number | null;
}

interface FishBaseMatch {
  SpecCode: number;
  Genus: string;
  Species: string;
}

interface UpdateCandidate {
  group_id: number;
  scientific_name: string;
  spec_code: number;
  fishbase_url: string;
  already_has_spec_code: boolean;
  already_has_url: boolean;
}

const FISHBASE_URL_BASE = 'https://www.fishbase.se/summary/';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function getFishBaseUrl(specCode: number): string {
  return `${FISHBASE_URL_BASE}${specCode}`;
}

function parseExternalReferences(jsonStr: string | null): string[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasExistingFishBaseUrl(urls: string[]): boolean {
  return urls.some(url => url.startsWith(FISHBASE_URL_BASE));
}

async function main() {
  const args = process.argv.slice(2);
  const executeImport = args.includes('--execute');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;

  console.log('\n=== FishBase Reference Links Importer ===\n');
  console.log(`Mode: ${executeImport ? '🔴 EXECUTE (will modify database)' : '🟡 DRY-RUN (preview only)'}`);
  if (limit) {
    console.log(`Limit: Processing first ${limit} species only`);
  }
  console.log('');

  // Connect to our SQLite database
  const dbPath = join(__dirname, '../../../db/database.db');
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
      canonical_species_name,
      external_references,
      fishbase_spec_code
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
  console.log('FishBase data loaded\n');

  // Track statistics
  let processedCount = 0;
  let matchedCount = 0;
  let alreadyHasSpecCode = 0;
  let alreadyHasUrl = 0;
  let newLinksToAdd = 0;
  const updateCandidates: UpdateCandidate[] = [];

  console.log('Matching species against FishBase...\n');

  for (const species of ourSpecies) {
    processedCount++;
    const scientificName = `${species.canonical_genus} ${species.canonical_species_name}`;

    if (processedCount % 50 === 0) {
      console.log(`  Processed ${processedCount}/${ourSpecies.length} species...`);
    }

    try {
      // Find species in FishBase
      const fishbaseSpecies = await duckConn.all<FishBaseMatch>(`
        SELECT SpecCode, Genus, Species
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
      const fishbaseUrl = getFishBaseUrl(specCode);

      // Check if we already have this SpecCode
      const hasSpecCode = species.fishbase_spec_code === specCode;

      // Check if we already have a FishBase URL
      const existingRefs = parseExternalReferences(species.external_references);
      const hasUrl = hasExistingFishBaseUrl(existingRefs);

      if (!hasSpecCode || !hasUrl) {
        newLinksToAdd++;
      }

      if (hasSpecCode) {
        alreadyHasSpecCode++;
      }

      if (hasUrl) {
        alreadyHasUrl++;
      }

      updateCandidates.push({
        group_id: species.group_id,
        scientific_name: scientificName,
        spec_code: specCode,
        fishbase_url: fishbaseUrl,
        already_has_spec_code: hasSpecCode,
        already_has_url: hasUrl,
      });

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
  console.log(`Already have SpecCode: ${alreadyHasSpecCode}`);
  console.log(`Already have FishBase URL: ${alreadyHasUrl}`);
  console.log(`New SpecCodes/URLs to add: ${newLinksToAdd}`);

  // Show sample of what will be updated
  const needsUpdate = updateCandidates.filter(c => !c.already_has_spec_code || !c.already_has_url);
  if (needsUpdate.length > 0) {
    console.log('\n=== Sample of Updates (first 20) ===\n');
    needsUpdate.slice(0, 20).forEach(c => {
      const status = [];
      if (!c.already_has_spec_code) status.push('add SpecCode');
      if (!c.already_has_url) status.push('add URL');
      console.log(`  ${c.scientific_name} (${c.spec_code}) → ${status.join(', ')}`);
      console.log(`    ${c.fishbase_url}`);
    });

    if (needsUpdate.length > 20) {
      console.log(`  ... and ${needsUpdate.length - 20} more`);
    }
  }

  // Execute import if requested
  if (executeImport && newLinksToAdd > 0) {
    console.log('\n=== Executing Import ===\n');

    await sqlite.exec('BEGIN TRANSACTION');

    try {
      let updatedCount = 0;
      let skippedDueToConflict = 0;

      for (const candidate of needsUpdate) {
        // Check if this SpecCode is already used by another species
        const existingSpecCode = await sqlite.get<{ group_id: number }>(
          'SELECT group_id FROM species_name_group WHERE fishbase_spec_code = ? AND group_id != ?',
          candidate.spec_code, candidate.group_id
        );

        if (existingSpecCode) {
          // Skip this update - SpecCode already assigned to another species
          skippedDueToConflict++;
          continue;
        }

        const existingRefs = parseExternalReferences(
          (await sqlite.get<{ external_references: string | null }>(
            'SELECT external_references FROM species_name_group WHERE group_id = ?',
            candidate.group_id
          ))?.external_references || null
        );

        // Add FishBase URL if not already present
        if (!hasExistingFishBaseUrl(existingRefs)) {
          existingRefs.push(candidate.fishbase_url);
        }

        // Update both SpecCode and external_references
        await sqlite.run(`
          UPDATE species_name_group
          SET
            fishbase_spec_code = ?,
            external_references = ?,
            fishbase_last_updated = datetime('now')
          WHERE group_id = ?
        `, candidate.spec_code, JSON.stringify(existingRefs), candidate.group_id);

        updatedCount++;

        if (updatedCount % 100 === 0) {
          console.log(`  Updated ${updatedCount}/${newLinksToAdd} species...`);
        }
      }

      if (skippedDueToConflict > 0) {
        console.log(`\n⚠️  Skipped ${skippedDueToConflict} species due to duplicate SpecCode conflicts`);
      }

      await sqlite.exec('COMMIT');
      console.log(`\n✅ Successfully updated ${updatedCount} species with FishBase data!`);
    } catch (error) {
      await sqlite.exec('ROLLBACK');
      console.error('\n❌ Import failed, rolled back transaction:', error);
      throw error;
    }
  } else if (!executeImport && newLinksToAdd > 0) {
    console.log('\n💡 To execute this import, run:');
    console.log('   npm run script scripts/fishbase/importers/reference-links.ts -- --execute');
  } else if (newLinksToAdd === 0) {
    console.log('\n✅ No updates needed (all matched species already have FishBase data)');
  }

  await sqlite.close();
  console.log('');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
