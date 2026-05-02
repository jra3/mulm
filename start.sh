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

# Restore DB from Litestream replica if not present (e.g., fresh VPS, disaster recovery)
if [ ! -f /mnt/app-data/database/database.db ]; then
  echo "No database found, attempting restore from Litestream replica..."
  if litestream restore -config /etc/litestream.yml /mnt/app-data/database/database.db; then
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
