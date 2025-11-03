#!/bin/bash
set -euo pipefail

# validate-cdk-changes.sh
# Pre-deployment validation script for CDK infrastructure changes
# Checks for dangerous changes that could recreate the EC2 instance or disassociate critical resources

echo "🔍 CDK Pre-Deployment Validation"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
AWS_PROFILE="${AWS_PROFILE:-basny}"
INSTANCE_ID="i-04344678eca4d35cc"
EIP_ALLOCATION="eipalloc-01f29c26363e0465a"
STACK_NAME="InfrastructureStack"

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Please install it first.${NC}"
    exit 1
fi

# Check if CDK is available
if ! command -v cdk &> /dev/null; then
    echo -e "${RED}❌ AWS CDK not found. Please install it first.${NC}"
    exit 1
fi

# Verify AWS credentials
echo -e "${BLUE}Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity --profile "$AWS_PROFILE" &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not valid for profile: $AWS_PROFILE${NC}"
    exit 1
fi
echo -e "${GREEN}✓ AWS credentials valid${NC}"
echo ""

# Check production instance status
echo -e "${BLUE}Checking production instance status...${NC}"
INSTANCE_STATE=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --profile "$AWS_PROFILE" \
    --query 'Reservations[0].Instances[0].State.Name' \
    --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$INSTANCE_STATE" = "NOT_FOUND" ]; then
    echo -e "${RED}❌ Production instance $INSTANCE_ID not found!${NC}"
    exit 1
fi

if [ "$INSTANCE_STATE" != "running" ]; then
    echo -e "${YELLOW}⚠️  Instance is in state: $INSTANCE_STATE (not running)${NC}"
    echo -e "${YELLOW}   Deploying CDK changes while instance is stopped may cause issues.${NC}"
    read -p "Continue anyway? (yes/no): " CONTINUE
    if [ "$CONTINUE" != "yes" ]; then
        echo -e "${RED}Deployment cancelled.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Instance $INSTANCE_ID is running${NC}"
fi
echo ""

# Check EIP association
echo -e "${BLUE}Checking Elastic IP association...${NC}"
EIP_INSTANCE=$(aws ec2 describe-addresses \
    --allocation-ids "$EIP_ALLOCATION" \
    --profile "$AWS_PROFILE" \
    --query 'Addresses[0].InstanceId' \
    --output text 2>/dev/null || echo "NONE")

if [ "$EIP_INSTANCE" != "$INSTANCE_ID" ]; then
    echo -e "${RED}❌ Elastic IP not associated with production instance!${NC}"
    echo -e "${RED}   Expected: $INSTANCE_ID, Found: $EIP_INSTANCE${NC}"
    echo -e "${YELLOW}   You may need to re-associate it manually.${NC}"
    read -p "Continue anyway? (yes/no): " CONTINUE
    if [ "$CONTINUE" != "yes" ]; then
        echo -e "${RED}Deployment cancelled.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Elastic IP correctly associated${NC}"
fi
echo ""

# Run CDK diff
echo -e "${BLUE}Running CDK diff to detect changes...${NC}"
echo ""

# Capture diff output
DIFF_OUTPUT=$(cd infrastructure && npx cdk diff "$STACK_NAME" 2>&1 || true)

# Check for dangerous patterns in the diff
DANGEROUS_CHANGES=0

# Check for instance replacement
if echo "$DIFF_OUTPUT" | grep -q "AWS::EC2::Instance.*replacement"; then
    echo -e "${RED}❌ DANGER: EC2 Instance replacement detected!${NC}"
    echo -e "${RED}   This would create a new instance and could cause data loss.${NC}"
    DANGEROUS_CHANGES=1
fi

if echo "$DIFF_OUTPUT" | grep -q "\[-\] AWS::EC2::Instance"; then
    echo -e "${RED}❌ DANGER: EC2 Instance deletion detected!${NC}"
    DANGEROUS_CHANGES=1
fi

# Check for volume changes
if echo "$DIFF_OUTPUT" | grep -q "VolumeAttachment.*replacement\|VolumeAttachment.*\[-\]"; then
    echo -e "${RED}❌ DANGER: Volume attachment changes detected!${NC}"
    echo -e "${RED}   This could detach your data volume.${NC}"
    DANGEROUS_CHANGES=1
fi

# Check for EIP changes
if echo "$DIFF_OUTPUT" | grep -q "EIPAssociation.*replacement\|EIPAssociation.*\[-\]"; then
    echo -e "${YELLOW}⚠️  WARNING: EIP association changes detected!${NC}"
    echo -e "${YELLOW}   This could cause brief downtime (1-2 minutes).${NC}"
fi

# Check for machine image changes
if echo "$DIFF_OUTPUT" | grep -q "ImageId"; then
    echo -e "${RED}❌ DANGER: AMI/Machine Image change detected!${NC}"
    echo -e "${RED}   This would create a new instance.${NC}"
    DANGEROUS_CHANGES=1
fi

# Check for instance type changes
if echo "$DIFF_OUTPUT" | grep -q "InstanceType"; then
    echo -e "${RED}❌ DANGER: Instance type change detected!${NC}"
    echo -e "${RED}   This requires instance stop/start and may cause replacement.${NC}"
    DANGEROUS_CHANGES=1
fi

# Show the diff output
echo ""
echo -e "${BLUE}===== CDK Diff Output =====${NC}"
echo "$DIFF_OUTPUT"
echo -e "${BLUE}===========================${NC}"
echo ""

# Final safety check
if [ $DANGEROUS_CHANGES -eq 1 ]; then
    echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ⚠️  DANGEROUS CHANGES DETECTED - DEPLOYMENT BLOCKED ⚠️   ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${RED}The proposed changes would recreate or delete critical resources.${NC}"
    echo -e "${RED}This could cause:${NC}"
    echo -e "${RED}  • Data loss${NC}"
    echo -e "${RED}  • Extended downtime${NC}"
    echo -e "${RED}  • Service disruption${NC}"
    echo ""
    echo -e "${YELLOW}Recommended actions:${NC}"
    echo -e "${YELLOW}  1. Review the changes in infrastructure/lib/infrastructure-stack.ts${NC}"
    echo -e "${YELLOW}  2. Consider using AWS CLI for one-off changes instead${NC}"
    echo -e "${YELLOW}  3. Consult infrastructure/CDK_SAFETY.md for guidance${NC}"
    echo ""
    echo -e "${YELLOW}If you're ABSOLUTELY CERTAIN you want to proceed:${NC}"
    echo -e "${YELLOW}  cd infrastructure && npx cdk deploy${NC}"
    echo ""
    exit 1
fi

# Check if there are any changes at all
if echo "$DIFF_OUTPUT" | grep -q "There were no differences"; then
    echo -e "${GREEN}✓ No infrastructure changes detected.${NC}"
    echo -e "${GREEN}  Stack is already up to date.${NC}"
    echo ""
    exit 0
fi

# If we got here, changes look safe
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✓ Changes appear safe - Ready to deploy             ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Summary of changes:${NC}"

# Count change types
ADDS=$(echo "$DIFF_OUTPUT" | grep -c "^\[+\]" || true)
MODS=$(echo "$DIFF_OUTPUT" | grep -c "^\[~\]" || true)
DELS=$(echo "$DIFF_OUTPUT" | grep -c "^\[-\]" || true)

echo -e "  ${GREEN}Additions: $ADDS${NC}"
echo -e "  ${BLUE}Modifications: $MODS${NC}"
echo -e "  ${YELLOW}Deletions: $DELS${NC}"
echo ""

# Ask for confirmation
read -p "Deploy these changes? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo -e "${YELLOW}Deployment cancelled.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Proceeding with deployment...${NC}"
echo ""

# Run the actual deployment
cd infrastructure
npx cdk deploy "$STACK_NAME" --require-approval never

# Verify instance is still running after deployment
echo ""
echo -e "${BLUE}Verifying instance status after deployment...${NC}"
sleep 5  # Give AWS a moment to update

INSTANCE_STATE_AFTER=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --profile "$AWS_PROFILE" \
    --query 'Reservations[0].Instances[0].State.Name' \
    --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$INSTANCE_STATE_AFTER" = "running" ]; then
    echo -e "${GREEN}✓ Instance still running after deployment${NC}"
else
    echo -e "${YELLOW}⚠️  Instance state: $INSTANCE_STATE_AFTER${NC}"
    echo -e "${YELLOW}   Check the instance in AWS Console if unexpected.${NC}"
fi

# Check EIP is still associated
EIP_INSTANCE_AFTER=$(aws ec2 describe-addresses \
    --allocation-ids "$EIP_ALLOCATION" \
    --profile "$AWS_PROFILE" \
    --query 'Addresses[0].InstanceId' \
    --output text 2>/dev/null || echo "NONE")

if [ "$EIP_INSTANCE_AFTER" = "$INSTANCE_ID" ]; then
    echo -e "${GREEN}✓ Elastic IP still correctly associated${NC}"
else
    echo -e "${RED}❌ Elastic IP association lost!${NC}"
    echo -e "${YELLOW}   Re-associating EIP...${NC}"
    aws ec2 associate-address \
        --instance-id "$INSTANCE_ID" \
        --allocation-id "$EIP_ALLOCATION" \
        --profile "$AWS_PROFILE"
    echo -e "${GREEN}✓ Elastic IP re-associated${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Deployment completed successfully                ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo -e "  1. Verify site is accessible: ${BLUE}https://bap.basny.org${NC}"
echo -e "  2. Check application logs if needed"
echo -e "  3. Monitor for any issues"
echo ""
