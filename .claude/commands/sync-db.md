# Sync Database from Production

Download the latest production database and replace your local development database.

## Steps to perform:

1. **Create backup on production server**
   - SSH to BAP server
   - Navigate to `/mnt/basny-data/app/database`
   - Use sqlite3 `.backup` command to create a clean backup in `/tmp` with timestamp
   - Example: `/tmp/basny_backup_YYYYMMDD_HHMMSS.db`

2. **Download backup to local machine**
   - Use `scp` to download the backup file from BAP server
   - Save to `/tmp/basny_production_sync_YYYYMMDD_HHMMSS.db`

3. **Backup current local database**
   - Copy `db/database.db` to `backups/database.db.backup_YYYYMMDD_HHMMSS`
   - This preserves your current local state in case you need to revert

4. **Replace local database**
   - Copy the downloaded production backup to `db/database.db`
   - Verify the file size is reasonable (should be ~4MB)

5. **Restart dev server**
   - Kill any running nodemon/dev server processes
   - Run `npm run dev` to restart the server
   - Migrations will run automatically on startup
   - Wait for server to start and show "Server running at http://localhost:4200"

6. **Verify sync**
   - Query the database to check record counts (members, submissions)
   - Compare with production to ensure sync was successful

## Important notes:
- Always use SSH config alias "BAP" for the production server
- Production database path: `/mnt/basny-data/app/database/database.db`
- Always create timestamped backups before overwriting
- Use `npm run dev` (NOT `npm start` or manual builds)
- Migrations will apply automatically when server starts
