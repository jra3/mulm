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

### One-Step Workflow with Image Downloads

The automated sync uses the **full-database orchestrator** with integrated image downloading:

**What Happens:**
- Queries Wikipedia, GBIF, and FishBase for ALL species
- Downloads ALL images to Cloudflare R2 (no external URLs)
- Transcodes to 800×600 JPEG (85% quality)
- Stores R2 URLs with full metadata
- Avoids re-downloads via MD5 hash checking

**Rate Limiting:**
- Wikipedia/Wikidata: 150ms between requests
- GBIF: 120ms between requests
- FishBase: Local data (no API calls)
- **30 second pause** between different sources
- **Image downloads**: Included in API delay (no separate rate limit)

**Batch Processing:**
- Processes all species in database (full catalog coverage)
- Skips species synced within last 90 days
- Batch size: Syncs all that need updates per run

**Respectful Behavior:**
- User-Agent identifies the project
- Follows robots.txt (Wikipedia/GBIF)
- Graceful error handling (fallback to external URL on download failure)
- Automatic retry with backoff

### Expected Duration

With image downloading enabled:
- **10-20 species**: ~5-15 minutes
- **50-100 species**: ~30-60 minutes
- **Daily incremental**: Usually 0-50 species (~5-30 minutes)

Running at 3 AM ensures plenty of time for processing.

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
# Full sync with image download (recommended)
cd /opt/basny
npm run script scripts/sync-all-species-full-database.ts -- --execute --download-images --batch-size=500

# Dry-run first (safe, no changes)
npm run script scripts/sync-all-species-full-database.ts -- --download-images --batch-size=500

# Test with small batch
npm run script scripts/sync-all-species-full-database.ts -- --execute --download-images --batch-size=10

# Skip specific sources
npm run script scripts/sync-all-species-full-database.ts -- --execute --download-images --skip-fishbase
```

### Run Individual Syncs

```bash
# Wikipedia only (all species)
npm run script scripts/sync-wikipedia-all-species.ts -- --execute --download-images --batch-size=500

# GBIF only (all species)
npm run script scripts/sync-gbif-all-species.ts -- --execute --download-images --batch-size=500

# FishBase only (fish species)
npm run script scripts/sync-fishbase-all-species.ts -- --execute --download-images --batch-size=500
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
