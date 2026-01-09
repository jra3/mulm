#!/bin/bash
# Deployment script for BASNY BAP application
# This script should be run on your local machine to deploy updates to the EC2 instance

set -e

# Configuration
INSTANCE_IP="${INSTANCE_IP:-}"  # Set via environment variable or update here
SSH_KEY="${SSH_KEY:-~/.ssh/id_rsa}"  # Path to your SSH key
BRANCH="${BRANCH:-main}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_error() {
    echo -e "${RED}Error: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Check if instance IP is set
if [ -z "$INSTANCE_IP" ]; then
    print_error "INSTANCE_IP is not set. Please set it as an environment variable or update this script."
    echo "Example: export INSTANCE_IP=54.123.45.67"
    exit 1
fi

# Check if SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    print_error "SSH key not found at $SSH_KEY"
    exit 1
fi

print_info "Deploying to $INSTANCE_IP..."

# Test SSH connection
print_info "Testing SSH connection..."
if ! ssh -o ConnectTimeout=5 -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" "echo 'SSH connection successful'" > /dev/null 2>&1; then
    print_error "Cannot connect to instance. Check your SSH key and instance IP."
    exit 1
fi
print_success "SSH connection established"

# Create deployment script on remote
print_info "Creating deployment script on remote..."
ssh -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" << 'REMOTE_SCRIPT'
cat > /tmp/deploy-remote.sh << 'EOF'
#!/bin/bash
set -e

cd /opt/basny

echo "→ Pulling latest code from git..."
sudo git fetch origin
sudo git reset --hard origin/main

echo "→ Cleaning old Docker images to free disk space..."
sudo docker image prune -af --filter "until=24h"

echo "→ Building Docker images..."
sudo docker-compose -f docker-compose.prod.yml build

echo "→ Stopping current containers..."
sudo docker-compose -f docker-compose.prod.yml down

echo "→ Starting new containers..."
sudo docker-compose -f docker-compose.prod.yml up -d

echo "→ Cleaning up unused images..."
sudo docker image prune -f

echo "→ Checking container status..."
sudo docker-compose -f docker-compose.prod.yml ps

echo "→ Waiting for health check..."
sleep 5
if curl -f http://localhost:4200/health > /dev/null 2>&1; then
    echo "✓ Application is healthy"
else
    echo "⚠ Health check failed - check logs with: docker-compose logs app"
fi

echo "✓ Deployment complete!"
EOF

chmod +x /tmp/deploy-remote.sh
REMOTE_SCRIPT

# Execute deployment
print_info "Running deployment..."
ssh -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" "sudo /tmp/deploy-remote.sh"

# Clean up
ssh -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" "rm /tmp/deploy-remote.sh"

print_success "Deployment successful!"
print_info "Application URL: https://bap.basny.org"

# Show logs option
echo ""
read -p "Would you like to view the application logs? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "Showing last 50 lines of logs (Ctrl+C to exit)..."
    ssh -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" "sudo docker-compose -f /opt/basny/docker-compose.prod.yml logs --tail=50 -f app"
fi