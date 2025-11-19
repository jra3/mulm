# External Data Sync Scripts

This directory contains scripts for syncing external species data from multiple sources.

## Quick Reference

### Master Orchestrator (Recommended)

```bash
# Dry-run all sources
npm run script scripts/sync-all-external-data.ts

# Execute all sources
npm run script scripts/sync-all-external-data.ts -- --execute

# Test with limited species
npm run script scripts/sync-all-external-data.ts -- --execute --limit=5
```

### Individual Source Syncs

```bash
# Wikipedia/Wikidata
npm run script scripts/sync-wikipedia-external-data.ts -- --execute

# GBIF
npm run script scripts/sync-gbif-external-data.ts -- --execute

# FishBase (DuckDB-based)
npm run script scripts/sync-fishbase-external-data-duckdb.ts -- --execute
```

## Scripts

| Script | Description | Species Coverage |
|--------|-------------|------------------|
| `sync-all-external-data.ts` | **Master orchestrator** - runs all syncs in sequence | All |
| `sync-wikipedia-external-data.ts` | Wikipedia & Wikidata integration | Fish, Coral, Invert, Plant |
| `sync-gbif-external-data.ts` | GBIF (Global Biodiversity Information Facility) | Fish, Coral, Invert, Plant |
| `sync-fishbase-external-data-duckdb.ts` | FishBase (via local DuckDB cache) | Fish only |

## Common Arguments

All scripts support these arguments:

```bash
--execute           # Actually modify database (default is dry-run)
--force             # Re-sync even if recently synced (<90 days)
--limit=N           # Limit to N species (for testing)
--species-id=ID     # Sync specific species by ID
--species-type=TYPE # Filter by type (Fish, Coral, Invert, Plant)
--db=/path/to/db    # Custom database path
```

## Automated Sync (Cron)

### Setup

```bash
# On production server
cd /opt/basny
./scripts/setup-external-data-cron.sh

# Custom schedule (2 AM Sundays)
./scripts/setup-external-data-cron.sh --schedule "0 2 * * 0"
```

### Monitor

```bash
# View logs
tail -f /var/log/mulm/external-data-sync.log

# Check cron
crontab -l
```

See [docs/EXTERNAL_DATA_CRON_SETUP.md](../docs/EXTERNAL_DATA_CRON_SETUP.md) for complete guide.

## Workflow Examples

### Initial Sync (First Time)

```bash
# 1. Dry-run to preview
npm run script scripts/sync-all-external-data.ts

# 2. If results look good, execute
npm run script scripts/sync-all-external-data.ts -- --execute
```

### Regular Updates (Automated)

Set up cron job to run daily at 3 AM - syncs only species that:
- Have approved submissions
- Haven't been synced in 90 days
- Are newly added

### Manual Update

```bash
# Sync all sources for species that need it
npm run script scripts/sync-all-external-data.ts -- --execute

# Force re-sync everything
npm run script scripts/sync-all-external-data.ts -- --execute --force

# Sync only new coral species
npm run script scripts/sync-gbif-external-data.ts -- --execute --species-type=Coral
```

### Testing

```bash
# Test with 1 species per source
npm run script scripts/sync-all-external-data.ts -- --limit=1

# Test specific species
npm run script scripts/sync-wikipedia-external-data.ts -- --species-id=61  # Guppy
```

## How It Works

### Data Flow

```
┌─────────────────┐
│  Species with   │
│  Submissions    │
└────────┬────────┘
         │
         ├──► Wikipedia/Wikidata ──► Article URLs, Images
         ├──► GBIF ──────────────► Species Pages, Specimen Photos
         └──► FishBase ──────────► Fish Data, Images
                │
                ▼
         ┌──────────────┐
         │   Database   │
         │  - External  │
         │    References│
         │  - Images    │
         │  - Sync Logs │
         └──────────────┘
```

### Rate Limiting

Scripts are configured to be respectful to API providers:

- **Wikipedia**: 100ms between requests
- **GBIF**: 120ms between requests
- **FishBase**: Local data (no API calls)
- **Orchestrator**: 30 second pause between sources

### Sync Logic

1. **Query** species with approved submissions
2. **Skip** species synced within 90 days (unless `--force`)
3. **Prioritize** by submission count (most popular first)
4. **Match** species name with external database
5. **Extract** URLs and images
6. **Store** only new data (no duplicates)
7. **Log** all operations for debugging

## Output

### Dry-Run (Default)

Shows what would be synced without modifying database:

```
[1/5] Processing Poecilia reticulata (Fish)... ✅ 2 links, 3 images
[2/5] Processing Neocaridina davidi (Invert)... ✅ 2 links, 2 images
```

### Execute Mode

Actually adds data to database:

```
Mode: 🔴 EXECUTE (will modify database)
[1/5] Processing Poecilia reticulata (Fish)... ✅ 2 links, 3 images
✅ Sync completed!
```

### Summary Report

```
=== Summary ===

Total processed: 53
  ✅ Success: 41
  ❌ Not found: 12
  ⏭️  Skipped: 0
  ⚠️  Errors: 0

Total new links: 41
Total new images: 47
```

## Troubleshooting

### No Species Found

**Symptom:** "Found 0 species to process"

**Cause:** All species synced within 90 days

**Solution:** Use `--force` to re-sync

### Species Not Found

**Symptom:** "❌ Not found" for certain species

**Common causes:**
- Capitalization (should be "Danio kerri" not "Danio Kerri")
- Typos in scientific names
- Generic/unidentified species ("sp.", common names)

### API Errors

**Symptom:** Connection errors, timeouts

**Solutions:**
- Check internet connection
- Verify API status (Wikipedia, GBIF)
- Increase timeout in config
- Run with `--limit` to reduce load

## Performance

### Typical Sync Times

| Species Count | Duration |
|--------------|----------|
| 1-5 species | ~1-2 min |
| 10-20 species | ~3-6 min |
| 50-100 species | ~15-30 min |

### Database Impact

Minimal - scripts use:
- Read-only queries for species lookup
- Small transactions for inserts
- Indexed columns for lookups
- No deletions

Safe to run while site is live (during low-traffic hours).

## Related Documentation

- [External Data Sources Wiki](https://github.com/jra3/mulm/wiki/External-Data-Sources) - Complete integration guide
- [EXTERNAL_DATA_CRON_SETUP.md](../docs/EXTERNAL_DATA_CRON_SETUP.md) - Production cron setup
- [Database Schema Wiki](https://github.com/jra3/mulm/wiki/Database-Schema) - Schema documentation

---

**Last Updated:** November 19, 2025
