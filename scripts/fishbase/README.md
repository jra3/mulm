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
├── duckdb-utils.ts          # Core DuckDB utilities
├── explore.ts               # Exploration CLI tool
├── match-species.ts         # [TODO] Match our species against FishBase
├── importers/
│   ├── common-names.ts      # [TODO] Import common names
│   ├── ecology.ts           # [TODO] Import ecology data
│   ├── taxonomy.ts          # [TODO] Validate taxonomy
│   └── fecundity.ts         # [TODO] Import breeding data
└── cache/                   # Cached parquet files (git-ignored)
```

## Development Phases

### Phase 1: Scaffolding ✅
- [x] Install DuckDB
- [x] Create directory structure
- [x] Set up basic utilities

### Phase 2: Exploration 🚧
- [x] Create exploration CLI
- [ ] Query FishBase tables
- [ ] Test data quality

### Phase 3: Species Matching
- [ ] Match our species against FishBase
- [ ] Identify coverage gaps
- [ ] Handle synonyms

### Phase 4: Import Common Names
- [ ] Design import strategy
- [ ] Implement common name importer
- [ ] Preview and dry-run

### Phase 5: Additional Enrichments
- [ ] Ecology data import
- [ ] Taxonomy validation
- [ ] Breeding info import
- [ ] Reference links

## Potential Use Cases

1. **Auto-populate common names** - Import 5-10 English common names per species
2. **Taxonomy validation** - Flag species where FishBase uses different names
3. **Ecology enrichment** - Add habitat, depth range, climate zone data
4. **Breeding information** - Show fecundity data on submission review pages
5. **Reference links** - Auto-add FishBase URLs to species pages
6. **Smart search** - Better species lookup with more synonyms

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
