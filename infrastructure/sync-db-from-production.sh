#!/bin/bash
# Pull the production database into local development.
#
# Production runs on Fly.io (app `basny-bap`) with no persistent SSH box, so the
# old `ssh BAP` + scp approach is gone. Instead, Litestream continuously
# replicates the prod DB to Cloudflare R2 (bucket `basny-db-replica`, see
# litestream.yml). This script restores the latest replica snapshot, which is a
# consistent point-in-time copy and does NOT touch the running prod machine.
#
# Requirements:
#   - litestream    (Arch/Omarchy: `yay -S litestream`)
#   - jq, sqlite3
#   - src/config.json with R2 creds under .storage (same file the app uses)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
LITESTREAM_CONFIG="litestream.yml"
# Identifies which replica to restore — must match the `path:` in litestream.yml,
# NOT a local path. The file does not need to exist locally.
REPLICA_DB_PATH="/mnt/app-data/database/database.db"
LOCAL_DB_PATH="db/database.db"
CONFIG_JSON="src/config.json"
BACKUP_DIR="backups"

echo -e "${GREEN}=== Database Sync from Production (Litestream/R2) ===${NC}"
echo ""

# Step 0: Preflight
echo -e "${YELLOW}Step 0: Checking prerequisites...${NC}"
for bin in litestream jq sqlite3; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo -e "${RED}✗ '$bin' not found.${NC}"
    [ "$bin" = "litestream" ] && echo "  Install with: yay -S litestream"
    exit 1
  }
done
[ -f "$LITESTREAM_CONFIG" ] || { echo -e "${RED}✗ Missing $LITESTREAM_CONFIG (run from repo root).${NC}"; exit 1; }
[ -f "$CONFIG_JSON" ]       || { echo -e "${RED}✗ Missing $CONFIG_JSON (needs R2 creds).${NC}"; exit 1; }

# R2 credentials for Litestream.
# Prefer creds already in the environment (so you never have to commit R2 keys);
# otherwise fall back to src/config.json's .storage block (as start.sh does on
# production). NOTE: if these end up empty, Litestream silently falls back to the
# ambient AWS credential chain (~/.aws), which yields a confusing
# "access key has length 20, should be 32" error — so we hard-fail on empty.
export LITESTREAM_ACCESS_KEY_ID="${LITESTREAM_ACCESS_KEY_ID:-$(jq -r '.storage.s3AccessKeyId // empty' "$CONFIG_JSON")}"
export LITESTREAM_SECRET_ACCESS_KEY="${LITESTREAM_SECRET_ACCESS_KEY:-$(jq -r '.storage.s3Secret // empty' "$CONFIG_JSON")}"
if [ -z "$LITESTREAM_ACCESS_KEY_ID" ] || [ -z "$LITESTREAM_SECRET_ACCESS_KEY" ]; then
  echo -e "${RED}✗ No R2 credentials found.${NC}"
  echo "  The R2 keys live only in the Fly 'CONFIG_JSON' secret (write-only on Fly)."
  echo "  Get the R2 API token from Cloudflare (R2 → Manage API Tokens), then either:"
  echo "    - export LITESTREAM_ACCESS_KEY_ID=... LITESTREAM_SECRET_ACCESS_KEY=...   (one-off), or"
  echo "    - fill in .storage.s3AccessKeyId / .storage.s3Secret in $CONFIG_JSON"
  exit 1
fi
# R2 access keys are 32 chars; a 20-char key is an AWS key picked up by mistake.
if [ "${#LITESTREAM_ACCESS_KEY_ID}" -ne 32 ]; then
  echo -e "${YELLOW}⚠ Access key is ${#LITESTREAM_ACCESS_KEY_ID} chars; R2 keys are 32.${NC}"
  echo "  (AWS keys are 20 — make sure you're using the R2 token, not an AWS one.)"
fi
echo -e "${GREEN}✓ Prerequisites OK${NC}"
echo ""

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Step 1: Restore the latest replica snapshot to a temp file.
# litestream restore refuses to overwrite an existing -o file, so we restore to
# a temp path and swap it in only after a successful restore + local backup.
echo -e "${YELLOW}Step 1: Restoring latest snapshot from R2...${NC}"
TEMP_DB="/tmp/basny_production_sync_${TIMESTAMP}.db"
rm -f "$TEMP_DB"
if ! litestream restore -config "$LITESTREAM_CONFIG" -o "$TEMP_DB" "$REPLICA_DB_PATH"; then
  echo -e "${RED}✗ Restore failed. Check R2 creds and that the replica exists.${NC}"
  exit 1
fi
RESTORED_SIZE=$(ls -lh "$TEMP_DB" | awk '{print $5}')
echo -e "${GREEN}✓ Restored snapshot: ${TEMP_DB} (${RESTORED_SIZE})${NC}"
echo ""

# Step 2: Back up current local database (if any).
echo -e "${YELLOW}Step 2: Backing up current local database...${NC}"
mkdir -p "$BACKUP_DIR"
if [ -f "$LOCAL_DB_PATH" ]; then
  LOCAL_BACKUP="${BACKUP_DIR}/database.db.backup_${TIMESTAMP}"
  cp "$LOCAL_DB_PATH" "$LOCAL_BACKUP"
  echo -e "${GREEN}✓ Backed up: ${LOCAL_BACKUP} ($(ls -lh "$LOCAL_BACKUP" | awk '{print $5}'))${NC}"
else
  LOCAL_BACKUP="(none — no existing local DB)"
  echo -e "${GREEN}✓ No existing local DB to back up${NC}"
fi
echo ""

# Step 3: Move the restored snapshot into place.
echo -e "${YELLOW}Step 3: Replacing local database...${NC}"
mkdir -p "$(dirname "$LOCAL_DB_PATH")"
mv "$TEMP_DB" "$LOCAL_DB_PATH"
echo -e "${GREEN}✓ Replaced: ${LOCAL_DB_PATH} ($(ls -lh "$LOCAL_DB_PATH" | awk '{print $5}'))${NC}"
echo ""

# Step 4: Verify.
echo -e "${YELLOW}Step 4: Verifying restored database...${NC}"
sqlite3 "$LOCAL_DB_PATH" "SELECT 'Members: ' || COUNT(*) FROM members UNION ALL SELECT 'Submissions: ' || COUNT(*) FROM submissions UNION ALL SELECT 'Species Groups: ' || COUNT(*) FROM species_name_group;"
echo ""

# Done.
echo -e "${GREEN}=== Sync Complete ===${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Restart your dev server: npm run dev"
echo "2. Migrations run automatically on startup"
echo "3. Verify the app at http://localhost:4200"
echo ""
echo -e "${YELLOW}Local backup of your previous DB:${NC} ${LOCAL_BACKUP}"
