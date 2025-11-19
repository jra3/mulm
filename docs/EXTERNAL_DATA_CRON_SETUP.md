# External Data Sync Cron Job Setup

This guide explains how to set up automated external data syncing on the production server.

## Overview

The external data sync system can run automatically during off-peak hours to:
- Sync new species with external data sources (Wikipedia, GBIF, FishBase)
- Update stale data (species synced >90 days ago)
- Add new images and reference links
- Be respectful to API providers with conservative rate limiting

## Quick Setup

### On Production Server (EC2)

```bash
# SSH to production
ssh BAP

# Navigate to project directory
cd /opt/basny

# Run setup script (installs cron job for 3 AM daily)
./scripts/setup-external-data-cron.sh

# Or with custom schedule (2 AM every Sunday)
./scripts/setup-external-data-cron.sh --schedule "0 2 * * 0"
```

This will:
1. Create log directory at `/var/log/mulm/`
2. Set up log rotation (30 days retention)
3. Install cron job to run sync daily
4. Test the script with a dry-run

## Cron Schedule Options

The cron expression format: `MIN HOUR DAY MONTH WEEKDAY`

**Recommended Schedules:**

| Schedule | Cron Expression | Description |
|----------|----------------|-------------|
| **Daily at 3 AM** | `0 3 * * *` | Default, good for active databases |
| **Sunday at 2 AM** | `0 2 * * 0` | Weekly, good for stable databases |
| **Monday at 4 AM** | `0 4 * * 1` | Weekly, alternative timing |
| **Every other day at 3 AM** | `0 3 */2 * *` | Moderate frequency |

Choose based on:
- How often new species are added
- How active your breeding program is
- Server load patterns

## What the Sync Does

### Conservative Defaults

The automated sync is configured to be **very conservative** to avoid overwhelming API providers:

**Rate Limiting:**
- Wikipedia/Wikidata: 150ms between requests (was 100ms)
- GBIF: 120ms between requests
- FishBase: Local data (no API calls)
- **30 second pause** between different sources

**Batch Processing:**
- Processes species with approved submissions only
- Skips species synced within last 90 days (unless forced)
- No hard limit on species count (syncs all that need updates)

**Respectful Behavior:**
- User-Agent identifies the project
- Follows robots.txt (Wikipedia/GBIF)
- Graceful error handling
- Automatic retry with backoff

### Expected Duration

Typical sync times:
- **5-10 species**: ~2-3 minutes
- **20-30 species**: ~5-8 minutes
- **50-100 species**: ~15-25 minutes

Running at 3 AM ensures plenty of time before users wake up.

## Monitoring

### View Logs

```bash
# Watch logs in real-time
tail -f /var/log/mulm/external-data-sync.log

# View last sync
tail -100 /var/log/mulm/external-data-sync.log

# Search for errors
grep "❌" /var/log/mulm/external-data-sync.log

# View specific date
zcat /var/log/mulm/external-data-sync.log-20251119.gz | less
```

### Check Cron Status

```bash
# View installed cron jobs
crontab -l

# Check cron execution logs
grep CRON /var/log/syslog | tail -20

# Check if cron is running
sudo systemctl status cron
```

### Email Notifications (Optional)

To receive email notifications on errors:

```bash
# Edit crontab
crontab -e

# Add MAILTO at the top
MAILTO=your-email@example.com
0 3 * * * cd /opt/basny && npm run script scripts/sync-all-external-data.ts -- --execute >> /var/log/mulm/external-data-sync.log 2>&1
```

## Manual Execution

### Run Sync Manually

```bash
# Full sync (execute)
cd /opt/basny
npm run script scripts/sync-all-external-data.ts -- --execute

# Dry-run first (safe, no changes)
npm run script scripts/sync-all-external-data.ts

# Test with limited species
npm run script scripts/sync-all-external-data.ts -- --execute --limit=5

# Skip specific sources
npm run script scripts/sync-all-external-data.ts -- --execute --skip-fishbase
```

### Run Individual Syncs

```bash
# Wikipedia only
npm run script scripts/sync-wikipedia-external-data.ts -- --execute

# GBIF only
npm run script scripts/sync-gbif-external-data.ts -- --execute

# FishBase only
npm run script scripts/sync-fishbase-external-data-duckdb.ts -- --execute
```

## Troubleshooting

### Cron Job Not Running

**Check if cron service is running:**
```bash
sudo systemctl status cron
sudo systemctl start cron  # If not running
```

**Check cron logs:**
```bash
grep CRON /var/log/syslog | tail -50
```

**Common issues:**
- PATH not set in cron environment
- npm not in PATH
- Project directory doesn't exist
- Permissions issues

**Fix:** The setup script uses absolute paths to avoid these issues.

### Sync Errors

**Species not found:**
- Normal for unidentified species (e.g., "sp.", common names)
- Review `/var/log/mulm/external-data-sync.log` for patterns

**API errors:**
- Wikipedia/GBIF may have temporary outages
- Check API status pages
- Script will retry failed species next run

**Database locked:**
- Ensure no other processes are writing to database
- Consider running sync when site traffic is lowest

### High Resource Usage

If sync is consuming too many resources:

**Reduce batch size:**
```bash
# Edit cron job to limit species
crontab -e

# Change to:
0 3 * * * cd /opt/basny && npm run script scripts/sync-all-external-data.ts -- --execute --limit=20
```

**Increase delays:**
Edit individual sync scripts to increase rate limiting.

**Run less frequently:**
```bash
# Change to weekly
./scripts/setup-external-data-cron.sh --schedule "0 3 * * 0"
```

## Log Rotation

Logs are automatically rotated by logrotate:

**Configuration:** `/etc/logrotate.d/mulm-external-data-sync`

**Settings:**
- Daily rotation
- 30 days retention
- Compressed after 1 day
- Dated filenames

**Manual rotation:**
```bash
sudo logrotate -f /etc/logrotate.d/mulm-external-data-sync
```

## Disabling Auto-Sync

### Temporary Disable

```bash
# Comment out cron job
crontab -e

# Add # at start of line:
# 0 3 * * * cd /opt/basny && npm run script scripts/sync-all-external-data.ts -- --execute
```

### Permanent Removal

```bash
# Remove cron job
crontab -e
# Delete the line containing 'sync-all-external-data.ts'

# Or remove entire crontab
crontab -r
```

## Production Deployment Checklist

When deploying the cron job to production:

- [ ] Test sync script manually first (dry-run)
- [ ] Verify log directory permissions
- [ ] Check disk space for logs
- [ ] Set up log rotation
- [ ] Choose appropriate schedule
- [ ] Install cron job
- [ ] Monitor first few runs
- [ ] Set up alerts for failures (optional)
- [ ] Document in infrastructure notes

## Performance Tips

### Optimize Sync Times

1. **Run during true off-peak hours**
   - Check Google Analytics for lowest traffic
   - Usually 2-5 AM in your timezone

2. **Batch by species type**
   - Sync fish one day, corals another
   - Use `--species-type` argument

3. **Use staggered schedules**
   - Wikipedia: 2 AM
   - GBIF: 3 AM
   - FishBase: 4 AM

### Database Optimization

After large syncs, optimize the database:

```bash
cd /opt/basny
npm run script scripts/optimize-database.ts
```

This rebuilds indexes and vacuums the database.

## Related Documentation

- [External Data Sources](https://github.com/jra3/mulm/wiki/External-Data-Sources) - Complete integration guide
- [Production Deployment](https://github.com/jra3/mulm/wiki/Production-Deployment) - General deployment guide
- [Monitoring & Logs](https://github.com/jra3/mulm/wiki/Monitoring-Logs) - Production monitoring

---

**Last Updated:** November 19, 2025
