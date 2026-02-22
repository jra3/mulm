# Production Infrastructure & Deployment

AWS EC2-based infrastructure deployed with AWS CDK.

**Production URL**: https://bap.basny.org

**📖 Full Documentation**: See [GitHub Wiki](https://github.com/jra3/mulm/wiki) for comprehensive guides:
- [Production Deployment](https://github.com/jra3/mulm/wiki/Production-Deployment)
- [Infrastructure Guide](https://github.com/jra3/mulm/wiki/Infrastructure-Guide)
- [Security Overview](https://github.com/jra3/mulm/wiki/Security-Overview)

## ⚠️ CRITICAL RESOURCES - DO NOT DELETE ⚠️

**IMPORTANT**: The following production resources contain live data and are protected:

**EBS Volume**: `vol-0aba5b85a1582b2c0` (8GB)
- Contains production database, config with secrets, SSL certificates
- Protected with RETAIN deletion policy in CDK
- Tagged with `DoNotDelete=true`
- **NEVER detach or delete this volume**

**Elastic IP**: `eipalloc-01f29c26363e0465a` (98.91.62.199)
- DNS (bap.basny.org) points to this IP
- Protected with RETAIN deletion policy in CDK
- Tagged with `DoNotDelete=true`
- **NEVER release or disassociate without updating DNS**

**Resource Reference**: Resource IDs stored in AWS Systems Manager Parameter Store
- Parameters: `/basny/production/data-volume-id`, `/basny/production/elastic-ip-allocation-id`
- View: `aws --profile basny ssm get-parameters --names /basny/production/data-volume-id /basny/production/elastic-ip-allocation-id /basny/production/elastic-ip-address`

## Infrastructure Overview

- **Platform**: AWS EC2 (t3.micro) with 20GB EBS volume
- **IP**: 98.91.62.199 (Elastic IP)
- **Data Volume**: vol-0aba5b85a1582b2c0 (8GB, persistent across all deployments)
- **SSH**: Connect via `ssh BAP` (Tailscale-only for security - see [Tailscale Migration Guide](TAILSCALE_MIGRATION.md))
- **Emergency Access**: AWS Systems Manager Session Manager (no SSH needed)
- **Location**: `/opt/basny` (application code), `/mnt/basny-data` (persistent data)
- **CDK Stack**: Infrastructure defined in `infrastructure/` directory

### Docker Containers

Production runs three containers via `docker-compose.prod.yml`:
- **basny-app**: Node.js application on port 4200 (internal)
- **basny-nginx**: Reverse proxy handling HTTP/HTTPS traffic
- **basny-certbot**: Automatic SSL certificate renewal

### Data Persistence

All persistent data lives on EBS volume at `/mnt/basny-data/`:

```
/mnt/basny-data/
├── app/
│   ├── config/config.production.json  # Production config
│   └── database/database.db           # SQLite database
└── nginx/
    ├── certs/                         # SSL certificates
    ├── logs/                          # Access/error logs
    └── webroot/                       # ACME challenges
```

**File Permissions (Security)**:
- `config.production.json`: Must be `-rw------- 1001:65533` (600, owned by nodejs user)
- `database.db`: Must be `-rw-r--r-- 1001:65533` (644, owned by nodejs user)
- App runs as UID 1001 (nodejs user), so files must be readable by this user

## Standard Deployment

**Docker images are built automatically** by GitHub Actions on push to main branch and pushed to GitHub Container Registry (GHCR).

```bash
# Deploy latest image from GHCR
ssh BAP "cd /opt/basny && git pull && sudo docker-compose -f docker-compose.prod.yml pull && sudo docker-compose -f docker-compose.prod.yml up -d"

# Deploy with local changes (resets uncommitted changes on server)
ssh BAP "cd /opt/basny && git reset --hard && git pull && sudo docker-compose -f docker-compose.prod.yml pull && sudo docker-compose -f docker-compose.prod.yml up -d"

# Verify deployment
ssh BAP "sudo docker ps"  # Check container status
ssh BAP "sudo docker logs basny-app --tail 50"  # View app logs
curl https://bap.basny.org/health  # Test health endpoint
```

**How it works:**
1. Push code to GitHub (main branch)
2. GitHub Actions automatically builds Docker image
3. Image is pushed to `ghcr.io/jra3/mulm:latest`
4. Production server pulls pre-built image (no build needed on server)

## Common Operations

### View Logs

```bash
ssh BAP "sudo docker logs basny-app --tail 100 -f"  # Application logs
ssh BAP "sudo docker logs basny-nginx --tail 100 -f"  # Nginx logs
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml logs --tail 100 -f"  # All logs
```

### Restart Services

```bash
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart"  # All services
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app"  # App only
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart nginx"  # Nginx only
```

### Database Operations

```bash
# Backup
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.backup /tmp/backup_$(date +%Y%m%d_%H%M%S).db'"
scp BAP:/tmp/backup_*.db ./backups/

# Query
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'SELECT COUNT(*) FROM members;'"

# Check integrity
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'PRAGMA integrity_check;'"
```

### Update Configuration

```bash
# Edit config
ssh BAP "sudo nano /mnt/basny-data/app/config/config.production.json"

# Check permissions (should be -rw------- 1001:65533)
ssh BAP "ls -la /mnt/basny-data/app/config/config.production.json"

# Restart after config change
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app"
```

### Fix File Permissions

```bash
ssh BAP "sudo chown 1001:65533 /mnt/basny-data/app/config/config.production.json && sudo chmod 600 /mnt/basny-data/app/config/config.production.json"
ssh BAP "sudo chown 1001:65533 /mnt/basny-data/app/database/database.db && sudo chmod 644 /mnt/basny-data/app/database/database.db"
```

## Monitoring & Health Checks

```bash
# Application health
curl https://bap.basny.org/health  # Should return: {"status":"healthy","timestamp":"..."}

# Container health
ssh BAP "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"

# Resource usage
ssh BAP "df -h /mnt/basny-data"  # Disk usage
ssh BAP "free -h"  # Memory usage
ssh BAP "top -bn1 | head -20"  # CPU usage
```

## Troubleshooting

### Container Issues

```bash
# View all logs
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml logs"

# Check all containers including stopped
ssh BAP "sudo docker ps -a"

# Restart stuck container
ssh BAP "sudo docker restart basny-app"

# Pull fresh image and restart
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml down && sudo docker-compose -f docker-compose.prod.yml pull && sudo docker-compose -f docker-compose.prod.yml up -d"
```

### Image/Disk Issues

```bash
# Check disk usage
ssh BAP "sudo docker system df"

# Remove old images
ssh BAP "sudo docker image prune -a"

# Clean all unused Docker resources
ssh BAP "sudo docker system prune -a"
```

### Database Issues

```bash
# Check integrity
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'PRAGMA integrity_check;'"

# Compact database
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'VACUUM;'"

# Check size
ssh BAP "ls -lh /mnt/basny-data/app/database/database.db"
```

### Disk Space Issues

```bash
# Find large directories
ssh BAP "du -h --max-depth=1 /mnt/basny-data/ | sort -hr"

# Clean Docker resources (⚠️ removes unused containers/images/networks)
ssh BAP "sudo docker system prune -a --volumes"

# Find large log files
ssh BAP "find /mnt/basny-data/nginx/logs -type f -size +100M -ls"
```

## Rollback Procedure

```bash
# 1. View recent commits
ssh BAP "cd /opt/basny && git log --oneline -10"

# 2. Revert to specific commit
ssh BAP "cd /opt/basny && git reset --hard <commit-hash>"
# Or revert to previous commit: ssh BAP "cd /opt/basny && git reset --hard HEAD~1"

# 3. Pull specific version from GHCR (images are tagged with commit SHA)
# View available tags at: https://github.com/jra3/mulm/pkgs/container/mulm
ssh BAP "cd /opt/basny && sudo docker pull ghcr.io/jra3/mulm:main-<commit-sha>"
# Or just pull latest
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml pull && sudo docker-compose -f docker-compose.prod.yml up -d"

# 4. Restore database if needed
ssh BAP "ls -lh /tmp/backup_*.db"  # List backups
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.restore /tmp/backup_YYYYMMDD_HHMMSS.db'"
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app"

# 5. Verify rollback
curl https://bap.basny.org/health
ssh BAP "cd /opt/basny && git log --oneline -1"  # Check current commit
```

## Database Backup System

**📖 Full Documentation**: See [Backup & Recovery Guide](https://github.com/jra3/mulm/wiki/Backup-Recovery)

**Quick Reference**:
- **Scripts**: `scripts/backup-database.sh`, `scripts/restore-database.sh`, `scripts/backup-status.sh`
- **Backup Location**: `/mnt/basny-data/backups/` (on EBS volume)
- **Retention**: Hourly (4), Daily (7), Weekly (4), Monthly (12)

**Common Commands**:

```bash
# Manual backup
ssh BAP "/opt/basny/scripts/backup-database.sh hourly"

# Check backup status
ssh BAP "/opt/basny/scripts/backup-status.sh"

# Restore from backup (interactive)
ssh BAP "/opt/basny/scripts/restore-database.sh"

# View backup logs
ssh BAP "tail -f /mnt/basny-data/backups/backup.log"
```

## Recovery Procedures

### If Database is Lost

1. Locate most recent backup:
   ```bash
   ssh BAP
   ls -lah /tmp/*.sqlite /tmp/*.db
   ls -lah ~/backups/*.sqlite ~/backups/*.db
   ```

2. Restore database:
   ```bash
   cd /opt/basny
   sudo docker-compose -f docker-compose.prod.yml down
   sudo cp /path/to/backup.sqlite /mnt/basny-data/app/database/database.db
   sudo chown 1001:65533 /mnt/basny-data/app/database/database.db
   sudo chmod 644 /mnt/basny-data/app/database/database.db
   sudo docker-compose -f docker-compose.prod.yml up -d
   ```

3. Verify data integrity:
   ```bash
   sqlite3 /mnt/basny-data/app/database/database.db "PRAGMA integrity_check;"
   ```

### If Config is Lost

1. Restore config (from backup or password manager):
   ```bash
   sudo cp /tmp/config.production.json /mnt/basny-data/app/config/config.production.json
   sudo chown 1001:65533 /mnt/basny-data/app/config/config.production.json
   sudo chmod 600 /mnt/basny-data/app/config/config.production.json
   cd /opt/basny
   sudo docker-compose -f docker-compose.prod.yml restart
   ```

### If SSL Certificates are Lost

1. Verify DNS is pointing to current IP:
   ```bash
   dig bap.basny.org +short  # Should return: 98.91.62.199
   ```

2. Re-issue SSL certificates (after DNS propagates):
   ```bash
   cd /opt/basny
   sudo ./scripts/init-letsencrypt.sh
   ```

### If Entire Volume is Lost

**Prevention** (ALWAYS do before infrastructure changes):

```bash
aws --profile basny ec2 create-snapshot \
  --volume-id vol-0aba5b85a1582b2c0 \
  --description "Pre-deployment backup $(date +%Y%m%d-%H%M%S)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=BASNY-PreDeployment-Backup},{Key=DoNotDelete,Value=true}]'
```

**Recovery** (if snapshot exists):

1. Create new volume from snapshot
2. Update SSM parameter: `/basny/production/data-volume-id`
3. Redeploy CDK stack: `cd infrastructure && npm run cdk deploy -- --profile basny`
4. Verify data integrity

See [Infrastructure Guide](https://github.com/jra3/mulm/wiki/Infrastructure-Guide) for detailed steps.

## SSH Access & Security

**SSH access is Tailscale-only** for improved security. Public SSH (port 22) is closed to the internet.

### Quick Start

```bash
# Connect via Tailscale (ensure Tailscale is running)
ssh BAP

# Emergency access (if Tailscale is down)
aws --profile basny ssm start-session --target $(aws --profile basny ec2 describe-instances --filters "Name=tag:Name,Values=BASNY-Production" --query 'Reservations[0].Instances[0].InstanceId' --output text)
```

### First-Time Setup

If you haven't migrated to Tailscale yet, see **[Tailscale Migration Guide](TAILSCALE_MIGRATION.md)** for:
- Installing Tailscale on the server
- Closing public SSH port
- Configuring emergency SSM access
- Rollback procedures

## CDK Stack Architecture

The CDK infrastructure is split into two stacks to separate stateful and stateless resources:

| Stack | Purpose | Deploy frequency | Protection |
|-------|---------|-----------------|------------|
| **PersistentStack** | EC2, VPC, EBS, EIP, SG, IAM, logs | Rarely (manual) | Termination protection, RETAIN policies |
| **MonitoringStack** | SNS topics, CloudWatch alarms | Freely (CI/CD safe) | None (stateless, recreatable) |

**Cross-stack communication** uses SSM Parameter Store (`/basny/production/instance-id`),
not CloudFormation exports. This avoids coupling between stacks.

### Deployment Commands

```bash
cd infrastructure
npm run build

# Deploy only monitoring (safe, frequent)
AWS_PROFILE=basny npx cdk deploy MonitoringStack

# Deploy only infrastructure (rare, careful - requires snapshot first!)
AWS_PROFILE=basny npx cdk deploy PersistentStack --require-approval broadening

# Preview changes before deploying
AWS_PROFILE=basny npx cdk diff PersistentStack
AWS_PROFILE=basny npx cdk diff MonitoringStack
```

### Initial Deployment

**Prerequisites**:
- AWS CLI configured with basny profile: `aws configure --profile basny`
- AWS CDK CLI installed: `npm install -g aws-cdk`
- Infrastructure dependencies: `cd infrastructure && npm install`

**First-time deployment**:

```bash
# 1. Bootstrap CDK (creates toolkit stack: S3, ECR, IAM)
cd infrastructure
npm run cdk bootstrap -- --profile basny

# 2. Build and deploy both stacks
npm run build
AWS_PROFILE=basny npx cdk deploy PersistentStack --require-approval broadening
AWS_PROFILE=basny npx cdk deploy MonitoringStack
```

**Retrieve SSH key**:

```bash
cd infrastructure
./scripts/get-private-key.sh  # Saves to ~/.ssh/basny-ec2-keypair.pem with 400 permissions
```

### CDK Redeployment

When updating persistent infrastructure (instance type, security groups, etc.):

```bash
# 1. Create snapshot FIRST (CRITICAL)
aws --profile basny ec2 create-snapshot \
  --volume-id vol-0aba5b85a1582b2c0 \
  --description "Pre-deployment backup $(date +%Y%m%d-%H%M%S)"

# 2. Build CDK stack
cd infrastructure
npm run build

# 3. Preview changes
AWS_PROFILE=basny npx cdk diff PersistentStack

# 4. Deploy
AWS_PROFILE=basny npx cdk deploy PersistentStack --require-approval broadening

# 5. Verify
aws --profile basny ec2 describe-instances --filters "Name=tag:Name,Values=BASNY-Production"
ssh BAP "sudo docker ps"
```

**What persists across redeployments**:
- ✅ EBS Data Volume (vol-0aba5b85a1582b2c0)
- ✅ Elastic IP (98.91.62.199)
- ✅ All data in /mnt/basny-data/

**What gets replaced**:
- EC2 instance (if configuration changed)
- Root volume (contains no persistent data)

### Testing Infrastructure Changes Safely

**NEVER test with production volume attached!**

See [Infrastructure Guide](https://github.com/jra3/mulm/wiki/Infrastructure-Guide) for safe testing procedures.

### Migration from Single Stack

If migrating from the old single `InfrastructureStack`, see **[MIGRATION_RUNBOOK.md](MIGRATION_RUNBOOK.md)** for the step-by-step process.

### Pre-Deployment Checklist

Before ANY `cdk deploy PersistentStack` or infrastructure changes:
- [ ] Create snapshot of production EBS volume
- [ ] Verify production volume is NOT attached to test instance
- [ ] Review UserData script for safety checks
- [ ] Verify RETAIN deletion policies are set
- [ ] Confirm stack termination protection is enabled
- [ ] Have recent database backup available locally
- [ ] Test changes on separate stack first
- [ ] Review `cdk diff` output carefully

## Configuration Management

### Development

Config file: `src/config.json` (git-ignored)

### Production

Config file: `/mnt/basny-data/app/config/config.production.json`
- Mounted read-only into container at `/app/src/config.json`
- Database path must be absolute: `"/mnt/app-data/database/database.db"`
- **Permissions**: Must be 600 (owner-only) and owned by UID 1001 (nodejs user)

### Environment Variables

- `NODE_ENV`: Set to "production" in docker-compose.prod.yml
- `DATABASE_FILE`: Can override config file setting (optional)

## Monitoring & Automation

### Database Monitoring

The production database is monitored for corruption:
- **Daily health checks** at 6:00 AM EST
- **Pre-backup verification** before every backup
- **Email alerts** sent to admins if corruption detected

See **[DATABASE_MONITORING.md](DATABASE_MONITORING.md)** for:
- Health check system overview
- Alert configuration
- Response procedures
- Recovery steps

### Automated Backups

Database backups run automatically via cron:
- **Hourly**: Every 6 hours (keeps last 4)
- **Daily**: 2:00 AM EST (keeps last 7)
- **Weekly**: Sunday 3:00 AM EST (keeps last 4)
- **Monthly**: 1st at 4:00 AM EST (keeps last 12)

All backups include integrity verification and email alerts on failure.

See **[CRONTAB.md](CRONTAB.md)** for:
- Complete cron schedule
- Adding/removing jobs
- Testing procedures
- Troubleshooting

### Email Alerts

Email notifications use sendmail (ssmtp) to relay via the production SMTP server.

See **[SENDMAIL_CONFIGURATION.md](SENDMAIL_CONFIGURATION.md)** for:
- ssmtp installation and configuration
- Testing email delivery
- Updating SMTP credentials
- Troubleshooting email issues

## Further Reading

- **[nginx/README.md](../nginx/README.md)** - Nginx configuration, SSL, rate limiting, security headers
- **[GitHub Wiki](https://github.com/jra3/mulm/wiki)** - Comprehensive deployment and operations guides
- **[DATABASE_MONITORING.md](DATABASE_MONITORING.md)** - Health checks, corruption detection, alerts
- **[SENDMAIL_CONFIGURATION.md](SENDMAIL_CONFIGURATION.md)** - Email alert system configuration
- **[CRONTAB.md](CRONTAB.md)** - Automated jobs and schedules
