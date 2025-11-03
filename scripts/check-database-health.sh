#!/bin/bash
#
# Database Health Check Script for BASNY BAP Production
#
# Usage: ./check-database-health.sh
#
# This script performs SQLite integrity checks and alerts if corruption is detected.
# It can be run:
#   - Via cron for scheduled monitoring
#   - Before/after backups for verification
#   - Manually for troubleshooting
#
# Exit codes:
#   0 - Database is healthy
#   1 - Database corruption detected
#   2 - Script error (missing database, permissions, etc.)
#

set -euo pipefail

# Configuration
DB_PATH="/mnt/basny-data/app/database/database.db"
BACKUP_BASE="/mnt/basny-data/backups"
LOG_FILE="${BACKUP_BASE}/backup.log"
HEALTH_LOG_FILE="${BACKUP_BASE}/health-check.log"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Email configuration
CONFIG_FILE="/mnt/basny-data/app/config/config.production.json"
ALERT_EMAIL="baptest@porcnick.com"  # Default fallback
FROM_EMAIL="bap@basny.org"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${HEALTH_LOG_FILE}"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a "${HEALTH_LOG_FILE}"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: $1${NC}" | tee -a "${HEALTH_LOG_FILE}"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}" | tee -a "${HEALTH_LOG_FILE}"
}

# Send email alert
send_alert() {
    local subject="$1"
    local body="$2"

    # Try to read email config from production config
    if [ -f "${CONFIG_FILE}" ]; then
        SMTP_HOST=$(jq -r '.smtpHost // "mail.basny.org"' "${CONFIG_FILE}" 2>/dev/null || echo "mail.basny.org")
        SMTP_PORT=$(jq -r '.smtpPort // 465' "${CONFIG_FILE}" 2>/dev/null || echo "465")
        SMTP_USER=$(jq -r '.fromEmail // "bap@basny.org"' "${CONFIG_FILE}" 2>/dev/null || echo "bap@basny.org")
        SMTP_PASS=$(jq -r '.smtpPassword // ""' "${CONFIG_FILE}" 2>/dev/null || echo "")
        ALERT_EMAIL=$(jq -r '.adminsEmail // "baptest@porcnick.com"' "${CONFIG_FILE}" 2>/dev/null || echo "baptest@porcnick.com")
    fi

    # Create email message
    local email_message=$(cat <<EOF
Subject: ${subject}
From: ${FROM_EMAIL}
To: ${ALERT_EMAIL}
Content-Type: text/plain; charset=UTF-8

${body}

--
BASNY BAP Database Health Monitor
Timestamp: $(date '+%Y-%m-%d %H:%M:%S %Z')
Server: $(hostname)
Database: ${DB_PATH}
EOF
)

    # Send via sendmail if available, otherwise log
    if command -v sendmail &> /dev/null; then
        echo "${email_message}" | sendmail -t
        log "Alert email sent to ${ALERT_EMAIL}"
    else
        log_warning "sendmail not available, alert not sent: ${subject}"
        log "Alert body: ${body}"
    fi
}

# Check if database exists
if [ ! -f "${DB_PATH}" ]; then
    log_error "Database file not found: ${DB_PATH}"
    exit 2
fi

# Check if database is readable
if [ ! -r "${DB_PATH}" ]; then
    log_error "Database file is not readable: ${DB_PATH}"
    exit 2
fi

log "Starting database health check..."

# Create temporary file for integrity check output
INTEGRITY_OUTPUT=$(mktemp)
trap "rm -f ${INTEGRITY_OUTPUT}" EXIT

# Run PRAGMA integrity_check
log "Running PRAGMA integrity_check..."
if sqlite3 "${DB_PATH}" "PRAGMA integrity_check;" > "${INTEGRITY_OUTPUT}" 2>&1; then
    INTEGRITY_RESULT=$(cat "${INTEGRITY_OUTPUT}")

    if [ "${INTEGRITY_RESULT}" = "ok" ]; then
        log_success "Database integrity check PASSED"

        # Get additional statistics
        TABLE_COUNT=$(sqlite3 "${DB_PATH}" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "unknown")
        DB_SIZE=$(du -h "${DB_PATH}" | cut -f1)
        PAGE_COUNT=$(sqlite3 "${DB_PATH}" "PRAGMA page_count;" 2>/dev/null || echo "unknown")
        PAGE_SIZE=$(sqlite3 "${DB_PATH}" "PRAGMA page_size;" 2>/dev/null || echo "unknown")

        log "Database statistics:"
        log "  - Size: ${DB_SIZE}"
        log "  - Tables: ${TABLE_COUNT}"
        log "  - Pages: ${PAGE_COUNT}"
        log "  - Page size: ${PAGE_SIZE} bytes"

        exit 0
    else
        # Corruption detected!
        log_error "DATABASE CORRUPTION DETECTED!"
        log_error "Integrity check output:"
        cat "${INTEGRITY_OUTPUT}" | tee -a "${HEALTH_LOG_FILE}"

        # Count errors
        ERROR_COUNT=$(grep -c "^" "${INTEGRITY_OUTPUT}" || echo "0")
        log_error "Total integrity errors: ${ERROR_COUNT}"

        # Create detailed alert email
        ALERT_SUBJECT="🚨 CRITICAL: Database Corruption Detected - BASNY BAP Production"
        ALERT_BODY=$(cat <<EOF
CRITICAL DATABASE CORRUPTION DETECTED

A database integrity check has detected corruption in the production database.
Immediate action is required to prevent data loss.

Database: ${DB_PATH}
Check Time: $(date '+%Y-%m-%d %H:%M:%S %Z')
Error Count: ${ERROR_COUNT}

Integrity Check Output:
$(head -50 "${INTEGRITY_OUTPUT}")

RECOMMENDED ACTIONS:

1. STOP THE APPLICATION IMMEDIATELY:
   ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml stop app"

2. CREATE EMERGENCY BACKUP:
   ssh BAP "sqlite3 ${DB_PATH} '.backup /tmp/emergency-backup-$(date +%Y%m%d_%H%M%S).db'"

3. RUN RECOVERY:
   ssh BAP "sqlite3 ${DB_PATH} '.recover' | sqlite3 /tmp/recovered.db"

4. VERIFY RECOVERY:
   ssh BAP "sqlite3 /tmp/recovered.db 'PRAGMA integrity_check'"

5. REVIEW HEALTH CHECK LOG:
   ssh BAP "tail -100 ${HEALTH_LOG_FILE}"

For detailed recovery procedures, see:
/opt/basny/infrastructure/README.md

This is an automated alert from the database health monitoring system.
EOF
)

        send_alert "${ALERT_SUBJECT}" "${ALERT_BODY}"

        exit 1
    fi
else
    # sqlite3 command failed
    log_error "Failed to run integrity check"
    cat "${INTEGRITY_OUTPUT}" | tee -a "${HEALTH_LOG_FILE}"

    ALERT_SUBJECT="⚠️ WARNING: Database Health Check Failed - BASNY BAP Production"
    ALERT_BODY=$(cat <<EOF
The database health check failed to complete.

Database: ${DB_PATH}
Check Time: $(date '+%Y-%m-%d %H:%M:%S %Z')

Error Output:
$(cat "${INTEGRITY_OUTPUT}")

This may indicate:
- Database is locked by another process
- Database file permissions issue
- Disk I/O error
- Severe database corruption

Please investigate immediately.

Review health check log:
ssh BAP "tail -100 ${HEALTH_LOG_FILE}"
EOF
)

    send_alert "${ALERT_SUBJECT}" "${ALERT_BODY}"

    exit 2
fi
