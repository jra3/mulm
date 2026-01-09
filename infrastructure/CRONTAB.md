# Crontab Configuration

This document describes the cron jobs configured on the BASNY BAP production server for automated backups and health monitoring.

## Overview

The production server uses two crontabs:
1. **User crontab (ec2-user)** - Database backups
2. **Root crontab** - Database health checks

## User Crontab (ec2-user)

Manages automated database backups with rotating retention policies.

**View:**
```bash
ssh BAP "crontab -l"
```

**Configuration:**
```cron
# BASNY Database Backup Cron Jobs (run with sudo to enable email alerts)
# Logs are written to /mnt/basny-data/backups/backup.log

# Hourly backups (every 6 hours) - keeps last 4
0 */6 * * * sudo /opt/basny/scripts/backup-database.sh hourly >> /mnt/basny-data/backups/backup.log 2>&1

# Daily backup at 2 AM EST - keeps last 7
0 2 * * * sudo /opt/basny/scripts/backup-database.sh daily >> /mnt/basny-data/backups/backup.log 2>&1

# Weekly backup on Sunday at 3 AM EST - keeps last 4
0 3 * * 0 sudo /opt/basny/scripts/backup-database.sh weekly >> /mnt/basny-data/backups/backup.log 2>&1

# Monthly backup on 1st at 4 AM EST - keeps last 12
0 4 1 * * sudo /opt/basny/scripts/backup-database.sh monthly >> /mnt/basny-data/backups/backup.log 2>&1
```

### Backup Schedule

| Type | Schedule | Retention | Location |
|------|----------|-----------|----------|
| Hourly | Every 6 hours (0, 6, 12, 18) | Last 4 | `/mnt/basny-data/backups/hourly/` |
| Daily | 2:00 AM EST daily | Last 7 | `/mnt/basny-data/backups/daily/` |
| Weekly | 3:00 AM EST Sunday | Last 4 | `/mnt/basny-data/backups/weekly/` |
| Monthly | 4:00 AM EST 1st of month | Last 12 | `/mnt/basny-data/backups/monthly/` |

### Why sudo?

Backup jobs run with `sudo` to:
1. Read `/mnt/basny-data/app/config/config.production.json` (600 permissions)
2. Send email alerts via sendmail (needs config access)
3. Write backups to `/mnt/basny-data/backups/` (may need elevated permissions)

## Root Crontab

Manages database health monitoring, system health metrics, and Docker cleanup.

**View:**
```bash
ssh BAP "sudo crontab -l"
```

**Configuration:**
```cron
# BASNY System Monitoring and Maintenance (runs as root)

# Database health check - runs daily at 6 AM EST
0 6 * * * /opt/basny/scripts/check-database-health.sh >> /mnt/basny-data/backups/health-check.log 2>&1

# Application health check - pushes metric to CloudWatch every 5 minutes
*/5 * * * * /opt/basny/scripts/check-health-metric.sh >> /mnt/basny-data/logs/health-metric.log 2>&1

# Docker cleanup - Sundays at 1 AM EST (before weekly backup)
0 1 * * 0 docker system prune -af --filter "until=48h" >> /mnt/basny-data/logs/docker-cleanup.log 2>&1
```

### Health Check Schedule

| Check | Schedule | Purpose | Alerts |
|-------|----------|---------|--------|
| Database Integrity | 6:00 AM EST daily | Detect database corruption | Email on failure |
| App Health Metric | Every 5 minutes | Push health status to CloudWatch | CloudWatch Alarm → SNS |
| Docker Cleanup | 1:00 AM EST Sundays | Remove old Docker images | Logged only |

### Why root?

Health checks run as root to:
1. Read `/mnt/basny-data/app/config/config.production.json` (600 permissions)
2. Send email alerts via sendmail (needs SMTP credentials)
3. Access database file for integrity checking

## Cron Schedule Visual

```
Time (EST) │ Action
───────────┼────────────────────────────────────────
*/5        │ 🔄 Health metric to CloudWatch (every 5 min)
00:00      │ Hourly backup (every 6 hours)
01:00      │ 🧹 Docker cleanup (Sundays only)
02:00      │ Daily backup
03:00      │ Weekly backup (Sundays only)
04:00      │ Monthly backup (1st of month only)
06:00      │ ⚠️ Database health check
12:00      │ Hourly backup (every 6 hours)
18:00      │ Hourly backup (every 6 hours)
```

## Email Notifications

### Sendmail Configuration

All cron jobs can send email alerts via sendmail (ssmtp). See [SENDMAIL_CONFIGURATION.md](SENDMAIL_CONFIGURATION.md) for details.

**Email Recipients:**
- **Default:** Admin email address (from `config.production.json` adminsEmail, configured in `/etc/ssmtp/ssmtp.conf`)
- **Override:** Set `MAILTO` in crontab

### Alert Types

**Backup Alerts:**
- Pre-backup corruption detection
- Backup creation failure
- Post-backup integrity check failure
- Sent by: `backup-database.sh`

**Health Check Alerts:**
- Database corruption detected
- Health check script failure
- Sent by: `check-database-health.sh`

**Cron Job Failures:**
- Any script that exits non-zero or outputs to stderr
- Automatically emailed by cron daemon

## Log Files

All cron jobs write logs for troubleshooting:

| Job | Log File | Description |
|-----|----------|-------------|
| Backups | `/mnt/basny-data/backups/backup.log` | All backup operations |
| DB Health Checks | `/mnt/basny-data/backups/health-check.log` | Daily integrity checks |
| App Health Metric | `/mnt/basny-data/logs/health-metric.log` | CloudWatch metric pushes |
| Docker Cleanup | `/mnt/basny-data/logs/docker-cleanup.log` | Weekly cleanup results |
| Cron Errors | `/var/log/cron` | System cron daemon logs |

**View logs:**
```bash
# Backup logs
ssh BAP "tail -100 /mnt/basny-data/backups/backup.log"

# Health check logs
ssh BAP "tail -100 /mnt/basny-data/backups/health-check.log"

# System cron logs
ssh BAP "sudo journalctl -u crond -f"
```

## Editing Crontabs

### User Crontab (ec2-user)

```bash
ssh BAP
crontab -e
# Edit, save, and exit
```

**Or update remotely:**
```bash
ssh BAP "crontab -l > /tmp/user-crontab"
# Edit /tmp/user-crontab
ssh BAP "crontab /tmp/user-crontab"
```

### Root Crontab

```bash
ssh BAP
sudo crontab -e
# Edit, save, and exit
```

**Or update remotely:**
```bash
ssh BAP "sudo crontab -l > /tmp/root-crontab"
# Edit /tmp/root-crontab
ssh BAP "sudo crontab /tmp/root-crontab"
```

### Validation

After editing, verify the crontab:
```bash
# Check user crontab
ssh BAP "crontab -l"

# Check root crontab
ssh BAP "sudo crontab -l"

# Check cron is running
ssh BAP "sudo systemctl status crond"
```

## Testing Cron Jobs

### Test Individual Scripts

```bash
# Test backup script
ssh BAP "sudo /opt/basny/scripts/backup-database.sh hourly"

# Test health check
ssh BAP "sudo /opt/basny/scripts/check-database-health.sh"
```

### Test Cron Execution

Add a temporary test job:

```bash
# Add test job (runs every minute)
ssh BAP "echo '* * * * * echo \"Cron test at \$(date)\" >> /tmp/cron-test.log' | crontab -"

# Wait 2 minutes, then check output
ssh BAP "cat /tmp/cron-test.log"

# Remove test job
ssh BAP "crontab -l | grep -v 'Cron test' | crontab -"
ssh BAP "rm /tmp/cron-test.log"
```

### Test Email Delivery

```bash
# Add test job that sends email
ssh BAP "echo '* * * * * echo \"Test cron email at \$(date)\"' | crontab -"

# Check email at admin address in ~1 minute

# Remove test job
ssh BAP "crontab -l | grep -v 'Test cron email' | crontab -"
```

## Troubleshooting

### Cron job not running

**Check cron daemon:**
```bash
ssh BAP "sudo systemctl status crond"

# Restart if needed
ssh BAP "sudo systemctl restart crond"
```

**Check crontab syntax:**
```bash
# View crontab
ssh BAP "crontab -l"

# Common syntax errors:
# - Missing */command
# - Wrong time format
# - Script path typo
```

**Check system logs:**
```bash
ssh BAP "sudo journalctl -u crond --since '1 hour ago'"
```

### Script runs manually but not via cron

**Common causes:**
1. **PATH issues** - Cron has limited PATH
2. **Permissions** - User may not have sudo access
3. **Environment variables** - Not set in cron environment

**Solution - Use absolute paths:**
```cron
# Bad (relies on PATH)
0 6 * * * backup-database.sh

# Good (absolute path)
0 6 * * * /opt/basny/scripts/backup-database.sh
```

**Solution - Set environment in crontab:**
```cron
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 6 * * * /opt/basny/scripts/backup-database.sh
```

### Emails not being sent

**Check sendmail is configured:**
```bash
ssh BAP "which sendmail"
# Should output: /usr/sbin/sendmail
```

**Test sendmail:**
```bash
ssh BAP "echo 'Test' | sendmail -v YOUR_EMAIL@example.com"
```

**Check ssmtp configuration:**
```bash
ssh BAP "sudo cat /etc/ssmtp/ssmtp.conf"
```

See [SENDMAIL_CONFIGURATION.md](SENDMAIL_CONFIGURATION.md) for detailed troubleshooting.

### Check if cron job ran

```bash
# Check cron execution logs
ssh BAP "sudo journalctl -u crond | grep backup-database"

# Check script output logs
ssh BAP "tail -50 /mnt/basny-data/backups/backup.log"
```

### Cron running but script failing

```bash
# Run script manually with same user
ssh BAP "sudo -u ec2-user /opt/basny/scripts/backup-database.sh hourly"

# Check exit code
echo $?

# Check logs for errors
ssh BAP "tail -100 /mnt/basny-data/backups/backup.log | grep ERROR"
```

## Cron Environment

Cron jobs run with a minimal environment. Important differences from interactive shell:

| Variable | Interactive Shell | Cron |
|----------|------------------|------|
| PATH | `/usr/local/bin:/usr/bin:/bin:...` | `/usr/bin:/bin` |
| HOME | `/home/ec2-user` | `/home/ec2-user` |
| SHELL | `/bin/bash` | `/bin/sh` |
| USER | `ec2-user` | `ec2-user` |
| PWD | Current directory | `/home/ec2-user` |
| MAILTO | Not set | `root` or user |

**Best practices:**
- Use absolute paths for all commands
- Don't rely on aliases or shell functions
- Explicitly set environment variables if needed
- Test scripts in clean environment before adding to cron

## Security Considerations

### Sudo Access

The ec2-user can run backup scripts with sudo without password (configured in sudoers):

```bash
# Check sudo permissions
ssh BAP "sudo -l"
```

This is necessary for backup scripts to:
- Read protected config files
- Write to backup directories
- Send email alerts

### Log File Permissions

Ensure log files are readable for troubleshooting:

```bash
ssh BAP "ls -l /mnt/basny-data/backups/*.log"
# Should be: -rw-r--r-- or -rw-rw-r--
```

### Crontab Backups

Crontab configurations should be backed up:

```bash
# Backup current crontabs
ssh BAP "crontab -l > ~/crontab-user-backup-$(date +%Y%m%d).txt"
ssh BAP "sudo crontab -l > ~/crontab-root-backup-$(date +%Y%m%d).txt"

# Download locally
scp BAP:~/crontab-*-backup-*.txt ./backups/
```

## Maintenance

### Adding New Cron Job

1. Edit appropriate crontab:
```bash
ssh BAP "crontab -e"  # For user jobs
# OR
ssh BAP "sudo crontab -e"  # For root jobs
```

2. Add job following the format:
```cron
# Comment describing what this does
MINUTE HOUR DAY MONTH WEEKDAY command >> /path/to/log 2>&1
```

3. Save and verify:
```bash
ssh BAP "crontab -l"  # Verify added
ssh BAP "sudo journalctl -u crond --since '1 minute ago'"  # Check cron reloaded
```

4. Test execution:
```bash
# Wait for next scheduled run, or run manually
ssh BAP "command"
```

### Removing Cron Job

```bash
ssh BAP "crontab -e"  # Open editor, delete line, save

# Or programmatically
ssh BAP "crontab -l | grep -v 'job-to-remove' | crontab -"
```

### Updating Backup Schedule

Example: Change hourly backups from every 6 hours to every 3 hours:

```bash
ssh BAP "crontab -l | sed 's|0 \*/6|0 \*/3|' | crontab -"
ssh BAP "crontab -l"  # Verify change
```

## References

- [Cron Format](https://crontab.guru/) - Interactive cron schedule expression editor
- [Crontab Man Page](https://man7.org/linux/man-pages/man5/crontab.5.html)
- [backup-database.sh](../scripts/backup-database.sh) - Backup script
- [check-database-health.sh](../scripts/check-database-health.sh) - Health check script
- [SENDMAIL_CONFIGURATION.md](SENDMAIL_CONFIGURATION.md) - Email alert configuration
- [DATABASE_MONITORING.md](DATABASE_MONITORING.md) - Monitoring system overview

## History

**2025-11-03**: Initial configuration
- User crontab: Database backups (hourly/daily/weekly/monthly)
- Root crontab: Daily health checks (6 AM EST)
- All jobs configured with logging
- Email alerts enabled via sendmail/ssmtp
- Sudo access configured for config file access
