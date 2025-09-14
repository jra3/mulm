# Redeploying CDK Stack with SSH Key Pair

## ⚠️ IMPORTANT: Your Elastic IP will be preserved!

The Elastic IP (54.87.111.167) has been separated from the instance, so it will persist even when the instance is replaced.

## Steps to Redeploy:

### 1. Build the CDK stack
```bash
cd infrastructure
npm run build
```

### 2. Preview changes
```bash
npm run cdk diff -- --profile basny
```

You should see:
- EC2 instance will be REPLACED (because of the new key pair)
- Elastic IP will remain UNCHANGED
- New KeyPair resource will be ADDED

### 3. Deploy the updated stack
```bash
npm run cdk deploy -- --profile basny
```

**Note**: This will terminate your current instance and create a new one. The Elastic IP will automatically attach to the new instance.

### 4. Retrieve your private key
After deployment completes (about 5-10 minutes), get your SSH key:

```bash
./scripts/get-private-key.sh
```

This will:
- Retrieve the private key from AWS Systems Manager
- Save it to `~/.ssh/basny-ec2-keypair.pem`
- Set correct permissions (400)

### 5. SSH to your instance
```bash
ssh -i ~/.ssh/basny-ec2-keypair.pem ec2-user@54.87.111.167
```

### 6. Redeploy the application
Since this is a new instance, you'll need to:

```bash
# SSH into the instance
ssh -i ~/.ssh/basny-ec2-keypair.pem ec2-user@54.87.111.167

# Check if UserData script completed
ls -la /opt/basny

# If not, manually deploy:
sudo git clone https://github.com/jra3/mulm.git /opt/basny
cd /opt/basny

# Copy your production config
sudo nano src/config.production.json
# Paste your configuration

# Start Docker Compose
sudo docker-compose -f docker-compose.prod.yml up -d

# Check status
sudo docker-compose -f docker-compose.prod.yml ps
```

## What's Changed:

1. **Key Pair**: CDK now creates a key pair automatically
2. **Elastic IP**: Now created separately and associated with the instance (survives instance replacement)
3. **Private Key Storage**: Automatically stored in AWS Systems Manager Parameter Store
4. **Retrieval Script**: `get-private-key.sh` retrieves and saves the key locally

## Benefits:

- ✅ SSH access always available
- ✅ Elastic IP preserved across redeployments
- ✅ Private key securely stored in AWS
- ✅ No manual key creation needed

## Troubleshooting:

If the key retrieval fails:
1. Wait 30 seconds after deployment (key storage can take a moment)
2. Check the CloudFormation outputs for the KeyPairId
3. Manually retrieve from Parameter Store:
   ```bash
   aws ssm get-parameter \
     --profile basny \
     --name "/ec2/keypair/YOUR_KEY_PAIR_ID" \
     --with-decryption \
     --query 'Parameter.Value' \
     --output text > ~/.ssh/basny-ec2-keypair.pem
   chmod 400 ~/.ssh/basny-ec2-keypair.pem
   ```

## DNS Note:
The Elastic IP (54.87.111.167) remains the same, so DNS doesn't need to be updated!