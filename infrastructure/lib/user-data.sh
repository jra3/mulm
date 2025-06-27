#!/bin/bash
set -e

# Log all output to file
exec > >(tee -a /var/log/user-data.log)
exec 2>&1

echo "Starting provisioning script at $(date)"

# Update system
echo "Updating system packages..."
dnf update -y

# Install git
echo "Installing git..."
dnf install -y git

# Install Node.js (latest LTS)
echo "Installing Node.js..."
curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -
dnf install -y nodejs

# Verify Node.js and npm installation
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# Clone the repository
echo "Cloning mulm repository..."
cd /home/ec2-user
sudo -u ec2-user git clone https://github.com/jra3/mulm.git

# Install Docker
echo "Installing Docker..."
dnf install -y docker
systemctl start docker
systemctl enable docker

# Add ec2-user to docker group
usermod -aG docker ec2-user

# Install Docker Compose
echo "Installing Docker Compose..."
DOCKER_COMPOSE_VERSION="2.24.1"
curl -L "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install Tailscale
echo "Installing Tailscale..."
curl -fsSL https://tailscale.com/install.sh | sh

echo "Tailscale installed successfully."
echo "To configure Tailscale, SSH into the instance and run: sudo tailscale up"

# Create a systemd service to ensure mount persists
cat > /etc/systemd/system/mount-data.service << 'EOF'
[Unit]
Description=Mount EBS Data Volume
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'mkdir -p /mnt/data && mount /dev/xvdf /mnt/data || true'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mount-data.service

echo "Provisioning completed at $(date)"
echo "Note: You may need to log out and back in for docker group membership to take effect"