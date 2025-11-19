#!/bin/bash
#
# Setup External Data Sync Cron Job
#
# This script sets up a cron job to automatically sync external species data
# from Wikipedia, GBIF, and FishBase during off-peak hours.
#
# Usage:
#   ./scripts/setup-external-data-cron.sh [--schedule "0 3 * * *"]
#
# Default schedule: 3 AM daily (0 3 * * *)
# Custom schedule: Pass --schedule "cron expression"
#
# Examples:
#   ./scripts/setup-external-data-cron.sh                          # 3 AM daily
#   ./scripts/setup-external-data-cron.sh --schedule "0 2 * * 0"  # 2 AM every Sunday
#   ./scripts/setup-external-data-cron.sh --schedule "0 4 * * 1"  # 4 AM every Monday

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default cron schedule (3 AM daily)
CRON_SCHEDULE="0 3 * * *"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --schedule)
      CRON_SCHEDULE="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--schedule \"cron expression\"]"
      echo ""
      echo "Examples:"
      echo "  $0                          # 3 AM daily (default)"
      echo "  $0 --schedule \"0 2 * * 0\"  # 2 AM every Sunday"
      echo "  $0 --schedule \"0 4 * * 1\"  # 4 AM every Monday"
      echo ""
      echo "Cron expression format: MIN HOUR DAY MONTH WEEKDAY"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown argument: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

echo -e "${GREEN}External Data Sync Cron Setup${NC}"
echo "================================"
echo ""

# Detect project directory
if [ -f "package.json" ] && grep -q "mulm" package.json; then
  PROJECT_DIR=$(pwd)
else
  echo -e "${RED}Error: Must be run from project root${NC}"
  echo "Current directory: $(pwd)"
  exit 1
fi

echo -e "Project directory: ${GREEN}$PROJECT_DIR${NC}"
echo -e "Cron schedule: ${GREEN}$CRON_SCHEDULE${NC}"
echo ""

# Create log directory
LOG_DIR="/var/log/mulm"
if [ ! -d "$LOG_DIR" ]; then
  echo "Creating log directory: $LOG_DIR"
  sudo mkdir -p "$LOG_DIR"
  sudo chown $(whoami):$(whoami) "$LOG_DIR"
fi

# Create log rotation config
LOGROTATE_CONF="/etc/logrotate.d/mulm-external-data-sync"
echo "Setting up log rotation..."

sudo tee "$LOGROTATE_CONF" > /dev/null <<EOF
$LOG_DIR/external-data-sync.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 $(whoami) $(whoami)
    dateext
    dateformat -%Y%m%d
}
EOF

echo -e "${GREEN}✓${NC} Log rotation configured: $LOGROTATE_CONF"

# Create the cron job
CRON_COMMAND="cd $PROJECT_DIR && npm run script scripts/sync-all-external-data.ts -- --execute >> $LOG_DIR/external-data-sync.log 2>&1"
CRON_JOB="$CRON_SCHEDULE $CRON_COMMAND"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "sync-all-external-data.ts"; then
  echo -e "${YELLOW}⚠${NC}  Cron job already exists. Updating..."

  # Remove old cron job
  crontab -l 2>/dev/null | grep -v "sync-all-external-data.ts" | crontab -
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -

echo -e "${GREEN}✓${NC} Cron job installed"
echo ""

# Display current crontab
echo "Current crontab:"
echo "----------------"
crontab -l | grep "sync-all-external-data.ts"
echo ""

# Test the script (dry-run)
echo -e "${YELLOW}Testing sync script (dry-run)...${NC}"
echo ""

cd "$PROJECT_DIR"
npm run script scripts/sync-all-external-data.ts -- --limit=1 2>&1 | head -50

echo ""
echo -e "${GREEN}✓${NC} Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Check logs: tail -f $LOG_DIR/external-data-sync.log"
echo "  2. Wait for scheduled run, or test manually:"
echo "     cd $PROJECT_DIR"
echo "     npm run script scripts/sync-all-external-data.ts -- --execute"
echo "  3. Monitor cron: grep CRON /var/log/syslog"
echo ""
echo "To remove the cron job:"
echo "  crontab -e"
echo "  (Delete the line containing 'sync-all-external-data.ts')"
echo ""
