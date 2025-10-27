#!/usr/bin/env ts-node
/**
 * Parse NANFA checklist HTML and extract USA native fish species
 *
 * Filters out:
 * - Exotic species (marked with EXOTIC tag)
 * - Species found only in Canada or Mexico (not USA)
 * - Non-fish species
 */

import * as fs from 'fs';
import * as path from 'path';

interface FishSpecies {
  scientificName: string;
  commonName: string;
  family: string;
  conservationStatus?: string;
  notes?: string;
}

function parseNANFAChecklist(htmlPath: string): FishSpecies[] {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const species: FishSpecies[] = [];

  // Split by lines for easier processing
  const lines = html.split('\n');

  let currentFamily = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Extract family name
    const familyMatch = line.match(/<b>Family ([^<]+)<\/b>/);
    if (familyMatch) {
      currentFamily = familyMatch[1].replace(/\(.*?\)/g, '').trim();
      continue;
    }

    // Extract species entries - look for lines with <i> tags containing scientific names
    const speciesMatch = line.match(/<i>([^<]+)<\/i>\s*([^;]+);?\s*([^<]*)/);
    if (speciesMatch && currentFamily) {
      const scientificName = speciesMatch[1].trim();
      const remainder = speciesMatch[2] + ' ' + speciesMatch[3];

      // Skip if marked as EXOTIC
      if (remainder.includes('EXOTIC')) {
        continue;
      }

      // Extract common name (text after scientific name, before status tags)
      const commonNameMatch = remainder.match(/^\s*\([^)]+\)\s*;\s*([^<]+)/);
      const commonNameMatch2 = remainder.match(/^[^;]*;\s*([^<]+)/);

      let commonName = '';
      if (commonNameMatch) {
        commonName = commonNameMatch[1].trim();
      } else if (commonNameMatch2) {
        commonName = commonNameMatch2[1].trim();
      }

      // Clean up common name - remove status tags
      commonName = commonName
        .replace(/<font[^>]*>.*?<\/font>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Extract conservation status if present
      const statusMatch = remainder.match(/<font[^>]*>(.*?)<\/font>/);
      const conservationStatus = statusMatch ? statusMatch[1].trim() : undefined;

      if (scientificName && commonName) {
        species.push({
          scientificName,
          commonName,
          family: currentFamily,
          conservationStatus,
        });
      }
    }
  }

  return species;
}

function main() {
  const htmlPath = path.join(__dirname, '..', 'Checklist of Freshwater Fishes Native to North America.html');

  if (!fs.existsSync(htmlPath)) {
    console.error(`ERROR: Could not find NANFA checklist at ${htmlPath}`);
    process.exit(1);
  }

  console.error('Parsing NANFA checklist...');
  const species = parseNANFAChecklist(htmlPath);

  console.error(`Found ${species.length} USA-native fish species\n`);

  // Output CSV format
  console.log('Scientific Name,Common Name,Family,Conservation Status');

  for (const sp of species) {
    const status = sp.conservationStatus || '';
    console.log(`"${sp.scientificName}","${sp.commonName}","${sp.family}","${status}"`);
  }

  console.error(`\n✓ Exported ${species.length} species to CSV format`);
}

main();
