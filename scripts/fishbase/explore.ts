/**
 * Exploration script for FishBase data
 *
 * Usage:
 *   npm run script scripts/fishbase/explore.ts -- [command]
 *
 * Commands:
 *   tables              List available FishBase tables
 *   preview [table]     Preview a table (first 10 rows)
 *   schema [table]      Show table schema
 *   count [table]       Count rows in a table
 *   search [genus] [species]  Search for a species
 */

import { createDuckDBConnection, createFishBaseView, FISHBASE_TABLES } from './duckdb-utils';

interface SpeciesResult {
  SpecCode: number;
  Genus: string;
  Species: string;
  FBname: string | null;
  Length: number | null;
  CommonLength: number | null;
  BodyShapeI: string | null;
  DemersPelag: string | null;
}

interface CommonNameResult {
  ComName: string;
  Language: string;
  SpecCode: number;
}

interface EcologyResult {
  SpecCode: number;
  FeedingType: string | null;
  DietTroph: number | null;
  FoodTroph: number | null;
  DietSeTroph: number | null;
  DietRemark: string | null;
  Stream: number | null;
  Lakes: number | null;
  Benthic: number | null;
  Demersal: number | null;
}

async function listTables() {
  console.log('\n=== Available FishBase Tables ===\n');

  const categories = {
    'Core Tables': ['species', 'genera', 'families', 'orders'],
    'Names': ['comnames', 'synonyms'],
    'Ecology & Habitat': ['ecology', 'stocks', 'ecosystem'],
    'Reproduction': ['spawning', 'spawnagg', 'fecundity', 'maturity'],
    'Physical Characteristics': ['morphdat', 'morphmet'],
    'Distribution': ['country', 'faoareas'],
    'References': ['refrens'],
  };

  for (const [category, tables] of Object.entries(categories)) {
    console.log(`\n${category}:`);
    tables.forEach(table => console.log(`  - ${table}`));
  }

  console.log('\nUse: npm run script scripts/fishbase/explore.ts -- preview [table]\n');
}

async function previewTable(conn: ReturnType<typeof createDuckDBConnection>, tableName: string) {
  console.log(`\n=== Preview of ${tableName} (first 10 rows) ===\n`);

  await createFishBaseView(await conn, tableName);
  const results = await (await conn).all(`SELECT * FROM fb_${tableName} LIMIT 10`);

  if (results.length === 0) {
    console.log('No data found');
    return;
  }

  console.table(results);
}

async function showSchema(conn: ReturnType<typeof createDuckDBConnection>, tableName: string) {
  console.log(`\n=== Schema for ${tableName} ===\n`);

  await createFishBaseView(await conn, tableName);
  const results = await (await conn).all(`DESCRIBE fb_${tableName}`);

  console.table(results);
}

async function countRows(conn: ReturnType<typeof createDuckDBConnection>, tableName: string) {
  console.log(`\n=== Row count for ${tableName} ===\n`);

  await createFishBaseView(await conn, tableName);
  const results = await (await conn).all<{ count: number }>(`SELECT COUNT(*) as count FROM fb_${tableName}`);

  console.log(`Total rows: ${results[0].count.toLocaleString()}`);
}

async function searchSpecies(
  conn: ReturnType<typeof createDuckDBConnection>,
  genus: string,
  species: string
) {
  console.log(`\n=== Searching for ${genus} ${species} ===\n`);

  const resolvedConn = await conn;

  // Create views
  await createFishBaseView(resolvedConn, 'species');
  await createFishBaseView(resolvedConn, 'comnames');
  await createFishBaseView(resolvedConn, 'ecology');

  // Search for the species
  const speciesResults = await resolvedConn.all<SpeciesResult>(`
    SELECT
      SpecCode,
      Genus,
      Species,
      FBname,
      Length,
      CommonLength,
      BodyShapeI,
      DemersPelag
    FROM fb_species
    WHERE LOWER(Genus) = LOWER(?)
      AND LOWER(Species) = LOWER(?)
  `, genus, species);

  if (speciesResults.length === 0) {
    console.log('Species not found in FishBase');
    return;
  }

  console.log('Species Info:');
  console.table(speciesResults);

  const specCode = speciesResults[0].SpecCode;

  // Get common names
  const commonNames = await resolvedConn.all<CommonNameResult>(`
    SELECT ComName, Language, SpecCode
    FROM fb_comnames
    WHERE SpecCode = ?
    ORDER BY Language, ComName
  `, specCode);

  if (commonNames.length > 0) {
    console.log('\nCommon Names:');
    console.table(commonNames);
  }

  // Get ecology info
  const ecology = await resolvedConn.all<EcologyResult>(`
    SELECT
      SpecCode,
      FeedingType,
      DietTroph,
      FoodTroph,
      DietSeTroph,
      DietRemark,
      Stream,
      Lakes,
      Benthic,
      Demersal
    FROM fb_ecology
    WHERE SpecCode = ?
    LIMIT 1
  `, specCode);

  if (ecology.length > 0) {
    console.log('\nEcology Info:');
    console.table(ecology);
  }
}

async function main() {
  const command = process.argv[2];
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];

  if (!command || command === 'help' || command === '--help') {
    console.log(`
FishBase Explorer

Usage:
  npm run script scripts/fishbase/explore.ts -- [command]

Commands:
  tables                    List available FishBase tables
  preview [table]           Preview a table (first 10 rows)
  schema [table]            Show table schema
  count [table]             Count rows in a table
  search [genus] [species]  Search for a species

Examples:
  npm run script scripts/fishbase/explore.ts -- tables
  npm run script scripts/fishbase/explore.ts -- preview species
  npm run script scripts/fishbase/explore.ts -- schema comnames
  npm run script scripts/fishbase/explore.ts -- count species
  npm run script scripts/fishbase/explore.ts -- search Corydoras paleatus
    `);
    return;
  }

  const conn = createDuckDBConnection();

  try {
    switch (command) {
      case 'tables':
        await listTables();
        break;

      case 'preview':
        if (!arg1) {
          console.error('Error: Table name required');
          process.exit(1);
        }
        await previewTable(conn, arg1);
        break;

      case 'schema':
        if (!arg1) {
          console.error('Error: Table name required');
          process.exit(1);
        }
        await showSchema(conn, arg1);
        break;

      case 'count':
        if (!arg1) {
          console.error('Error: Table name required');
          process.exit(1);
        }
        await countRows(conn, arg1);
        break;

      case 'search':
        if (!arg1 || !arg2) {
          console.error('Error: Genus and species required');
          process.exit(1);
        }
        await searchSpecies(conn, arg1, arg2);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.log('Use --help for usage information');
        process.exit(1);
    }

    await (await conn).close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
