#!/bin/bash
# Database backup script for BASNY BAP SQLite database
# Run this on the EC2 instance or via SSH from local machine

set -e

# Configuration
BACKUP_DIR="/mnt/basny-data/backups"
DB_PATH="/mnt/basny-data/database.db"
RETENTION_DAYS=30
S3_BUCKET="basny-backups"  # Optional: S3 bucket for offsite backups

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Generate timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="basny_backup_${TIMESTAMP}.db"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

# Create backup
echo "Creating backup: ${BACKUP_FILE}"
sqlite3 "$DB_PATH" ".backup '${BACKUP_PATH}'"

# Compress backup
echo "Compressing backup..."
gzip "${BACKUP_PATH}"
BACKUP_PATH="${BACKUP_PATH}.gz"
BACKUP_FILE="${BACKUP_FILE}.gz"

# Calculate file size
SIZE=$(du -h "${BACKUP_PATH}" | cut -f1)
echo "Backup created: ${BACKUP_FILE} (${SIZE})"

# Upload to S3 (optional - uncomment if using S3)
# if command -v aws &> /dev/null; then
#     echo "Uploading to S3..."
#     aws s3 cp "${BACKUP_PATH}" "s3://${S3_BUCKET}/database-backups/${BACKUP_FILE}"
#     echo "Backup uploaded to S3"
# fi

# Clean up old backups
echo "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "basny_backup_*.db.gz" -mtime +${RETENTION_DAYS} -exec rm {} \;

# List recent backups
echo ""
echo "Recent backups:"
ls -lh "${BACKUP_DIR}" | grep basny_backup | tail -5

echo ""
echo "✓ Backup complete!"