# External Data Sync Scripts

This directory contains scripts for syncing external species data from multiple sources with automatic image downloading to Cloudflare R2.

## Quick Reference

### The One Command (Recommended)

```bash
# Sync all species with external data AND download images to R2
npm run script scripts/sync-all-species-full-database.ts -- --execute --download-images --batch-size=500

# Run multiple times until "Found 0 species"
npm run script scripts/sync-all-species-full-database.ts -- --execute --download-images --batch-size=500
```

### Individual Source Syncs

```bash
# Wikipedia/Wikidata (all species)
npm run script scripts/sync-wikipedia-all-species.ts -- --execute --download-images --batch-size=500

# GBIF (all species)
npm run script scripts/sync-gbif-all-species.ts -- --execute --download-images --batch-size=500
```

## Scripts

| Script | Description | Coverage |
|--------|-------------|----------|
| `sync-all-species-full-database.ts` | **Master orchestrator** - Syncs all sources with image download | All 2,279 species |
| `sync-wikipedia-all-species.ts` | Wikipedia & Wikidata integration | All species types |
| `sync-gbif-all-species.ts` | GBIF (Global Biodiversity Information Facility) | All species types |

## Common Arguments

All scripts support these arguments:

```bash
--execute           # Actually modify database (default is dry-run)
--download-images   # Download images to R2 (recommended for production)
--batch-size=N      # Process N species per run (for large syncs)
--start-after=ID    # Resume from species ID (for interrupted syncs)
--force             # Re-sync even if recently synced (<90 days)
--species-type=TYPE # Filter by type (Fish, Coral, Invert, Plant)
--species-id=ID     # Sync specific species by ID
--db=/path/to/db    # Custom database path
```

## Where Sync Runs

Enrichment runs off-box, never inside the Fly app: run these scripts locally or from a cron job on another machine. The app has no in-app sync or admin page for it (removed in #461). The scripts write species data only to the database they're pointed at; `scripts/push-external-data.ts` then pushes the changes to prod through the admin API. See [`docs/EXTERNAL_DATA_CRON.md`](../docs/EXTERNAL_DATA_CRON.md) for the whole pipeline. `--download-images` also uploads image objects to the R2 bucket in `config.storage.s3Bucket`, so a run against a local database can still leave objects in that bucket.

## Workflow Examples

### Initial Sync (Full Database)

```bash
# Sync all 2,279 species with images downloaded to R2
npm run script scripts/sync-all-species-full-database.ts -- --execute --download-images --batch-size=500

# Continue until complete (run ~5 times for full database)
npm run script scripts/sync-all-species-full-database.ts -- --execute --download-images --batch-size=500
```

### Sync Specific Species Types

```bash
# Sync all corals with images
npm run script scripts/sync-wikipedia-all-species.ts -- --execute --download-images --species-type=Coral

# Sync all plants
npm run script scripts/sync-gbif-all-species.ts -- --execute --download-images --species-type=Plant
```

### Testing

```bash
# Test with small batch (2 species)
npm run script scripts/sync-all-species-full-database.ts -- --execute --download-images --batch-size=2

# Test specific species (guppy)
npm run script scripts/sync-wikipedia-all-species.ts -- --execute --download-images --species-id=61
```

### Resume from Interruption

```bash
# If interrupted at species ID 1500
npm run script scripts/sync-all-species-full-database.ts -- --execute --download-images --batch-size=500 --start-after=1500
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
         └──► GBIF ──────────────► Species Pages, Specimen Photos
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
- [Database Schema Wiki](https://github.com/jra3/mulm/wiki/Database-Schema) - Schema documentation

---

**Last Updated:** November 19, 2025
