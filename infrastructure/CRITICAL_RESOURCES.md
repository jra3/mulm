# ⚠️ CRITICAL PRODUCTION RESOURCES - DO NOT DELETE ⚠️

This document identifies production resources that contain live data and MUST NEVER be deleted.

## Critical Resource IDs

### Production EBS Volume
- **Volume ID**: `vol-0aba5b85a1582b2c0`
- **Size**: 8 GB (gp3)
- **Mount Point**: `/mnt/basny-data` (on EC2 instance)
- **Device**: `/dev/xvdf`
- **Contains**:
  - Production SQLite database (`/mnt/basny-data/app/database/database.db`)
  - Production config with secrets (`/mnt/basny-data/app/config/config.production.json`)
  - Let's Encrypt SSL certificates (`/mnt/basny-data/nginx/certs/`)
  - Nginx logs (`/mnt/basny-data/nginx/logs/`)

**Protection Measures**:
- CDK deletion policy set to RETAIN
- Protected tag: `DoNotDelete=true`
- UserData script checks for existing data before formatting
- Stack termination protection enabled

### Production Elastic IP
- **Allocation ID**: `eipalloc-01f29c26363e0465a`
- **IP Address**: `98.91.62.199`
- **DNS**: `bap.basny.org` points to this IP
- **Purpose**: Stable public IP address for production application

**Protection Measures**:
- CDK uses existing EIP (does not create new one)
- CDK deletion policy set to RETAIN
- Protected tag: `DoNotDelete=true`
- Stack termination protection enabled

## SSM Parameter Store

Critical resource IDs are stored in AWS Systems Manager Parameter Store. The CDK stack reads these parameters at synth time to reference the production resources.

**Parameter Names**:
- `/basny/production/data-volume-id` → `vol-0aba5b85a1582b2c0`
- `/basny/production/elastic-ip-allocation-id` → `eipalloc-01f29c26363e0465a`
- `/basny/production/elastic-ip-address` → `98.91.62.199`

**Why SSM Parameter Store?**
- Single source of truth for resource IDs
- Human-readable parameter names instead of hardcoded IDs in code
- Can update resource IDs without modifying code (if resources need to be recreated)
- Version history tracked by SSM
- Parameters are tagged with `Protected=true`

**To view parameters**:
```bash
aws --profile basny ssm get-parameters \
  --names /basny/production/data-volume-id \
          /basny/production/elastic-ip-allocation-id \
          /basny/production/elastic-ip-address
```

**To update a parameter** (only if resource is recreated):
```bash
aws --profile basny ssm put-parameter \
  --name /basny/production/data-volume-id \
  --value vol-NEW_VOLUME_ID \
  --overwrite
```

**⚠️ IMPORTANT**: Only update these parameters if you've intentionally recreated the resources. Never change them to point to a different resource unless you're absolutely sure.

## Protection Strategy (5 Layers)

1. **Visual Identification**: Resources tagged with `DoNotDelete=true` and descriptive names
2. **CDK Deletion Policies**: RETAIN policies prevent CloudFormation from deleting resources
3. **Stack Termination Protection**: Prevents `cdk destroy` from running without explicit disable
4. **UserData Safety Checks**: Prevents accidental formatting of volumes with existing data
5. **Documentation**: This file and warnings in CLAUDE.md

## ⚠️ WARNING: Data Loss History

On [Date of incident: 2025-10-06], the production EBS volume was accidentally formatted due to a race condition in the UserData script. This resulted in:
- Complete loss of production database
- Loss of SSL certificates
- Loss of production config

**Lesson Learned**: Always test infrastructure changes with detached volumes first.

## Recovery Procedures

### If Database is Lost

1. **Locate most recent backup**:
   ```bash
   # SSH to server
   ssh BAP

   # Check for local backups
   ls -lah /tmp/*.sqlite /tmp/*.db

   # Check for manual backups
   ls -lah ~/backups/*.sqlite ~/backups/*.db
   ```

2. **Restore database**:
   ```bash
   # Stop application
   cd /opt/basny
   sudo docker-compose -f docker-compose.prod.yml down

   # Copy backup to data volume
   sudo cp /path/to/backup.sqlite /mnt/basny-data/app/database/database.db

   # Fix permissions
   sudo chown 1001:65533 /mnt/basny-data/app/database/database.db
   sudo chmod 644 /mnt/basny-data/app/database/database.db

   # Restart application
   sudo docker-compose -f docker-compose.prod.yml up -d
   ```

3. **Verify data integrity**:
   ```bash
   sqlite3 /mnt/basny-data/app/database/database.db "PRAGMA integrity_check;"
   ```

### If Config is Lost

1. **Check for local backup**:
   - Look in `/tmp/config.production.json` (developer may have saved copy)
   - Check password manager for credentials

2. **Restore config**:
   ```bash
   # Copy config to data volume
   sudo cp /tmp/config.production.json /mnt/basny-data/app/config/config.production.json

   # Fix permissions (CRITICAL - must be 600 owner-only)
   sudo chown 1001:65533 /mnt/basny-data/app/config/config.production.json
   sudo chmod 600 /mnt/basny-data/app/config/config.production.json

   # Restart application
   cd /opt/basny
   sudo docker-compose -f docker-compose.prod.yml restart
   ```

### If SSL Certificates are Lost

1. **Create temporary HTTP-only nginx config**:
   ```bash
   # Use the temp config from /tmp/nginx-temp.conf
   sudo cp /tmp/nginx-temp.conf /mnt/basny-data/nginx/conf.d/default.conf
   sudo docker-compose -f docker-compose.prod.yml restart nginx
   ```

2. **Verify DNS is pointing to current IP**:
   ```bash
   dig bap.basny.org +short
   # Should return: 98.91.62.199
   ```

3. **Re-issue SSL certificates** (after DNS propagates):
   ```bash
   cd /opt/basny
   sudo ./scripts/init-letsencrypt.sh
   ```

### If Entire Volume is Lost

**Prevention**: Before attempting any infrastructure changes that might affect the volume:

1. **Create volume snapshot**:
   ```bash
   aws ec2 create-snapshot \
     --volume-id vol-0aba5b85a1582b2c0 \
     --description "Pre-deployment backup $(date +%Y%m%d-%H%M%S)" \
     --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=BASNY-PreDeployment-Backup},{Key=DoNotDelete,Value=true}]'
   ```

2. **Test changes on new instance first**: Never test with the production volume attached

**Recovery** (if snapshot exists):
1. Create new volume from snapshot
2. Update `PRODUCTION_DATA_VOLUME_ID` in `infrastructure/lib/infrastructure-stack.ts`
3. Deploy CDK stack
4. Verify data integrity

## Pre-Deployment Checklist

Before running ANY `cdk deploy` or infrastructure changes:

- [ ] Create snapshot of production EBS volume
- [ ] Verify production volume is NOT attached to test instance
- [ ] Review UserData script for safety checks
- [ ] Verify RETAIN deletion policies are set
- [ ] Confirm stack termination protection is enabled
- [ ] Have recent database backup available locally

## Emergency Contacts

- **Primary**: Check with development team
- **DNS Management**: Verify with domain administrator
- **AWS Account**: Ensure you have AWS credentials with appropriate permissions

## Backup Strategy

### Recommended Backup Schedule
- **Daily**: Automated database backups to S3
- **Weekly**: Full EBS volume snapshots
- **Pre-deployment**: Manual snapshot before any infrastructure changes

### Creating Manual Backup
```bash
# SSH to server
ssh BAP

# Create database backup
sqlite3 /mnt/basny-data/app/database/database.db ".backup /tmp/backup-$(date +%Y%m%d-%H%M%S).db"

# Copy to local machine
scp BAP:/tmp/backup-*.db ~/backups/

# Create EBS snapshot via AWS CLI
aws ec2 create-snapshot \
  --volume-id vol-0aba5b85a1582b2c0 \
  --description "Manual backup $(date +%Y%m%d-%H%M%S)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=BASNY-Manual-Backup},{Key=DoNotDelete,Value=true}]'
```

## Testing Infrastructure Changes Safely

1. **Create test volume**: Do NOT use production volume
2. **Deploy to separate stack**: Use different stack name
3. **Verify behavior**: Ensure UserData script works correctly
4. **Detach test volume**: Before deploying to production
5. **Deploy to production**: Only after thorough testing

## Additional Notes

- The UserData script (`scripts/ec2-userdata.sh`) will NOT format a volume if it detects existing data
- The initialization flag `/var/lib/cloud/basny-initialized` prevents re-initialization on instance reboot
- All Docker volumes are mounted from the persistent EBS volume, not the root volume
- Root volume (`/dev/xvda`) can be safely replaced - it contains no persistent data
