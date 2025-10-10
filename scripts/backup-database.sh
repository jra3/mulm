#!/bin/bash
#
# Database Backup Script for BASNY BAP Production
#
# Usage: ./backup-database.sh [hourly|daily|weekly|monthly]
#
# This script creates SQLite backups with integrity verification
# and automatic rotation based on retention policies.
#

set -euo pipefail

# Configuration
DB_PATH="/mnt/basny-data/app/database/database.db"
BACKUP_BASE="/mnt/basny-data/backups"
LOG_FILE="${BACKUP_BASE}/backup.log"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Email configuration (reads from production config if available)
CONFIG_FILE="/mnt/basny-data/app/config/config.production.json"
ALERT_EMAIL="baptest@porcnick.com"  # Default fallback

# Backup type (hourly, daily, weekly, monthly)
BACKUP_TYPE="${1:-hourly}"

# Retention policies
declare -A RETENTION=(
    ["hourly"]=4
    ["daily"]=7
    ["weekly"]=4
    ["monthly"]=12
)

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a "${LOG_FILE}"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: $1${NC}" | tee -a "${LOG_FILE}"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}" | tee -a "${LOG_FILE}"
}

# Send email notification
send_alert() {
    local subject="$1"
    local message="$2"

    # Try to send email using Node.js if available (uses app's SMTP config)
    if command -v node &> /dev/null && [ -f "${CONFIG_FILE}" ]; then
        # Create temporary Node script to send email
        local temp_script="/tmp/send_backup_alert_$$.js"
        cat > "${temp_script}" << 'EOJS'
const fs = require('fs');
const nodemailer = require('nodemailer');

const config = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8'));
const transport = nodemailer.createTransport(config.smtp);

transport.sendMail({
    from: config.smtp.auth.user,
    to: process.env.ALERT_EMAIL,
    subject: process.env.SUBJECT,
    text: process.env.MESSAGE
}).then(() => {
    console.log('Alert sent');
    process.exit(0);
}).catch(err => {
    console.error('Failed to send alert:', err.message);
    process.exit(1);
});
EOJS

        SUBJECT="$subject" MESSAGE="$message" CONFIG_FILE="${CONFIG_FILE}" ALERT_EMAIL="${ALERT_EMAIL}" \
            node "${temp_script}" 2>/dev/null || log_warning "Failed to send email alert"
        rm -f "${temp_script}"
    else
        log_warning "Cannot send email alert (Node.js or config not available)"
    fi
}

# Validate backup type
if [[ ! "${BACKUP_TYPE}" =~ ^(hourly|daily|weekly|monthly)$ ]]; then
    log_error "Invalid backup type: ${BACKUP_TYPE}"
    echo "Usage: $0 [hourly|daily|weekly|monthly]"
    exit 1
fi

# Create backup directory if it doesn't exist
BACKUP_DIR="${BACKUP_BASE}/${BACKUP_TYPE}"
mkdir -p "${BACKUP_DIR}"

# Check if source database exists and is readable
if [ ! -f "${DB_PATH}" ]; then
    log_error "Database file not found: ${DB_PATH}"
    send_alert "BASNY Backup Failed" "Database file not found: ${DB_PATH}"
    exit 1
fi

if [ ! -r "${DB_PATH}" ]; then
    log_error "Database file not readable: ${DB_PATH}"
    send_alert "BASNY Backup Failed" "Database file not readable: ${DB_PATH}"
    exit 1
fi

# Backup filename
BACKUP_FILE="${BACKUP_DIR}/database_${TIMESTAMP}.db"

log "Starting ${BACKUP_TYPE} backup to ${BACKUP_FILE}"

# Create backup using SQLite .backup command (ensures consistency)
if ! sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'" 2>&1 | tee -a "${LOG_FILE}"; then
    log_error "Backup creation failed"
    send_alert "BASNY Backup Failed" "Failed to create ${BACKUP_TYPE} backup at ${TIMESTAMP}"
    exit 1
fi

# Verify backup file was created
if [ ! -f "${BACKUP_FILE}" ]; then
    log_error "Backup file was not created: ${BACKUP_FILE}"
    send_alert "BASNY Backup Failed" "Backup file not created: ${BACKUP_FILE}"
    exit 1
fi

# Get file sizes for logging
SOURCE_SIZE=$(du -h "${DB_PATH}" | cut -f1)
BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
log "Backup created: ${BACKUP_SIZE} (source: ${SOURCE_SIZE})"

# Verify backup integrity
log "Verifying backup integrity..."
INTEGRITY_CHECK=$(sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;" 2>&1)

if [ "${INTEGRITY_CHECK}" != "ok" ]; then
    log_error "Backup integrity check failed: ${INTEGRITY_CHECK}"
    rm -f "${BACKUP_FILE}"
    send_alert "BASNY Backup Failed" "Integrity check failed for ${BACKUP_TYPE} backup at ${TIMESTAMP}: ${INTEGRITY_CHECK}"
    exit 1
fi

log_success "Backup integrity verified"

# Set proper permissions (readable by all, writable by owner)
chmod 644 "${BACKUP_FILE}"

# Rotate old backups based on retention policy
RETENTION_COUNT=${RETENTION[${BACKUP_TYPE}]}
log "Rotating backups (keeping last ${RETENTION_COUNT})"

# Count current backups
CURRENT_COUNT=$(find "${BACKUP_DIR}" -name "database_*.db" | wc -l)
log "Current backup count: ${CURRENT_COUNT}"

# Remove old backups if we exceed retention
if [ "${CURRENT_COUNT}" -gt "${RETENTION_COUNT}" ]; then
    REMOVE_COUNT=$((CURRENT_COUNT - RETENTION_COUNT))
    log "Removing ${REMOVE_COUNT} old backup(s)"

    # Find oldest backups and remove them
    find "${BACKUP_DIR}" -name "database_*.db" -type f -printf '%T+ %p\n' | \
        sort | \
        head -n "${REMOVE_COUNT}" | \
        cut -d' ' -f2- | \
        while read -r old_backup; do
            log "Removing old backup: $(basename "${old_backup}")"
            rm -f "${old_backup}"
        done
fi

# Calculate total backup space usage
TOTAL_SIZE=$(du -sh "${BACKUP_BASE}" | cut -f1)
log_success "${BACKUP_TYPE} backup completed successfully"
log "Total backup directory size: ${TOTAL_SIZE}"

# Exit successfully
exit 0
