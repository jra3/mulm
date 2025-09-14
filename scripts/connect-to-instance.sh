#!/bin/bash
# Connect to BASNY EC2 instance using different methods

INSTANCE_ID="i-085782c07eb6a4687"
INSTANCE_IP="54.87.111.167"
PROFILE="basny"

echo "========================================="
echo "Options to connect to your EC2 instance:"
echo "========================================="
echo ""

echo "Option 1: AWS Systems Manager Session Manager (Recommended)"
echo "------------------------------------------------------------"
echo "First, install the Session Manager plugin:"
echo ""
echo "On macOS:"
echo "  curl 'https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac/sessionmanager-bundle.zip' -o 'sessionmanager-bundle.zip'"
echo "  unzip sessionmanager-bundle.zip"
echo "  sudo ./sessionmanager-bundle/install -i /usr/local/sessionmanagerplugin -b /usr/local/bin/session-manager-plugin"
echo ""
echo "Then connect:"
echo "  aws ssm start-session --profile $PROFILE --target $INSTANCE_ID"
echo ""
echo "Once connected, switch to ec2-user:"
echo "  sudo su - ec2-user"
echo ""

echo "Option 2: EC2 Instance Connect (One-time SSH)"
echo "----------------------------------------------"
echo "This sends a temporary SSH key (valid for 60 seconds):"
echo ""
echo "  aws ec2-instance-connect send-ssh-public-key \\"
echo "    --profile $PROFILE \\"
echo "    --instance-id $INSTANCE_ID \\"
echo "    --instance-os-user ec2-user \\"
echo "    --ssh-public-key file://~/.ssh/id_rsa.pub"
echo ""
echo "Then quickly SSH in:"
echo "  ssh ec2-user@$INSTANCE_IP"
echo ""

echo "Option 3: Add permanent SSH key"
echo "--------------------------------"
echo "To add a permanent SSH key, update the CDK stack to include a keyName"
echo "or manually add your public key to the instance."
echo ""

# Try EC2 Instance Connect if public key exists
if [ -f ~/.ssh/id_rsa.pub ]; then
    echo "========================================="
    echo "Attempting EC2 Instance Connect..."
    echo "========================================="
    
    # Send temporary SSH key
    aws ec2-instance-connect send-ssh-public-key \
        --profile $PROFILE \
        --instance-id $INSTANCE_ID \
        --instance-os-user ec2-user \
        --ssh-public-key file://~/.ssh/id_rsa.pub \
        --availability-zone us-east-1a 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✓ Temporary SSH key sent successfully!"
        echo ""
        echo "You have 60 seconds to connect:"
        echo "  ssh ec2-user@$INSTANCE_IP"
    else
        echo "⚠ Could not send SSH key via Instance Connect"
        echo "Try using Session Manager instead (Option 1)"
    fi
fi