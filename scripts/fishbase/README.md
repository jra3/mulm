# FishBase Integration

Standalone DuckDB-based utilities for pulling FishBase data from Hugging Face and enriching our species database.

## Overview

FishBase (via [cboettig/fishbase](https://huggingface.co/datasets/cboettig/fishbase) on Hugging Face) contains:
- **36,000+ fish species**
- **332,000+ common names** in multiple languages
- Comprehensive taxonomy, ecology, reproduction, and distribution data

This toolkit uses DuckDB to query FishBase parquet files directly from Hugging Face without downloading the entire dataset.

## Quick Start

### Install Dependencies

```bash
npm install  # DuckDB is included as a dev dependency
```

### Download FishBase Cache (Recommended)

For better performance and to avoid rate limiting, download core tables to local cache:

```bash
# Download core tables (species, comnames, ecology, spawning, etc.) - ~35MB
npm run script scripts/fishbase/download-cache.ts

# Or download ALL tables - ~200MB
npm run script scripts/fishbase/download-cache.ts -- --all

# Or download a specific table
npm run script scripts/fishbase/download-cache.ts -- --table=species
```

Once cached, all scripts automatically use local files instead of remote URLs (10x faster!).

### Explore FishBase Data

```bash
# List available tables
npm run script scripts/fishbase/explore.ts -- tables

# Preview a table
npm run script scripts/fishbase/explore.ts -- preview species

# Show table schema
npm run script scripts/fishbase/explore.ts -- schema comnames

# Count rows
npm run script scripts/fishbase/explore.ts -- count species

# Search for a specific species
npm run script scripts/fishbase/explore.ts -- search Corydoras paleatus
```

### Custom Database Path

All scripts support custom database paths via command-line argument or environment variable:

```bash
# Using command-line argument
npm run script scripts/fishbase/importers/common-names.ts -- --db=/path/to/mulm.db

# Using environment variable
DB_PATH=/path/to/mulm.db npm run script scripts/fishbase/importers/common-names.ts

# Default path (if not specified)
# scripts/fishbase/../../../db/database.db
```

Priority order: `--db=` argument > `DB_PATH` env var > default path

## Using Scripts in Production

The FishBase scripts are compiled to JavaScript and included in the Docker image.

### Access Container Shell

```bash
# SSH into production server
ssh BAP

# Get shell in container
sudo docker exec -it basny-app sh
```

### Run Scripts in Container

```bash
# Inside the container:
DB_PATH=/mnt/basny-data/app/mulm.db node scripts/fishbase/explore.js search "Betta splendens"

# Or from outside the container:
ssh BAP "sudo docker exec basny-app node scripts/fishbase/explore.js search 'Betta splendens'"

# Import common names to production
ssh BAP "sudo docker exec basny-app sh -c 'DB_PATH=/mnt/basny-data/app/mulm.db node scripts/fishbase/importers/common-names.js --execute'"

# Download cache to container
ssh BAP "sudo docker exec basny-app node scripts/fishbase/download-cache.js"
```

### Production Database Path

The production database is at: `/mnt/basny-data/app/mulm.db`

Always use `DB_PATH` environment variable or `--db` argument when running in production.

## Available Tables

### Core Tables
- `species` - Main species table with taxonomy, max length, habitat
- `genera` - Genus-level taxonomy
- `families` - Family-level taxonomy
- `orders` - Order-level taxonomy

### Names
- `comnames` - Common names in multiple languages
- `synonyms` - Scientific name synonyms

### Ecology & Habitat
- `ecology` - Habitat preferences, climate zones, feeding behavior
- `stocks` - Geographic stocks/populations
- `ecosystem` - Ecosystem associations

### Reproduction
- `spawning` - Spawning seasons, temperatures, behavior
- `spawnagg` - Aggregated spawning data
- `fecundity` - Fecundity data (eggs per spawn)
- `maturity` - Maturity data

### Physical Characteristics
- `morphdat` - Morphometric data
- `morphmet` - Morphometric methods

### Distribution
- `country` - Country distribution
- `faoareas` - FAO fishing areas

### References
- `refrens` - Reference citations

## Project Structure

```
scripts/fishbase/
├── README.md                 # This file
├── .gitignore               # Ignore cache and DB files
├── duckdb-utils.ts          # Core DuckDB utilities (auto-uses cache)
├── explore.ts               # Exploration CLI tool
├── download-cache.ts        # Download parquet files to cache
├── match-species.ts         # Match our species against FishBase
├── importers/
│   ├── common-names.ts      # Import common names ✅
│   ├── reference-links.ts   # Import FishBase URLs ✅
│   ├── ecology.ts           # [TODO] Import ecology data
│   └── fecundity.ts         # [TODO] Import breeding data
└── cache/                   # Cached parquet files (~35MB, git-ignored)
```

## Cache Management

The toolkit supports local caching for better performance and offline access.

### Download Cache

```bash
# Download core tables (recommended, ~35MB)
npm run script scripts/fishbase/download-cache.ts

# Download all available tables (~200MB)
npm run script scripts/fishbase/download-cache.ts -- --all

# Download specific table
npm run script scripts/fishbase/download-cache.ts -- --table=fecundity
```

### Cache Behavior

- **Automatic fallback**: Scripts check cache first, use remote URLs if not cached
- **No rate limiting**: Local queries are instant and unlimited
- **10x faster**: Cached queries complete in ~1 second vs ~10 seconds remote
- **Git-ignored**: Cache directory is excluded from version control

### Clear Cache

```bash
rm -rf scripts/fishbase/cache/
```

## Development Phases

### Phase 1: Scaffolding ✅
- [x] Install DuckDB
- [x] Create directory structure
- [x] Set up basic utilities
- [x] Local caching system

### Phase 2: Exploration ✅
- [x] Create exploration CLI
- [x] Query FishBase tables
- [x] Test data quality

### Phase 3: Species Matching ✅
- [x] Match our species against FishBase
- [x] Identify coverage gaps (82% match rate)
- [x] Handle synonyms

### Phase 4: Import Common Names ✅
- [x] Design import strategy
- [x] Implement common name importer
- [x] Preview and dry-run
- [x] Import 1,972 common names

### Phase 5: Reference Links ✅
- [x] Design reference link strategy
- [x] Import FishBase URLs for 1,393 species
- [x] Store SpecCodes for future use

### Phase 6: Additional Enrichments (Future)
- [ ] Ecology data import
- [ ] Taxonomy validation
- [ ] Breeding info import (fecundity, spawning)

## Completed Integrations

1. ✅ **Common names import** - Imported 1,972 English common names for 1,397 species
2. ✅ **Reference links** - Added FishBase URLs for 1,393 species with SpecCodes stored
3. ✅ **Local caching** - 10x performance improvement with cached parquet files

## Potential Future Enhancements

1. **Ecology enrichment** - Add habitat, depth range, climate zone data
2. **Breeding information** - Import fecundity data for submission review pages
3. **Taxonomy validation** - Flag species where FishBase uses different names
4. **Water parameters** - Add pH, temperature, hardness ranges
5. **Physical characteristics** - Add max length/weight data
6. **Distribution data** - Add native regions and countries

## Technical Notes

- **DuckDB** - Embedded database with native parquet support
- **httpfs extension** - Read parquet files directly from Hugging Face
- **No downloads** - Queries stream data as needed
- **Standalone** - Separate from main SQLite database
- **TypeScript** - Full type safety for all queries

## Data License

FishBase data is licensed as **CC-BY-NC** by the FishBase.org team. Commercial use requires permission from FishBase.

## References

- FishBase: https://fishbase.org
- Dataset: https://huggingface.co/datasets/cboettig/fishbase
- rfishbase R package: https://docs.ropensci.org/rfishbase/
