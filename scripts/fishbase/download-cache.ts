/**
 * Download FishBase parquet files to local cache
 *
 * This downloads commonly-used FishBase tables to avoid rate limiting
 * and improve performance.
 *
 * Usage:
 *   npm run script scripts/fishbase/download-cache.ts                  # Download core tables
 *   npm run script scripts/fishbase/download-cache.ts -- --all         # Download all tables
 *   npm run script scripts/fishbase/download-cache.ts -- --table=species  # Download specific table
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import https from 'https';

const FISHBASE_VERSION = 'v24.07';
const FISHBASE_BASE_URL = `https://huggingface.co/datasets/cboettig/fishbase/resolve/main/data/fb/${FISHBASE_VERSION}/parquet`;
const CACHE_DIR = join(__dirname, 'cache');

// Core tables we use most often
const CORE_TABLES = [
  'species',
  'comnames',
  'ecology',
  'spawning',
  'fecundity',
  'genera',
  'families',
  'synonyms',
];

// All available tables (from the dataset)
const ALL_TABLES = [
  'species', 'comnames', 'ecology', 'spawning', 'fecundity', 'genera',
  'families', 'synonyms', 'stocks', 'ecosystem', 'spawnagg', 'maturity',
  'morphdat', 'morphmet', 'country', 'faoareas', 'refrens', 'orders',
  'broodstock', 'aquarium', 'aquamaint', 'diet', 'fooditems', 'popchar',
  'poplf', 'poplw', 'popqb', 'popgrowth', 'popdyn', 'larvae', 'oxygen',
  'speed', 'swimming', 'vision', 'reproduction', 'predators', 'ration',
  'respiration', 'gasexchange', 'introductions', 'stocks', 'disease',
];

async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = writeFileSync(destPath, '');

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          https.get(redirectUrl, (redirectResponse) => {
            const chunks: Buffer[] = [];
            redirectResponse.on('data', (chunk) => chunks.push(chunk));
            redirectResponse.on('end', () => {
              writeFileSync(destPath, Buffer.concat(chunks));
              resolve();
            });
            redirectResponse.on('error', reject);
          }).on('error', reject);
        } else {
          reject(new Error('Redirect location not found'));
        }
      } else if (response.statusCode === 200) {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          writeFileSync(destPath, Buffer.concat(chunks));
          resolve();
        });
        response.on('error', reject);
      } else {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
      }
    }).on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const downloadAll = args.includes('--all');
  const tableArg = args.find(arg => arg.startsWith('--table='));
  const specificTable = tableArg ? tableArg.split('=')[1] : null;

  console.log('\n=== FishBase Cache Downloader ===\n');

  // Create cache directory if it doesn't exist
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`Created cache directory: ${CACHE_DIR}`);
  }

  // Determine which tables to download
  let tablesToDownload: string[];
  if (specificTable) {
    tablesToDownload = [specificTable];
    console.log(`Downloading single table: ${specificTable}\n`);
  } else if (downloadAll) {
    tablesToDownload = ALL_TABLES;
    console.log(`Downloading ALL tables (${ALL_TABLES.length} tables)\n`);
  } else {
    tablesToDownload = CORE_TABLES;
    console.log(`Downloading core tables (${CORE_TABLES.length} tables)\n`);
  }

  let downloadedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const table of tablesToDownload) {
    const filename = `${table}.parquet`;
    const destPath = join(CACHE_DIR, filename);
    const url = `${FISHBASE_BASE_URL}/${filename}`;

    // Check if already cached
    if (existsSync(destPath)) {
      console.log(`  ⏭️  ${table} (already cached)`);
      skippedCount++;
      continue;
    }

    try {
      console.log(`  ⬇️  Downloading ${table}...`);
      await downloadFile(url, destPath);
      downloadedCount++;
      console.log(`  ✅ ${table} (downloaded)`);

      // Small delay to be nice to the server
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error: any) {
      console.error(`  ❌ ${table} (error: ${error.message})`);
      errorCount++;
    }
  }

  console.log('\n=== Download Summary ===\n');
  console.log(`Downloaded: ${downloadedCount}`);
  console.log(`Skipped (already cached): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`\nCache location: ${CACHE_DIR}`);

  if (downloadedCount > 0) {
    console.log('\n✅ Cache ready! Scripts will now use local files instead of remote URLs.');
  }

  console.log('');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
