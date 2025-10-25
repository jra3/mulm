# Sync Database from Production

Run the automated script to sync the production database to your local development environment.

## Quick Start

```bash
./infrastructure/sync-db-from-production.sh
```

This script will:
1. Create timestamped backup on production server
2. Download backup to local machine
3. Backup your current local database
4. Replace local database with production data
5. Verify sync with count comparisons
6. Show next steps

## After Sync

Restart your dev server:
```bash
npm run dev
```

Migrations will run automatically on startup.

## Manual Steps (if needed)

See `infrastructure/sync-db-from-production.sh` for the full implementation.

Key paths:
- Production DB: `/mnt/basny-data/app/database/database.db`
- Local DB: `db/database.db`
- Backups: `backups/` directory
- SSH alias: `BAP`
