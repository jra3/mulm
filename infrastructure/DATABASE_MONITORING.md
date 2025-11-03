# Database Integrity Monitoring

This document describes the automated database integrity monitoring system for detecting corruption early.

## Overview

The system provides three layers of protection:
1. **Daily health checks** - Automated integrity checks every morning
2. **Pre-backup verification** - Integrity checks before every backup
3. **Post-backup verification** - Integrity checks after creating backups

## Components

### 1. Health Check Script

**Location**: `/opt/basny/scripts/check-database-health.sh`

**What it does:**
- Runs `PRAGMA integrity_check` on the production database
- Logs results to `/mnt/basny-data/backups/health-check.log`
- Sends email alerts if corruption is detected
- Provides database statistics (size, tables, pages)

**Schedule**: Daily at 6:00 AM EST (via cron)

**Manual usage:**
```bash
ssh BAP "/opt/basny/scripts/check-database-health.sh"
```

**Exit codes:**
- `0` - Database is healthy
- `1` - Corruption detected
- `2` - Script error (missing file, permissions, etc.)

### 2. Backup Script Integration

**Location**: `/opt/basny/scripts/backup-database.sh`

**Enhanced with:**
- **Pre-backup check**: Verifies source database integrity BEFORE creating backup
- **Aborts if corrupted**: Prevents backing up corrupted data
- **Post-backup check**: Verifies backup file integrity (existing feature)
- **Email alerts**: Notifies if corruption detected during backup

**Schedule**:
- Hourly: Every 6 hours (0, 6, 12, 18)
- Daily: 2:00 AM EST
- Weekly: Sunday 3:00 AM EST
- Monthly: 1st of month 4:00 AM EST

### 3. Cron Schedule

```cron
# Backup jobs with integrity checks
0 */6 * * * /opt/basny/scripts/backup-database.sh hourly
0 2 * * * /opt/basny/scripts/backup-database.sh daily
0 3 * * 0 /opt/basny/scripts/backup-database.sh weekly
0 4 1 * * /opt/basny/scripts/backup-database.sh monthly

# Standalone health check
0 6 * * * /opt/basny/scripts/check-database-health.sh
```

## Alert System

### Email Configuration

Alerts are sent to the admin email configured in `/mnt/basny-data/app/config/config.production.json`:

```json
{
  "adminsEmail": "baptest@porcnick.com",
  "fromEmail": "bap@basny.org"
}
```

### Alert Types

**1. Daily Health Check (6 AM)**
- Subject: "🚨 CRITICAL: Database Corruption Detected - BASNY BAP Production"
- Triggers: When daily health check finds corruption
- Action: Immediate investigation required

**2. Backup Corruption Alert**
- Subject: "🚨 CRITICAL: Database Corruption Detected During Backup"
- Triggers: When pre-backup integrity check fails
- Action: Backup aborted, immediate recovery needed

**3. Health Check Failure**
- Subject: "⚠️ WARNING: Database Health Check Failed - BASNY BAP Production"
- Triggers: When health check script cannot complete
- Action: Investigate lock issues, permissions, or disk errors

## Logs

### Health Check Log
**Location**: `/mnt/basny-data/backups/health-check.log`

**View recent checks:**
```bash
ssh BAP "tail -50 /mnt/basny-data/backups/health-check.log"
```

**Example output (healthy):**
```
[2025-11-03 20:02:17] Starting database health check...
[2025-11-03 20:02:17] Running PRAGMA integrity_check...
[2025-11-03 20:02:17] SUCCESS: Database integrity check PASSED
[2025-11-03 20:02:17] Database statistics:
[2025-11-03 20:02:17]   - Size: 3.9M
[2025-11-03 20:02:17]   - Tables: 21
[2025-11-03 20:02:17]   - Pages: 982
[2025-11-03 20:02:17]   - Page size: 4096 bytes
```

### Backup Log
**Location**: `/mnt/basny-data/backups/backup.log`

**View recent backups:**
```bash
ssh BAP "tail -100 /mnt/basny-data/backups/backup.log"
```

**Check backup status:**
```bash
ssh BAP "/opt/basny/scripts/backup-status.sh"
```

## Response Procedures

### If Corruption Alert Received

**1. Acknowledge and assess:**
```bash
# Check health check log
ssh BAP "tail -100 /mnt/basny-data/backups/health-check.log"

# Run manual health check
ssh BAP "/opt/basny/scripts/check-database-health.sh"
```

**2. Stop the application immediately:**
```bash
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml stop app"
```

**3. Create emergency backup:**
```bash
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.backup /tmp/emergency-backup-$(date +%Y%m%d_%H%M%S).db'"
```

**4. Run database recovery:**
```bash
ssh BAP "cd /tmp && sqlite3 /mnt/basny-data/app/database/database.db '.recover' | sqlite3 recovered.db"
```

**5. Verify recovered database:**
```bash
ssh BAP "sqlite3 /tmp/recovered.db 'PRAGMA integrity_check'"
ssh BAP "sqlite3 /tmp/recovered.db 'SELECT COUNT(*) FROM submissions'"
```

**6. Replace database (if recovery successful):**
```bash
# Create clean version
ssh BAP "cd /tmp && sqlite3 recovered.db '.dump' | sqlite3 clean-recovered.db"

# Replace production database
ssh BAP "sudo rm -f /mnt/basny-data/app/database/database.db* && \
  sudo cp /tmp/clean-recovered.db /mnt/basny-data/app/database/database.db && \
  sudo chown 1001:65533 /mnt/basny-data/app/database/database.db && \
  sudo chmod 644 /mnt/basny-data/app/database/database.db"
```

**7. Restart application:**
```bash
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml start app"
```

**8. Verify health:**
```bash
curl https://bap.basny.org/health
ssh BAP "/opt/basny/scripts/check-database-health.sh"
```

## Testing the Monitoring System

### Test Health Check Script

```bash
ssh BAP "/opt/basny/scripts/check-database-health.sh"
```

Expected output (if healthy):
```
[TIMESTAMP] Starting database health check...
[TIMESTAMP] Running PRAGMA integrity_check...
[TIMESTAMP] SUCCESS: Database integrity check PASSED
[TIMESTAMP] Database statistics:
[TIMESTAMP]   - Size: 3.9M
[TIMESTAMP]   - Tables: 21
[TIMESTAMP]   - Pages: 982
[TIMESTAMP]   - Page size: 4096 bytes
```

### Test Backup with Integrity Check

```bash
ssh BAP "/opt/basny/scripts/backup-database.sh hourly"
```

Look for these log entries:
```
[TIMESTAMP] Checking source database integrity...
[TIMESTAMP] SUCCESS: Source database integrity verified
[TIMESTAMP] Backup created: 3.9M (source: 3.9M)
[TIMESTAMP] Verifying backup integrity...
[TIMESTAMP] SUCCESS: Backup integrity verified
```

### View Cron Jobs

```bash
ssh BAP "crontab -l"
```

## Monitoring Dashboard (Future Enhancement)

Potential improvements:
- Grafana dashboard with corruption metrics
- Prometheus alerts integration
- Slack/Discord notifications
- Automated recovery workflows
- Historical corruption trend analysis

## Maintenance

### Log Rotation

Health check and backup logs are append-only. Consider setting up log rotation:

```bash
# Add to /etc/logrotate.d/basny-backups
/mnt/basny-data/backups/health-check.log {
    weekly
    rotate 12
    compress
    missingok
    notifempty
}

/mnt/basny-data/backups/backup.log {
    weekly
    rotate 12
    compress
    missingok
    notifempty
}
```

### Update Email Recipients

Edit production config:
```bash
ssh BAP "sudo nano /mnt/basny-data/app/config/config.production.json"
```

Update `adminsEmail` field, then restart app:
```bash
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app"
```

## History

**2025-11-03**: Initial implementation
- Created `check-database-health.sh` script
- Added daily cron job at 6 AM EST
- Enhanced backup script with pre-backup integrity checks
- Deployed after resolving database corruption incident

## References

- [Backup & Recovery Guide](https://github.com/jra3/mulm/wiki/Backup-Recovery)
- [Infrastructure README](README.md)
- [SQLite PRAGMA Commands](https://www.sqlite.org/pragma.html#pragma_integrity_check)
