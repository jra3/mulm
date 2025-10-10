#!/bin/bash
#
# Database Restore Script for BASNY BAP Production
#
# Usage: ./restore-database.sh [backup_file]
#
# This script safely restores a database backup with pre-restore backup
# and integrity verification.
#

set -euo pipefail

# Configuration
DB_PATH="/mnt/basny-data/app/database/database.db"
BACKUP_BASE="/mnt/basny-data/backups"
LOG_FILE="${BACKUP_BASE}/restore.log"
DOCKER_COMPOSE_FILE="/opt/basny/docker-compose.prod.yml"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
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

log_info() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] INFO: $1${NC}" | tee -a "${LOG_FILE}"
}

# Function to list available backups
list_backups() {
    echo ""
    echo -e "${BLUE}Available backups:${NC}"
    echo ""

    for backup_type in hourly daily weekly monthly; do
        backup_dir="${BACKUP_BASE}/${backup_type}"
        if [ -d "${backup_dir}" ] && [ "$(ls -A "${backup_dir}" 2>/dev/null)" ]; then
            echo -e "${GREEN}${backup_type}:${NC}"
            find "${backup_dir}" -name "database_*.db" -type f -printf '%T+ %p\n' | \
                sort -r | \
                while read -r timestamp filepath; do
                    filename=$(basename "${filepath}")
                    size=$(du -h "${filepath}" | cut -f1)
                    date_part=$(echo "${filename}" | sed 's/database_\(.*\)\.db/\1/')
                    formatted_date=$(date -d "${date_part:0:8} ${date_part:9:2}:${date_part:11:2}:${date_part:13:2}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "${date_part}")
                    echo "  ${filepath} (${size}, ${formatted_date})"
                done
            echo ""
        fi
    done
}

# Function to verify backup integrity
verify_backup() {
    local backup_file="$1"

    log_info "Verifying backup integrity: ${backup_file}"

    if [ ! -f "${backup_file}" ]; then
        log_error "Backup file does not exist: ${backup_file}"
        return 1
    fi

    local integrity_check
    integrity_check=$(sqlite3 "${backup_file}" "PRAGMA integrity_check;" 2>&1)

    if [ "${integrity_check}" != "ok" ]; then
        log_error "Backup integrity check failed: ${integrity_check}"
        return 1
    fi

    log_success "Backup integrity verified"
    return 0
}

# Function to stop application
stop_app() {
    log_info "Stopping application..."

    if [ -f "${DOCKER_COMPOSE_FILE}" ]; then
        cd /opt/basny
        if sudo docker-compose -f "${DOCKER_COMPOSE_FILE}" stop app 2>&1 | tee -a "${LOG_FILE}"; then
            log_success "Application stopped"
            return 0
        else
            log_error "Failed to stop application"
            return 1
        fi
    else
        log_warning "Docker Compose file not found, skipping app stop"
        return 0
    fi
}

# Function to start application
start_app() {
    log_info "Starting application..."

    if [ -f "${DOCKER_COMPOSE_FILE}" ]; then
        cd /opt/basny
        if sudo docker-compose -f "${DOCKER_COMPOSE_FILE}" start app 2>&1 | tee -a "${LOG_FILE}"; then
            log_success "Application started"
            return 0
        else
            log_error "Failed to start application"
            return 1
        fi
    else
        log_warning "Docker Compose file not found, skipping app start"
        return 0
    fi
}

# Main script

echo ""
echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}BASNY Database Restore Utility${NC}"
echo -e "${BLUE}======================================${NC}"

# If no backup file specified, show available backups and prompt
if [ $# -eq 0 ]; then
    list_backups
    echo -e "${YELLOW}Enter the full path to the backup file you want to restore:${NC}"
    read -r BACKUP_FILE
else
    BACKUP_FILE="$1"
fi

# Validate backup file exists
if [ ! -f "${BACKUP_FILE}" ]; then
    log_error "Backup file does not exist: ${BACKUP_FILE}"
    exit 1
fi

# Verify backup integrity before proceeding
if ! verify_backup "${BACKUP_FILE}"; then
    log_error "Cannot restore from corrupt backup"
    exit 1
fi

# Show backup information
BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
log_info "Backup file: ${BACKUP_FILE}"
log_info "Backup size: ${BACKUP_SIZE}"

# Confirm with user
echo ""
echo -e "${RED}WARNING: This will replace the current database!${NC}"
echo -e "${YELLOW}A pre-restore backup will be created automatically.${NC}"
echo ""
echo -e "Current database: ${DB_PATH}"
echo -e "Restore from:     ${BACKUP_FILE}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r CONFIRM

if [ "${CONFIRM}" != "yes" ]; then
    log_info "Restore cancelled by user"
    exit 0
fi

# Create pre-restore backup
PRE_RESTORE_DIR="${BACKUP_BASE}/pre-restore"
mkdir -p "${PRE_RESTORE_DIR}"
PRE_RESTORE_FILE="${PRE_RESTORE_DIR}/database_before_restore_$(date +%Y%m%d_%H%M%S).db"

log_info "Creating pre-restore backup..."
if sqlite3 "${DB_PATH}" ".backup '${PRE_RESTORE_FILE}'"; then
    PRE_RESTORE_SIZE=$(du -h "${PRE_RESTORE_FILE}" | cut -f1)
    log_success "Pre-restore backup created: ${PRE_RESTORE_FILE} (${PRE_RESTORE_SIZE})"
else
    log_error "Failed to create pre-restore backup"
    exit 1
fi

# Stop application
if ! stop_app; then
    log_error "Cannot proceed with restore while application is running"
    exit 1
fi

# Perform restore
log_info "Restoring database from backup..."
if cp "${BACKUP_FILE}" "${DB_PATH}"; then
    log_success "Database file copied"
else
    log_error "Failed to restore database"
    # Attempt to restore from pre-restore backup
    log_warning "Attempting to restore from pre-restore backup..."
    cp "${PRE_RESTORE_FILE}" "${DB_PATH}"
    start_app
    exit 1
fi

# Set proper permissions
chmod 644 "${DB_PATH}"
chown 1001:65533 "${DB_PATH}" 2>/dev/null || log_warning "Could not set ownership (may need sudo)"

# Verify restored database
log_info "Verifying restored database..."
if ! verify_backup "${DB_PATH}"; then
    log_error "Restored database failed integrity check"
    log_warning "Restoring from pre-restore backup..."
    cp "${PRE_RESTORE_FILE}" "${DB_PATH}"
    chmod 644 "${DB_PATH}"
    chown 1001:65533 "${DB_PATH}" 2>/dev/null || true
    start_app
    exit 1
fi

# Start application
if ! start_app; then
    log_error "Application failed to start after restore"
    exit 1
fi

# Final success message
echo ""
log_success "Database restore completed successfully!"
log_info "Pre-restore backup saved to: ${PRE_RESTORE_FILE}"
echo ""
echo -e "${GREEN}✓ Restore complete!${NC}"
echo ""

exit 0
