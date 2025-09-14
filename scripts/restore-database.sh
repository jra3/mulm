#!/bin/bash
# Database restore script for BASNY BAP SQLite database
# Run this on the EC2 instance to restore from backup

set -e

# Configuration
BACKUP_DIR="/mnt/basny-data/backups"
DB_PATH="/mnt/basny-data/database.db"
DB_BACKUP_CURRENT="/mnt/basny-data/database.db.current"

# Check if backup file is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <backup-file>"
    echo ""
    echo "Available backups:"
    ls -lh "${BACKUP_DIR}" | grep basny_backup
    exit 1
fi

BACKUP_FILE=$1

# Check if backup file exists
if [ ! -f "${BACKUP_DIR}/${BACKUP_FILE}" ]; then
    echo "Error: Backup file not found: ${BACKUP_DIR}/${BACKUP_FILE}"
    exit 1
fi

echo "WARNING: This will replace the current database with the backup."
read -p "Are you sure you want to continue? (yes/no): " confirmation

if [ "$confirmation" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

# Stop the application
echo "Stopping application..."
cd /opt/basny
docker-compose -f docker-compose.prod.yml stop app

# Backup current database
echo "Backing up current database..."
cp "${DB_PATH}" "${DB_BACKUP_CURRENT}"

# Extract and restore backup
echo "Restoring from backup: ${BACKUP_FILE}"
TEMP_FILE="/tmp/restore_$(date +%s).db"

if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "${BACKUP_DIR}/${BACKUP_FILE}" > "$TEMP_FILE"
else
    cp "${BACKUP_DIR}/${BACKUP_FILE}" "$TEMP_FILE"
fi

# Replace database
mv "$TEMP_FILE" "$DB_PATH"
chown ec2-user:ec2-user "$DB_PATH"
chmod 644 "$DB_PATH"

# Start the application
echo "Starting application..."
docker-compose -f docker-compose.prod.yml start app

# Wait for health check
echo "Waiting for application to be ready..."
sleep 5

if curl -f http://localhost:4200/health > /dev/null 2>&1; then
    echo "✓ Application is healthy"
    echo "✓ Database restored successfully from ${BACKUP_FILE}"
else
    echo "⚠ Health check failed - rolling back..."
    docker-compose -f docker-compose.prod.yml stop app
    mv "${DB_BACKUP_CURRENT}" "${DB_PATH}"
    docker-compose -f docker-compose.prod.yml start app
    echo "Database rolled back to previous version"
    exit 1
fi

# Clean up
rm -f "${DB_BACKUP_CURRENT}"
echo "✓ Restore complete!"