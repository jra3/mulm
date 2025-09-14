# BASNY BAP Infrastructure Deployment Guide

## Prerequisites

1. AWS CLI configured with BASNY profile:
```bash
aws configure --profile basny
```

2. AWS CDK CLI installed:
```bash
npm install -g aws-cdk
```

3. Node.js dependencies installed:
```bash
cd infrastructure
npm install
```

## Initial Deployment

### 1. Bootstrap CDK (first time only)
```bash
cd infrastructure
npm run cdk bootstrap -- --profile basny
```

### 2. Deploy the stack
```bash
npm run cdk deploy -- --profile basny
```

The deployment will create:
- VPC with public subnet
- EC2 t3.micro instance 
- 8GB root volume + 8GB data volume (persistent)
- Elastic IP for static address
- Security groups (ports 22, 80, 443)
- IAM role with necessary permissions
- CloudWatch log groups

### 3. Note the outputs
After deployment, CDK will output:
- **InstanceId**: EC2 instance identifier
- **PublicIP**: Elastic IP address
- **SSHCommand**: Command to SSH into instance
- **ApplicationURL**: Initial HTTP URL

### 4. Update DNS
Point `bap.basny.org` A record to the Elastic IP address.

### 5. Configure the application
SSH into the instance:
```bash
ssh -i ~/.ssh/your-key.pem ec2-user@<ELASTIC_IP>
```

Add production configuration:
```bash
sudo vi /opt/basny/src/config.production.json
# Add your production configuration
```

### 6. Initialize SSL certificates
Once DNS is propagated:
```bash
sudo /opt/basny/scripts/init-letsencrypt.sh
```

## Updating the Application

Use the deployment script from your local machine:
```bash
export INSTANCE_IP=<ELASTIC_IP>
./scripts/deploy.sh
```

Or manually on the server:
```bash
sudo /usr/local/bin/update-basny.sh
```

## Database Management

### Backup database
```bash
ssh ec2-user@<ELASTIC_IP> "sudo /opt/basny/scripts/backup-database.sh"
```

### Restore database
```bash
ssh ec2-user@<ELASTIC_IP> "sudo /opt/basny/scripts/restore-database.sh <backup-file>"
```

## Monitoring

### View logs
```bash
# Application logs
ssh ec2-user@<ELASTIC_IP> "sudo docker-compose -f /opt/basny/docker-compose.prod.yml logs -f app"

# Nginx logs
ssh ec2-user@<ELASTIC_IP> "sudo docker-compose -f /opt/basny/docker-compose.prod.yml logs -f nginx"
```

### Check health
```bash
curl https://bap.basny.org/health
```

## Troubleshooting

### Restart services
```bash
ssh ec2-user@<ELASTIC_IP> "sudo systemctl restart basny-app"
```

### Check service status
```bash
ssh ec2-user@<ELASTIC_IP> "sudo systemctl status basny-app"
```

### View container status
```bash
ssh ec2-user@<ELASTIC_IP> "sudo docker-compose -f /opt/basny/docker-compose.prod.yml ps"
```

## Infrastructure Updates

To update the infrastructure:
```bash
cd infrastructure
npm run cdk diff -- --profile basny  # Preview changes
npm run cdk deploy -- --profile basny # Apply changes
```

## Destroy Infrastructure

⚠️ **WARNING**: This will delete all resources including data!

```bash
cd infrastructure
npm run cdk destroy -- --profile basny
```

## Cost Optimization

Current setup costs (approximate):
- EC2 t3.micro: ~$8/month
- EBS storage (16GB): ~$2/month
- Elastic IP: Free while attached
- Data transfer: Variable

Total: ~$10-15/month

## Security Notes

1. **SSH Access**: Restrict security group to your IP:
   - Update the security group in AWS Console
   - Or modify CDK stack to use `ec2.Peer.ipv4('YOUR_IP/32')`

2. **Secrets Management**: Consider using AWS Secrets Manager or Parameter Store for sensitive configuration instead of config files.

3. **Backups**: Set up automated backups to S3 by uncommenting S3 sections in backup script.

4. **Updates**: Enable automatic security updates (already configured in UserData).