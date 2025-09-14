#!/bin/bash
# Test script to verify BASNY deployment before DNS is configured

set -e

INSTANCE_IP="54.87.111.167"
SSH_KEY="${SSH_KEY:-~/.ssh/id_rsa}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "Testing BASNY deployment at ${INSTANCE_IP}"
echo "========================================="
echo ""

# Test 1: Check if instance is reachable
echo -n "1. Testing SSH connectivity... "
if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" "echo 'connected'" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "   Cannot connect via SSH. Check your SSH key or security groups."
    echo "   Try: ssh -i $SSH_KEY ec2-user@$INSTANCE_IP"
    exit 1
fi

# Test 2: Check if Docker is running
echo -n "2. Checking Docker service... "
if ssh -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" "sudo docker --version" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "   Docker is not installed or not running"
fi

# Test 3: Check if containers are running
echo -n "3. Checking Docker containers... "
CONTAINERS=$(ssh -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" "sudo docker ps --format 'table {{.Names}}\t{{.Status}}' 2>/dev/null || echo 'none'")
if [[ "$CONTAINERS" != "none" ]] && [[ "$CONTAINERS" != "" ]]; then
    echo -e "${GREEN}✓${NC}"
    echo ""
    echo "   Running containers:"
    echo "$CONTAINERS" | sed 's/^/   /'
else
    echo -e "${YELLOW}⚠${NC}"
    echo "   No containers running. May need to start them."
fi

# Test 4: Check HTTP access
echo -n "4. Testing HTTP access on port 80... "
if curl -s -o /dev/null -w "%{http_code}" "http://${INSTANCE_IP}" | grep -q "200\|301\|302"; then
    echo -e "${GREEN}✓${NC}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://${INSTANCE_IP}")
    echo "   HTTP response code: $HTTP_CODE"
else
    echo -e "${YELLOW}⚠${NC}"
    echo "   HTTP not responding. This is expected if nginx isn't running yet."
fi

# Test 5: Check health endpoint
echo -n "5. Testing application health endpoint... "
if curl -sf "http://${INSTANCE_IP}/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
    HEALTH=$(curl -s "http://${INSTANCE_IP}/health")
    echo "   Health check response: $HEALTH"
else
    echo -e "${YELLOW}⚠${NC}"
    echo "   Health endpoint not accessible yet"
fi

# Test 6: Check if app directory exists
echo -n "6. Checking application directory... "
if ssh -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" "test -d /opt/basny" 2>/dev/null; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${YELLOW}⚠${NC}"
    echo "   Application not yet deployed to /opt/basny"
fi

# Test 7: Check EBS mount
echo -n "7. Checking data volume mount... "
if ssh -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" "test -d /mnt/basny-data && df -h | grep -q /mnt/basny-data" 2>/dev/null; then
    echo -e "${GREEN}✓${NC}"
    DISK_USAGE=$(ssh -i "$SSH_KEY" ec2-user@"$INSTANCE_IP" "df -h /mnt/basny-data | tail -1")
    echo "   Data volume: $DISK_USAGE"
else
    echo -e "${RED}✗${NC}"
    echo "   Data volume not mounted at /mnt/basny-data"
fi

echo ""
echo "========================================="
echo "Quick fixes if needed:"
echo "========================================="
echo ""
echo "If containers aren't running, SSH in and run:"
echo "  ssh -i $SSH_KEY ec2-user@$INSTANCE_IP"
echo "  cd /opt/basny"
echo "  sudo docker-compose -f docker-compose.prod.yml up -d"
echo ""
echo "To check logs:"
echo "  sudo docker-compose -f docker-compose.prod.yml logs"
echo ""
echo "Once running, you can access the app at:"
echo "  http://${INSTANCE_IP}"
echo ""
echo "The nginx config currently expects bap.basny.org, so you may need to"
echo "temporarily modify it to accept the IP address for testing."