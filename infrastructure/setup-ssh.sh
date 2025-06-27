#!/bin/bash

# Get stack name from command line or use default
STACK_NAME="${1:-SimpleEc2Stack}"

# Get the key pair ID from the stack outputs
KEY_PAIR_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='KeyPairId'].OutputValue" --output text)

if [ -z "$KEY_PAIR_ID" ]; then
    echo "Error: Could not find KeyPairId in stack outputs"
    exit 1
fi

# Get the region
REGION=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].StackId" --output text | cut -d: -f4)

# Create .ssh directory if it doesn't exist
mkdir -p ~/.ssh

# Retrieve the private key
echo "Retrieving SSH key for $STACK_NAME..."
aws ssm get-parameter --name "/ec2/keypair/$KEY_PAIR_ID" --region "$REGION" --with-decryption --query Parameter.Value --output text > ~/.ssh/"$STACK_NAME".pem

# Set proper permissions
chmod 600 ~/.ssh/"$STACK_NAME".pem

# Get the Elastic IP
ELASTIC_IP=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='ElasticIPAddress'].OutputValue" --output text)

echo "SSH key saved to ~/.ssh/$STACK_NAME.pem"
echo ""
echo "To connect to your instance:"
echo "ssh -i ~/.ssh/$STACK_NAME.pem ec2-user@$ELASTIC_IP"