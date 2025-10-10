#!/bin/bash
#
# Database Backup Status Script for BASNY BAP Production
#
# Usage: ./backup-status.sh
#
# This script displays the current status of database backups
# including last backup times, disk usage, and health checks.
#

set -euo pipefail

# Configuration
DB_PATH="/mnt/basny-data/app/database/database.db"
BACKUP_BASE="/mnt/basny-data/backups"
LOG_FILE="${BACKUP_BASE}/backup.log"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}BASNY Database Backup Status${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Database information
echo -e "${CYAN}Database Information:${NC}"
if [ -f "${DB_PATH}" ]; then
    DB_SIZE=$(du -h "${DB_PATH}" | cut -f1)
    DB_MODIFIED=$(stat -c '%y' "${DB_PATH}" 2>/dev/null || stat -f '%Sm' "${DB_PATH}")
    echo -e "  Path:          ${DB_PATH}"
    echo -e "  Size:          ${DB_SIZE}"
    echo -e "  Last Modified: ${DB_MODIFIED}"

    # Check database integrity
    INTEGRITY=$(sqlite3 "${DB_PATH}" "PRAGMA integrity_check;" 2>&1)
    if [ "${INTEGRITY}" = "ok" ]; then
        echo -e "  Integrity:     ${GREEN}✓ OK${NC}"
    else
        echo -e "  Integrity:     ${RED}✗ FAILED${NC}"
        echo -e "                 ${INTEGRITY}"
    fi
else
    echo -e "  ${RED}✗ Database file not found${NC}"
fi
echo ""

# Backup directory status
echo -e "${CYAN}Backup Storage:${NC}"
if [ -d "${BACKUP_BASE}" ]; then
    TOTAL_SIZE=$(du -sh "${BACKUP_BASE}" 2>/dev/null | cut -f1 || echo "N/A")
    TOTAL_BACKUPS=$(find "${BACKUP_BASE}" -name "database_*.db" -type f 2>/dev/null | wc -l)
    echo -e "  Location:      ${BACKUP_BASE}"
    echo -e "  Total Size:    ${TOTAL_SIZE}"
    echo -e "  Total Backups: ${TOTAL_BACKUPS}"
else
    echo -e "  ${RED}✗ Backup directory not found${NC}"
fi
echo ""

# Backup status by type
echo -e "${CYAN}Backup Status by Type:${NC}"

for backup_type in hourly daily weekly monthly; do
    backup_dir="${BACKUP_BASE}/${backup_type}"

    if [ -d "${backup_dir}" ]; then
        count=$(find "${backup_dir}" -name "database_*.db" -type f 2>/dev/null | wc -l)
        size=$(du -sh "${backup_dir}" 2>/dev/null | cut -f1 || echo "0")

        # Find most recent backup
        latest=$(find "${backup_dir}" -name "database_*.db" -type f -printf '%T+ %p\n' 2>/dev/null | sort -r | head -n1)

        if [ -n "${latest}" ]; then
            latest_file=$(echo "${latest}" | cut -d' ' -f2-)
            latest_time=$(stat -c '%y' "${latest_file}" 2>/dev/null || stat -f '%Sm' "${latest_file}")
            latest_size=$(du -h "${latest_file}" | cut -f1)

            # Calculate age
            latest_epoch=$(stat -c '%Y' "${latest_file}" 2>/dev/null || stat -f '%m' "${latest_file}")
            current_epoch=$(date +%s)
            age_seconds=$((current_epoch - latest_epoch))
            age_hours=$((age_seconds / 3600))

            # Determine status color based on age
            if [ "${backup_type}" = "hourly" ] && [ "${age_hours}" -gt 7 ]; then
                status_color="${RED}"
                status="⚠ STALE"
            elif [ "${backup_type}" = "daily" ] && [ "${age_hours}" -gt 25 ]; then
                status_color="${RED}"
                status="⚠ STALE"
            elif [ "${backup_type}" = "weekly" ] && [ "${age_hours}" -gt 168 ]; then
                status_color="${RED}"
                status="⚠ STALE"
            elif [ "${backup_type}" = "monthly" ] && [ "${age_hours}" -gt 720 ]; then
                status_color="${RED}"
                status="⚠ STALE"
            else
                status_color="${GREEN}"
                status="✓ OK"
            fi

            echo -e "  ${backup_type^}:"
            echo -e "    Status:      ${status_color}${status}${NC}"
            echo -e "    Count:       ${count} backups"
            echo -e "    Size:        ${size}"
            echo -e "    Last Backup: ${latest_time} (${age_hours}h ago, ${latest_size})"
        else
            echo -e "  ${backup_type^}:"
            echo -e "    Status:      ${YELLOW}⚠ NO BACKUPS${NC}"
            echo -e "    Count:       0 backups"
        fi
    else
        echo -e "  ${backup_type^}:"
        echo -e "    Status:      ${YELLOW}⚠ DIRECTORY NOT FOUND${NC}"
    fi
    echo ""
done

# Recent backup log entries
echo -e "${CYAN}Recent Backup Activity (Last 10 Entries):${NC}"
if [ -f "${LOG_FILE}" ]; then
    tail -n 10 "${LOG_FILE}" | while IFS= read -r line; do
        if echo "${line}" | grep -q "ERROR"; then
            echo -e "  ${RED}${line}${NC}"
        elif echo "${line}" | grep -q "SUCCESS"; then
            echo -e "  ${GREEN}${line}${NC}"
        elif echo "${line}" | grep -q "WARNING"; then
            echo -e "  ${YELLOW}${line}${NC}"
        else
            echo -e "  ${line}"
        fi
    done
else
    echo -e "  ${YELLOW}No log file found${NC}"
fi
echo ""

# Health summary
echo -e "${CYAN}Health Summary:${NC}"

issues=0

# Check for missing backups
for backup_type in hourly daily weekly monthly; do
    backup_dir="${BACKUP_BASE}/${backup_type}"
    if [ ! -d "${backup_dir}" ] || [ ! "$(ls -A "${backup_dir}" 2>/dev/null)" ]; then
        echo -e "  ${YELLOW}⚠ No ${backup_type} backups found${NC}"
        ((issues++))
    fi
done

# Check for recent errors in log
if [ -f "${LOG_FILE}" ]; then
    error_count=$(tail -n 50 "${LOG_FILE}" | grep -c "ERROR" || true)
    if [ "${error_count}" -gt 0 ]; then
        echo -e "  ${RED}⚠ ${error_count} error(s) in recent backup log${NC}"
        ((issues++))
    fi
fi

# Check disk space
if [ -d "${BACKUP_BASE}" ]; then
    disk_usage=$(df -h "${BACKUP_BASE}" | tail -n 1 | awk '{print $5}' | sed 's/%//')
    if [ "${disk_usage}" -gt 90 ]; then
        echo -e "  ${RED}⚠ Disk usage is high (${disk_usage}%)${NC}"
        ((issues++))
    elif [ "${disk_usage}" -gt 80 ]; then
        echo -e "  ${YELLOW}⚠ Disk usage is elevated (${disk_usage}%)${NC}"
    fi
fi

if [ "${issues}" -eq 0 ]; then
    echo -e "  ${GREEN}✓ All checks passed${NC}"
fi

echo ""
echo -e "${BLUE}======================================${NC}"
echo ""

exit 0
