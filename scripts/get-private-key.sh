#!/bin/bash
# Script to retrieve the private key after CDK deployment
# AWS stores the private key in Systems Manager Parameter Store

set -e

PROFILE="${AWS_PROFILE:-basny}"
KEY_NAME="basny-bap-keypair-v2"
KEY_FILE="$HOME/.ssh/basny-bap-keypair.pem"

echo "========================================="
echo "Retrieving private key for EC2 instance"
echo "========================================="
echo ""

# Get the parameter name from CloudFormation outputs
echo "Getting parameter name from CloudFormation stack..."
STACK_NAME="InfrastructureStack"

# Try to get the new PrivateKeyParameterName output first
PARAMETER_NAME=$(aws cloudformation describe-stacks \
    --profile $PROFILE \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='PrivateKeyParameterName'].OutputValue" \
    --output text 2>/dev/null)

if [ -z "$PARAMETER_NAME" ] || [ "$PARAMETER_NAME" == "None" ]; then
    # Fallback to the old method using KeyPairId
    echo "Using KeyPairId method..."
    KEY_PAIR_ID=$(aws cloudformation describe-stacks \
        --profile $PROFILE \
        --stack-name $STACK_NAME \
        --query "Stacks[0].Outputs[?OutputKey=='KeyPairId'].OutputValue" \
        --output text 2>/dev/null)
    
    if [ -z "$KEY_PAIR_ID" ]; then
        echo "Error: Could not find key information in stack outputs"
        echo "Make sure the CDK stack has been deployed"
        exit 1
    fi
    PARAMETER_NAME="/ec2/keypair/$KEY_PAIR_ID"
fi

echo "Parameter name: $PARAMETER_NAME"

# Retrieve private key from Systems Manager Parameter Store
echo "Retrieving private key from Parameter Store..."

PRIVATE_KEY=$(aws ssm get-parameter \
    --profile $PROFILE \
    --name "$PARAMETER_NAME" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text 2>/dev/null)

if [ -z "$PRIVATE_KEY" ]; then
    echo "Error: Could not retrieve private key from Parameter Store"
    echo "Parameter name: $PARAMETER_NAME"
    echo ""
    echo "The private key should be automatically stored when the key pair is created."
    echo "If this is a new deployment, wait a few seconds and try again."
    exit 1
fi

# Save the private key to file
echo "Saving private key to $KEY_FILE..."
echo "$PRIVATE_KEY" > "$KEY_FILE"
chmod 400 "$KEY_FILE"

echo ""
echo "✅ Success! Private key saved to: $KEY_FILE"
echo ""
echo "You can now SSH to your instance with:"
echo "  ssh -i $KEY_FILE ec2-user@<INSTANCE_IP>"
echo ""
echo "Or use the connect script:"
echo "  ./scripts/connect-to-instance.sh"

# Get the current Elastic IP
ELASTIC_IP=$(aws ec2 describe-addresses \
    --profile $PROFILE \
    --filters "Name=tag:Name,Values=BASNY-BAP-ElasticIP" \
    --query "Addresses[0].PublicIp" \
    --output text 2>/dev/null)

if [ ! -z "$ELASTIC_IP" ] && [ "$ELASTIC_IP" != "None" ]; then
    echo ""
    echo "Your instance IP: $ELASTIC_IP"
    echo "Connect with: ssh -i $KEY_FILE ec2-user@$ELASTIC_IP"
fi