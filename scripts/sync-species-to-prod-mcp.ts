/**
 * Sync species external data to production via MCP
 *
 * Usage:
 *   npm run script scripts/sync-species-to-prod-mcp.ts -- --species-id=61
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { join } from 'path';

interface SpeciesExternalData {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  external_references: string[];
  image_links: string[];
}

async function getSpeciesData(groupId: number): Promise<SpeciesExternalData | null> {
  const dbPath = join(__dirname, '../db/database.db');
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  });

  // Get species info
  const species = await db.get<{ canonical_genus: string; canonical_species_name: string }>(
    'SELECT canonical_genus, canonical_species_name FROM species_name_group WHERE group_id = ?',
    [groupId]
  );

  if (!species) {
    await db.close();
    return null;
  }

  // Get external references
  const refs = await db.all<{ reference_url: string }>(
    'SELECT reference_url FROM species_external_references WHERE group_id = ? ORDER BY display_order',
    [groupId]
  );

  // Get images
  const images = await db.all<{ image_url: string }>(
    'SELECT image_url FROM species_images WHERE group_id = ? ORDER BY display_order',
    [groupId]
  );

  await db.close();

  return {
    group_id: groupId,
    canonical_genus: species.canonical_genus,
    canonical_species_name: species.canonical_species_name,
    external_references: refs.map(r => r.reference_url),
    image_links: images.map(i => i.image_url),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const speciesIdArg = args.find(arg => arg.startsWith('--species-id='));

  if (!speciesIdArg) {
    console.error('❌ Missing required argument: --species-id=<id>');
    console.error('Usage: npm run script scripts/sync-species-to-prod-mcp.ts -- --species-id=61');
    process.exit(1);
  }

  const speciesId = parseInt(speciesIdArg.split('=')[1]);

  console.log(`\n=== Sync Species ${speciesId} to Production ===\n`);

  const data = await getSpeciesData(speciesId);

  if (!data) {
    console.error(`❌ Species ${speciesId} not found in local database`);
    process.exit(1);
  }

  console.log(`Species: ${data.canonical_genus} ${data.canonical_species_name}`);
  console.log(`External References: ${data.external_references.length}`);
  console.log(`Images: ${data.image_links.length}\n`);

  if (data.external_references.length === 0 && data.image_links.length === 0) {
    console.log('⚠️  No external data to sync for this species');
    return;
  }

  // Display data
  console.log('=== Data to Sync ===\n');

  if (data.external_references.length > 0) {
    console.log('External References:');
    data.external_references.forEach((ref, i) => console.log(`  ${i + 1}. ${ref}`));
    console.log('');
  }

  if (data.image_links.length > 0) {
    console.log('Images:');
    data.image_links.forEach((img, i) => console.log(`  ${i + 1}. ${img}`));
    console.log('');
  }

  // Generate MCP command
  console.log('=== MCP Command ===\n');
  console.log('Use the MCP tool: update_species_group');
  console.log('With arguments:\n');
  console.log(JSON.stringify({
    group_id: data.group_id,
    external_references: data.external_references,
    image_links: data.image_links,
  }, null, 2));
  console.log('\n');

  // Generate manual SQL for verification
  console.log('=== Or use SQL directly on production ===\n');
  console.log('-- Check current data:');
  console.log(`SELECT * FROM species_external_references WHERE group_id = ${data.group_id};`);
  console.log(`SELECT * FROM species_images WHERE group_id = ${data.group_id};`);
  console.log('');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
