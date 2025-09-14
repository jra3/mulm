#!/bin/bash
# EC2 UserData script for initial setup of BASNY BAP application
# This script runs once when the EC2 instance is first launched

set -e

# Variables
REPO_URL="https://github.com/jra3/mulm.git"
APP_DIR="/opt/basny"
DATA_DIR="/mnt/basny-data"
DEVICE="/dev/xvdf"  # EBS volume device

# Update system
yum update -y

# Install Docker
yum install -y docker git
systemctl start docker
systemctl enable docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Format and mount EBS volume (only if not already formatted)
if ! file -s $DEVICE | grep -q filesystem; then
    mkfs -t ext4 $DEVICE
fi

# Create mount point and mount volume
mkdir -p $DATA_DIR
mount $DEVICE $DATA_DIR

# Add to fstab for persistent mounting
echo "$DEVICE $DATA_DIR ext4 defaults,nofail 0 2" >> /etc/fstab

# Create required directories
mkdir -p $DATA_DIR/certs
mkdir -p $DATA_DIR/webroot
mkdir -p $DATA_DIR/nginx-logs

# Clone repository
git clone $REPO_URL $APP_DIR
cd $APP_DIR

# Copy production config from S3 or parameter store (customize as needed)
# aws s3 cp s3://basny-config/config.production.json src/config.production.json
# OR
# aws ssm get-parameter --name /basny/production/config --query 'Parameter.Value' --output text > src/config.production.json

# Create systemd service for Docker Compose
cat > /etc/systemd/system/basny-app.service << 'EOF'
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
EOF

# Enable and start the service
systemctl daemon-reload
systemctl enable basny-app.service

# Build and start the application
cd $APP_DIR
docker-compose -f docker-compose.prod.yml build
systemctl start basny-app.service

# Set up log rotation
cat > /etc/logrotate.d/basny << 'EOF'
/mnt/basny-data/nginx-logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 640 root root
    sharedscripts
    postrotate
        docker exec basny-nginx nginx -s reload > /dev/null 2>&1 || true
    endscript
}
EOF

# Install CloudWatch agent (optional)
# wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
# rpm -U ./amazon-cloudwatch-agent.rpm

# Configure CloudWatch agent (customize as needed)
# cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'EOF'
# {
#   "logs": {
#     "logs_collected": {
#       "files": {
#         "collect_list": [
#           {
#             "file_path": "/mnt/basny-data/nginx-logs/access.log",
#             "log_group_name": "/aws/ec2/basny/nginx/access",
#             "log_stream_name": "{instance_id}"
#           },
#           {
#             "file_path": "/mnt/basny-data/nginx-logs/error.log",
#             "log_group_name": "/aws/ec2/basny/nginx/error",
#             "log_stream_name": "{instance_id}"
#           }
#         ]
#       }
#     }
#   }
# }
# EOF

# Start CloudWatch agent
# systemctl start amazon-cloudwatch-agent
# systemctl enable amazon-cloudwatch-agent

# Set up automatic security updates
yum install -y yum-cron
sed -i 's/apply_updates = no/apply_updates = yes/' /etc/yum/yum-cron.conf
systemctl enable yum-cron
systemctl start yum-cron

# Create update script for manual deployments
cat > /usr/local/bin/update-basny.sh << 'EOF'
#!/bin/bash
set -e

echo "Updating BASNY application..."
cd /opt/basny

# Pull latest code
git pull origin main

# Rebuild and restart services
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d

echo "Update complete!"
EOF

chmod +x /usr/local/bin/update-basny.sh

# Output instance information
INSTANCE_ID=$(ec2-metadata --instance-id | cut -d " " -f 2)
PUBLIC_IP=$(ec2-metadata --public-ipv4 | cut -d " " -f 2)

echo "========================================="
echo "BASNY BAP Application Setup Complete!"
echo "Instance ID: $INSTANCE_ID"
echo "Public IP: $PUBLIC_IP"
echo "Application URL: http://$PUBLIC_IP"
echo ""
echo "Next steps:"
echo "1. Update DNS to point to this IP"
echo "2. Run SSL initialization: /opt/basny/scripts/init-letsencrypt.sh"
echo "3. Configure production secrets"
echo "========================================="

# Log the completion
logger "BASNY BAP application setup completed successfully"