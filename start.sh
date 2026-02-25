#!/bin/sh
# Production startup script

# Extract R2 credentials from config.json for Litestream
export LITESTREAM_ACCESS_KEY_ID=$(jq -r '.storage.s3AccessKeyId' /app/src/config.json)
export LITESTREAM_SECRET_ACCESS_KEY=$(jq -r '.storage.s3Secret' /app/src/config.json)

# Restore DB from Litestream replica if not present (e.g., fresh VPS, disaster recovery)
if [ ! -f /mnt/app-data/database/database.db ]; then
  echo "No database found, attempting restore from Litestream replica..."
  if litestream restore -config /etc/litestream.yml /mnt/app-data/database/database.db; then
    echo "Restore complete."
  else
    echo "No replica found in R2 (first deploy or empty bucket), starting fresh."
  fi
fi

# Start app with continuous WAL replication to R2
exec litestream run -config /etc/litestream.yml -- node src/index.js
