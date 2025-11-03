#!/bin/bash
# Install and configure Tailscale on Amazon Linux 2023
# Usage: ./install-tailscale.sh [--auth-key YOUR_AUTH_KEY]
#
# This script:
# 1. Installs Tailscale on Amazon Linux 2023
# 2. Enables SSH via Tailscale
# 3. Optionally authenticates with an auth key (for automation)
#
# For manual setup, run without --auth-key and authenticate via browser

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
AUTH_KEY=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --auth-key)
      AUTH_KEY="$2"
      shift 2
      ;;
    *)
      echo -e "${RED}Unknown argument: $1${NC}"
      echo "Usage: $0 [--auth-key YOUR_AUTH_KEY]"
      exit 1
      ;;
  esac
done

echo -e "${GREEN}=== Installing Tailscale on Amazon Linux 2023 ===${NC}"

# Check if running as root or with sudo
if [[ $EUID -ne 0 ]]; then
   echo -e "${YELLOW}This script requires root privileges. Re-running with sudo...${NC}"
   exec sudo "$0" "$@"
fi

# Add Tailscale repository
echo -e "${GREEN}Adding Tailscale repository...${NC}"
dnf config-manager --add-repo https://pkgs.tailscale.com/stable/amazon-linux/2023/tailscale.repo

# Install Tailscale
echo -e "${GREEN}Installing Tailscale...${NC}"
dnf install -y tailscale

# Enable and start Tailscale daemon
echo -e "${GREEN}Enabling Tailscale service...${NC}"
systemctl enable --now tailscaled

# Wait for daemon to be ready
sleep 2

# Authenticate
if [[ -n "$AUTH_KEY" ]]; then
  echo -e "${GREEN}Authenticating with auth key...${NC}"
  tailscale up --auth-key="$AUTH_KEY" --ssh
else
  echo -e "${YELLOW}Starting Tailscale (manual authentication required)...${NC}"
  echo -e "${YELLOW}Follow the URL that appears to authenticate this device.${NC}"
  tailscale up --ssh
fi

# Verify status
echo ""
echo -e "${GREEN}=== Tailscale Status ===${NC}"
tailscale status

echo ""
echo -e "${GREEN}=== Tailscale IP Addresses ===${NC}"
TAILSCALE_IP=$(tailscale ip -4)
echo "IPv4: $TAILSCALE_IP"

echo ""
echo -e "${GREEN}✅ Tailscale installation complete!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Test SSH via Tailscale: ssh ec2-user@$TAILSCALE_IP"
echo "2. Update your ~/.ssh/config to use the Tailscale IP"
echo "3. Verify SSH works via Tailscale before closing port 22 to the public"
echo ""
echo -e "${YELLOW}To get auth keys for automation:${NC}"
echo "Visit: https://login.tailscale.com/admin/settings/keys"
echo ""
