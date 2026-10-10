#!/bin/sh
# Production startup script
set -e

# Materialize config.json from Fly secret. Always overwrite when CONFIG_JSON
# is set: the Dockerfile builder stage bakes in a sample config so tsc can
# resolve `import config from "./config.json"`, but at runtime the secret is
# the source of truth.
if [ -n "$CONFIG_JSON" ]; then
  printf '%s' "$CONFIG_JSON" > /app/src/config.json
fi

# Extract R2 credentials from config.json for Litestream
export LITESTREAM_ACCESS_KEY_ID=$(jq -r '.storage.s3AccessKeyId' /app/src/config.json)
export LITESTREAM_SECRET_ACCESS_KEY=$(jq -r '.storage.s3Secret' /app/src/config.json)

mkdir -p /mnt/app-data/database

DB=/mnt/app-data/database/database.db

# Staging's storage key only reaches its own bucket (basny-bap-staging-data).
# Restoring prod's DB and mirroring prod's images use a separate read-only key.
# Staging data refreshes from prod on a boot more than a week after the last
# restore, so it never drifts far; delete the DB and restart to refresh sooner.
# The refresh restores to a side file and swaps it in only on success, so a
# failed refresh keeps the old DB, and staging never boots on an empty one.
RESTORED_AT=/mnt/app-data/database/.restored-at
if [ "$STAGING" = "1" ]; then
  if [ -n "$PROD_R2_READ_ACCESS_KEY_ID" ] && [ -n "$PROD_R2_READ_SECRET_ACCESS_KEY" ]; then
    export LITESTREAM_ACCESS_KEY_ID="$PROD_R2_READ_ACCESS_KEY_ID"
    export LITESTREAM_SECRET_ACCESS_KEY="$PROD_R2_READ_SECRET_ACCESS_KEY"
    if [ ! -f "$DB" ] || [ ! -f "$RESTORED_AT" ] || [ -n "$(find "$RESTORED_AT" -mtime +6)" ]; then
      echo "STAGING: no database, or data over a week old; refreshing from prod's replica."
      rm -f "$DB.restoring" "$DB.restoring-wal" "$DB.restoring-shm"
      if litestream restore -config /etc/litestream.yml -o "$DB.restoring" "$DB"; then
        rm -f "$DB" "$DB-wal" "$DB-shm"
        mv "$DB.restoring" "$DB"
        touch "$RESTORED_AT"
        echo "Restore complete."
        # Bring staging's images in line with the DB just restored. Runs in the
        # background: the app serves meanwhile, with images filling in.
        node src/staging/mirror-images.js &
      elif [ -f "$DB" ]; then
        echo "STAGING: refresh from prod failed; keeping the existing database."
      else
        echo "STAGING: restore from prod failed and there is no database; refusing to start on an empty one." >&2
        exit 1
      fi
    fi
  elif [ -f "$DB" ]; then
    echo "STAGING: PROD_R2_READ_* not fully set; skipping refresh and image mirror."
  else
    echo "STAGING: no database and PROD_R2_READ_* not fully set; refusing to start on an empty one." >&2
    exit 1
  fi
fi

# Restore DB from Litestream replica if not present (e.g., fresh VPS, disaster
# recovery). Staging never gets here without a database.
if [ ! -f "$DB" ]; then
  echo "No database found, attempting restore from Litestream replica..."
  if litestream restore -config /etc/litestream.yml "$DB"; then
    echo "Restore complete."
  else
    echo "No replica found in R2 (first deploy or empty bucket), starting fresh."
  fi
fi

# Production: continuous WAL replication to R2.
# Staging (STAGING=1): restore-only on boot; never replicate, so staging
# can't pollute prod's R2 generations. Refresh staging by deleting the
# local DB and restarting the machine.
if [ "$STAGING" = "1" ]; then
  echo "STAGING mode: skipping Litestream replicate."
  exec node src/index.js
else
  exec litestream replicate -config /etc/litestream.yml -exec "node src/index.js"
fi
