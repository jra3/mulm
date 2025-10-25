#!/bin/bash
# Sync database from production to local development environment
# This script downloads the production database and replaces the local copy

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SSH_HOST="BAP"
PROD_DB_PATH="/mnt/basny-data/app/database/database.db"
LOCAL_DB_PATH="db/database.db"
BACKUP_DIR="backups"

echo -e "${GREEN}=== Database Sync from Production ===${NC}"
echo ""

# Step 1: Create backup on production server
echo -e "${YELLOW}Step 1: Creating backup on production server...${NC}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PROD_BACKUP="/tmp/basny_backup_${TIMESTAMP}.db"

ssh ${SSH_HOST} "cd /mnt/basny-data/app/database && sqlite3 database.db \".backup ${PROD_BACKUP}\""
BACKUP_SIZE=$(ssh ${SSH_HOST} "ls -lh ${PROD_BACKUP}" | awk '{print $5}')
echo -e "${GREEN}✓ Created: ${PROD_BACKUP} (${BACKUP_SIZE})${NC}"
echo ""

# Step 2: Download backup to local machine
echo -e "${YELLOW}Step 2: Downloading backup to local machine...${NC}"
LOCAL_TEMP="/tmp/basny_production_sync_${TIMESTAMP}.db"
scp ${SSH_HOST}:${PROD_BACKUP} ${LOCAL_TEMP}
LOCAL_SIZE=$(ls -lh ${LOCAL_TEMP} | awk '{print $5}')
echo -e "${GREEN}✓ Downloaded: ${LOCAL_TEMP} (${LOCAL_SIZE})${NC}"
echo ""

# Step 3: Backup current local database
echo -e "${YELLOW}Step 3: Backing up current local database...${NC}"
mkdir -p ${BACKUP_DIR}
LOCAL_BACKUP="${BACKUP_DIR}/database.db.backup_${TIMESTAMP}"
cp ${LOCAL_DB_PATH} ${LOCAL_BACKUP}
LOCAL_BACKUP_SIZE=$(ls -lh ${LOCAL_BACKUP} | awk '{print $5}')
echo -e "${GREEN}✓ Backed up: ${LOCAL_BACKUP} (${LOCAL_BACKUP_SIZE})${NC}"
echo ""

# Step 4: Replace local database
echo -e "${YELLOW}Step 4: Replacing local database...${NC}"
cp ${LOCAL_TEMP} ${LOCAL_DB_PATH}
NEW_DB_SIZE=$(ls -lh ${LOCAL_DB_PATH} | awk '{print $5}')
echo -e "${GREEN}✓ Replaced: ${LOCAL_DB_PATH} (${NEW_DB_SIZE})${NC}"
echo ""

# Step 5: Verify sync
echo -e "${YELLOW}Step 5: Verifying sync...${NC}"
echo "Local counts:"
sqlite3 ${LOCAL_DB_PATH} "SELECT 'Members: ' || COUNT(*) FROM members UNION ALL SELECT 'Submissions: ' || COUNT(*) FROM submissions UNION ALL SELECT 'Species Groups: ' || COUNT(*) FROM species_name_group;"
echo ""
echo "Production counts:"
ssh ${SSH_HOST} "sqlite3 ${PROD_DB_PATH} \"SELECT 'Members: ' || COUNT(*) FROM members UNION ALL SELECT 'Submissions: ' || COUNT(*) FROM submissions UNION ALL SELECT 'Species Groups: ' || COUNT(*) FROM species_name_group;\""
echo ""

# Step 6: Cleanup instructions
echo -e "${GREEN}=== Sync Complete ===${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Restart your dev server: npm run dev"
echo "2. Migrations will run automatically on startup"
echo "3. Verify the app works at http://localhost:4200"
echo ""
echo -e "${YELLOW}Backups created:${NC}"
echo "  Production: ${PROD_BACKUP}"
echo "  Local: ${LOCAL_BACKUP}"
