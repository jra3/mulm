# Sync Database from Production

Download the latest production database and replace your local development database.

## Steps to perform:

1. **Create backup on production server**
   - SSH to BAP server and create timestamped backup in `/tmp`
   - Command:
   ```bash
   ssh BAP "cd /mnt/basny-data/app/database && sqlite3 database.db \".backup /tmp/basny_backup_\$(date +%Y%m%d_%H%M%S).db\" && ls -lh /tmp/basny_backup_*.db | tail -1"
   ```
   - Note the backup filename from the output (e.g., `basny_backup_20251017_153952.db`)

2. **Download backup to local machine**
   - Use `scp` with the specific backup filename from step 1
   - Command (replace YYYYMMDD_HHMMSS with actual timestamp):
   ```bash
   scp BAP:/tmp/basny_backup_YYYYMMDD_HHMMSS.db /tmp/basny_production_sync_YYYYMMDD_HHMMSS.db
   ```

3. **Backup current local database**
   - IMPORTANT: Use a variable for timestamp to avoid shell escaping issues
   - Command:
   ```bash
   TIMESTAMP=$(date +%Y%m%d_%H%M%S) && cp db/database.db "backups/database.db.backup_${TIMESTAMP}" && ls -lh "backups/database.db.backup_${TIMESTAMP}"
   ```
   - ⚠️ DO NOT use `$(date +%Y%m%d_%H%M%S)` directly in the filename - it won't be evaluated!
   - ✅ ALWAYS assign to a variable first: `TIMESTAMP=$(date +%Y%m%d_%H%M%S)`

4. **Replace local database**
   - Copy the downloaded production backup to `db/database.db`
   - Command (use actual timestamp from step 2):
   ```bash
   cp /tmp/basny_production_sync_YYYYMMDD_HHMMSS.db db/database.db && ls -lh db/database.db
   ```
   - Verify the file size is reasonable (should be ~3-4MB)

5. **Restart dev server**
   - Kill any running nodemon/dev server processes
   - Commands:
   ```bash
   # Kill the current dev server background process (find the ID with /bashes)
   # Then start a new one:
   npm run dev
   ```
   - Migrations will run automatically on startup
   - Wait for server to start and show "Server running at http://localhost:4200"

6. **Verify sync**
   - Query both databases to compare record counts
   - Local:
   ```bash
   sqlite3 db/database.db "SELECT 'Members: ' || COUNT(*) FROM members UNION ALL SELECT 'Submissions: ' || COUNT(*) FROM submissions UNION ALL SELECT 'Species Groups: ' || COUNT(*) FROM species_name_group;"
   ```
   - Production:
   ```bash
   ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db \"SELECT 'Members: ' || COUNT(*) FROM members UNION ALL SELECT 'Submissions: ' || COUNT(*) FROM submissions UNION ALL SELECT 'Species Groups: ' || COUNT(*) FROM species_name_group;\""
   ```
   - Counts should match exactly

## Important notes:
- Always use SSH config alias "BAP" for the production server
- Production database path: `/mnt/basny-data/app/database/database.db`
- Local backups go in `backups/` directory (NOT `db/` directory)
- Always create timestamped backups before overwriting
- Use `npm run dev` (NOT `npm start` or manual builds)
- Migrations will apply automatically when server starts

## Common Issues:

**Timestamp not evaluated in filename:**
```bash
# ❌ WRONG - Creates file literally named "database.db.backup_$(date...)"
cp db/database.db "backups/database.db.backup_$(date +%Y%m%d_%H%M%S)"

# ✅ CORRECT - Use a variable
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp db/database.db "backups/database.db.backup_${TIMESTAMP}"
```

**Multiple background processes running:**
- Use `/bashes` command to see all running background processes
- Kill old dev servers before starting new ones to avoid port conflicts
