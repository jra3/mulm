# Initial Setup Instructions for BASNY BAP on EC2

Your EC2 instance is running at: **54.87.111.167**

## Step 1: SSH into your instance

```bash
ssh -i ~/.ssh/your-key.pem ec2-user@54.87.111.167
```

If you get a permission denied error, try:
```bash
ssh -o StrictHostKeyChecking=no ec2-user@54.87.111.167
```

## Step 2: Check if the application was auto-deployed

The UserData script should have set everything up. Check:

```bash
# Check if app directory exists
ls -la /opt/basny

# Check if Docker is running
sudo docker --version
sudo systemctl status docker

# Check if containers are running
sudo docker ps
```

## Step 3: If containers aren't running, deploy manually

```bash
# Clone the repository
sudo git clone https://github.com/jra3/mulm.git /opt/basny
cd /opt/basny

# Copy the production config (you'll need to create this)
sudo nano src/config.production.json
# Paste your config and save

# Build and start containers
sudo docker-compose -f docker-compose.prod.yml build
sudo docker-compose -f docker-compose.prod.yml up -d

# Check if they're running
sudo docker-compose -f docker-compose.prod.yml ps
```

## Step 4: Test via IP address

Since DNS isn't configured yet, I've created an nginx config that accepts IP-based requests.

1. First, push the new nginx config to your server:
```bash
# From your local machine
scp -i ~/.ssh/your-key.pem nginx/conf.d/ip-access.conf ec2-user@54.87.111.167:/tmp/

# On the server
sudo cp /tmp/ip-access.conf /opt/basny/nginx/conf.d/
sudo docker-compose -f /opt/basny/docker-compose.prod.yml restart nginx
```

2. Test the application:
```bash
# From your local machine
curl http://54.87.111.167/health

# Or open in browser:
# http://54.87.111.167
```

## Step 5: Configure production settings

Create your production config file:

```bash
sudo nano /opt/basny/src/config.production.json
```

Add your configuration (example):
```json
{
    "databaseFile": "/mnt/data/database.db",
    "domain": "bap.basny.org",
    "googleClientId": "YOUR_GOOGLE_CLIENT_ID",
    "googleClientSecret": "YOUR_GOOGLE_SECRET",
    "adminsEmail": "basny-admins@porcnick.com",
    "fromEmail": "bap@basny.org",
    "smtpPassword": "YOUR_SMTP_PASSWORD",
    "smtpHost": "mail.basny.org",
    "smtpPort": 465,
    "smtpSecure": true,
    "s3AccessKeyId": "YOUR_S3_ACCESS_KEY",
    "s3Secret": "YOUR_S3_SECRET",
    "s3Url": "YOUR_S3_URL",
    "s3Bucket": "basny-bap-data",
    "r2PublicUrl": "YOUR_R2_PUBLIC_URL"
}
```

Then restart the app:
```bash
sudo docker-compose -f /opt/basny/docker-compose.prod.yml restart app
```

## Step 6: Set up systemd service (if not already done)

```bash
# Check if service exists
sudo systemctl status basny-app

# If not, create it:
sudo nano /etc/systemd/system/basny-app.service
```

Paste this content:
```ini
[Unit]
Description=BASNY BAP Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/basny
ExecStart=/usr/local/bin/docker-compose -f docker-compose.prod.yml up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.prod.yml down
ExecReload=/usr/local/bin/docker-compose -f docker-compose.prod.yml restart
StandardOutput=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable basny-app
sudo systemctl start basny-app
```

## Step 7: Check logs if something goes wrong

```bash
# All logs
sudo docker-compose -f /opt/basny/docker-compose.prod.yml logs

# Just app logs
sudo docker-compose -f /opt/basny/docker-compose.prod.yml logs app

# Follow logs in real-time
sudo docker-compose -f /opt/basny/docker-compose.prod.yml logs -f app
```

## Step 8: Once DNS is configured

After DNS points to 54.87.111.167:

1. Remove the temporary IP config:
```bash
sudo rm /opt/basny/nginx/conf.d/ip-access.conf
sudo docker-compose -f /opt/basny/docker-compose.prod.yml restart nginx
```

2. Initialize SSL certificates:
```bash
sudo /opt/basny/scripts/init-letsencrypt.sh
```

## Troubleshooting

### Port 80 connection refused
- Check security groups in AWS console
- Ensure nginx is running: `sudo docker ps | grep nginx`

### Application not responding
- Check app logs: `sudo docker-compose logs app`
- Verify config file: `sudo cat /opt/basny/src/config.production.json`
- Check database exists: `sudo ls -la /mnt/basny-data/`

### Docker not installed
Run the user data script manually:
```bash
sudo yum update -y
sudo yum install -y docker git
sudo systemctl start docker
sudo systemctl enable docker
# Install docker-compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

## Access URLs

- **Before DNS**: http://54.87.111.167
- **After DNS**: https://bap.basny.org