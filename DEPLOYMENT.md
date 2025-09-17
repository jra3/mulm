# Deployment Guide

## Production Infrastructure Overview

The BAP application runs on AWS EC2 with Docker Compose, using nginx for SSL termination and Let's Encrypt for certificates.

### Architecture
```
AWS EC2 Instance (t3.micro)
├── Docker Compose Stack
│   ├── basny-nginx (reverse proxy, ports 80/443)
│   ├── basny-app (Node.js application, port 4200 internal)
│   └── basny-certbot (SSL certificate renewal)
├── EBS Volume (20GB at /mnt/basny-data)
│   ├── app/
│   │   ├── config/config.production.json
│   │   └── database/database.db
│   └── nginx/
│       ├── certs/ (SSL certificates)
│       ├── logs/ (access/error logs)
│       └── webroot/ (ACME challenges)
└── Elastic IP: 54.87.111.167
```

### Access Information
- **Production URL**: https://bap.basny.org
- **Server IP**: 54.87.111.167
- **SSH Access**: `ssh BAP` (configured in ~/.ssh/config)
- **Application Path**: `/opt/basny`
- **Data Path**: `/mnt/basny-data`

## Deployment Process

### Quick Deploy (Most Common)
```bash
# Deploy latest code from main branch
ssh BAP "cd /opt/basny && git pull && cp src/config.production.json src/config.json && sudo docker-compose -f docker-compose.prod.yml up -d --build"
```

**Note**: The config.json file is git-ignored and needed for builds. It's automatically copied from config.production.json during deployment.

### Step-by-Step Deployment

1. **Connect to server**
   ```bash
   ssh BAP
   ```

2. **Navigate to application directory**
   ```bash
   cd /opt/basny
   ```

3. **Pull latest code**
   ```bash
   git pull origin main
   ```

4. **Copy production config for build**
   ```bash
   cp src/config.production.json src/config.json
   ```

5. **Rebuild and restart containers**
   ```bash
   sudo docker-compose -f docker-compose.prod.yml up -d --build
   ```

6. **Verify deployment**
   ```bash
   # Check container status
   sudo docker ps

   # View application logs
   sudo docker logs basny-app --tail 50

   # Test health endpoint
   curl http://localhost:4200/health
   ```

## Common Operations

### View Logs
```bash
# Application logs
ssh BAP "sudo docker logs basny-app --tail 100 -f"

# Nginx access logs
ssh BAP "sudo docker logs basny-nginx --tail 100 -f"

# All containers
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml logs --tail 100 -f"
```

### Restart Services
```bash
# Restart all services
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart"

# Restart specific service
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app"
```

### Database Operations
```bash
# Backup database
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.backup /tmp/backup_$(date +%Y%m%d_%H%M%S).db'"

# Download backup to local
scp BAP:/tmp/backup_*.db ./backups/

# Run SQL query
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'SELECT COUNT(*) FROM members;'"
```

### Update Configuration
```bash
# Edit production config
ssh BAP "sudo nano /mnt/basny-data/app/config/config.production.json"

# Restart app after config change
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app"
```

## SSL Certificate Management

### Certificate Status
```bash
# Check certificate expiry
ssh BAP "sudo docker-compose -f /opt/basny/docker-compose.prod.yml exec certbot certbot certificates"

# View certificate details
ssh BAP "sudo openssl x509 -in /mnt/basny-data/nginx/certs/live/bap.basny.org/cert.pem -text -noout | grep -A2 'Validity'"
```

### Manual Renewal (if needed)
```bash
# Force renewal
ssh BAP "sudo docker-compose -f /opt/basny/docker-compose.prod.yml exec certbot certbot renew --force-renewal"

# Reload nginx after renewal
ssh BAP "sudo docker-compose -f /opt/basny/docker-compose.prod.yml exec nginx nginx -s reload"
```

### Auto-Renewal
- Certbot container automatically checks for renewal every 12 hours
- Certificates renew when within 30 days of expiry
- No manual intervention required

## Infrastructure Management

### CDK Deployment (Infrastructure Changes)
```bash
cd infrastructure
npm run cdk deploy
```

### SSH Key Management
```bash
# Retrieve SSH private key from AWS Parameter Store
aws ssm get-parameter \
  --name "/basny/bap/keypair/private" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text > ~/.ssh/basny-bap.pem
chmod 600 ~/.ssh/basny-bap.pem
```

### EC2 Instance Operations
```bash
# Stop instance (data persists on EBS)
aws ec2 stop-instances --instance-ids <instance-id>

# Start instance
aws ec2 start-instances --instance-ids <instance-id>

# Reboot instance
ssh BAP "sudo reboot"
```

## Data Persistence

All persistent data is stored on the EBS volume mounted at `/mnt/basny-data/`:

### Directory Structure
```
/mnt/basny-data/
├── app/
│   ├── config/
│   │   └── config.production.json    # Production configuration
│   └── database/
│       └── database.db               # SQLite database
└── nginx/
    ├── certs/                        # SSL certificates
    │   ├── accounts/                 # Let's Encrypt accounts
    │   ├── archive/                  # Certificate history
    │   ├── live/                     # Current certificates
    │   └── renewal/                  # Renewal configs
    ├── logs/                         # Nginx logs
    └── webroot/                      # ACME challenge files
```

### Backup Strategy
1. **Database**: Daily backups recommended
2. **Certificates**: Backed by Let's Encrypt (can regenerate)
3. **Config**: Version controlled + backup before changes
4. **EBS Snapshots**: Weekly automated snapshots via AWS

## Monitoring

### Health Checks
```bash
# Application health
curl https://bap.basny.org/health

# Container health
ssh BAP "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"

# Disk usage
ssh BAP "df -h /mnt/basny-data"

# Memory usage
ssh BAP "free -h"
```

### CloudWatch Metrics
- CPU utilization
- Network in/out
- Disk read/write ops
- Status checks

## Troubleshooting

### Directory Permissions
The `/opt/basny` directory is owned by `ec2-user` for easier deployment:
```bash
# If needed, fix ownership (one-time setup)
ssh BAP "sudo chown -R ec2-user:ec2-user /opt/basny"
```

### Build Issues
If build fails with missing config.json:
```bash
# Copy production config for build
ssh BAP "cp /opt/basny/src/config.production.json /opt/basny/src/config.json"
```

### Container Issues
```bash
# View all container logs
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml logs"

# Restart stuck container
ssh BAP "sudo docker restart basny-app"

# Rebuild from scratch
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml down && sudo docker-compose -f docker-compose.prod.yml up -d --build"
```

### Database Issues
```bash
# Check database integrity
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'PRAGMA integrity_check;'"

# Vacuum database
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'VACUUM;'"
```

### SSL Issues
```bash
# Test SSL configuration
ssh BAP "sudo docker-compose -f /opt/basny/docker-compose.prod.yml exec nginx nginx -t"

# Check certificate status
ssh BAP "echo | openssl s_client -connect bap.basny.org:443 -servername bap.basny.org 2>/dev/null | openssl x509 -noout -dates"
```

### Disk Space Issues
```bash
# Check disk usage
ssh BAP "du -h --max-depth=1 /mnt/basny-data/ | sort -hr"

# Clean Docker resources
ssh BAP "sudo docker system prune -a --volumes"
```

## Security Notes

1. **SSH Access**: Only via private key (no password auth)
2. **Firewall**: Security group restricts ports 80/443/22 only
3. **SSL**: A+ rating with HSTS and security headers
4. **Updates**: Regular security updates via `yum update`
5. **Secrets**: Never commit to git, use config.production.json
6. **Database**: Read-only + write connections separated
7. **File Permissions**: Application code owned by ec2-user, only Docker operations require sudo

## Rollback Procedure

If deployment fails:

1. **Revert code**
   ```bash
   ssh BAP "cd /opt/basny && git reset --hard HEAD~1"
   ```

2. **Rebuild previous version**
   ```bash
   ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml up -d --build"
   ```

3. **Restore database (if needed)**
   ```bash
   ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.restore /tmp/backup_latest.db'"
   ```

## Contact

- **Infrastructure Issues**: Check CloudWatch alarms
- **Application Errors**: Review `/mnt/basny-data/app/logs/`
- **SSL Problems**: Certbot logs in container
