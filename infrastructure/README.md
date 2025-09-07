# Infrastructure Setup

This directory contains AWS CDK code for deploying a simple EC2 instance with automated provisioning.

## Features

- **EC2 Instance**: Free-tier eligible t2.micro instance running Amazon Linux 2023
- **Storage**: 8GB EBS volume automatically mounted at `/mnt/data`
- **Networking**: Elastic IP for static internet access
- **Security**: Tailscale VPN for secure access (SSH can be disabled after setup)
- **Automated Provisioning**: Installs git, Docker, Docker Compose, and Tailscale

## Prerequisites

- AWS CLI configured with appropriate credentials
- AWS CDK installed (`npm install -g aws-cdk`)
- Node.js and npm

## Deployment

1. Install dependencies:
   ```bash
   cd infrastructure
   npm install
   ```

2. Deploy the stack:
   ```bash
   cdk deploy SimpleEc2Stack
   ```

3. Retrieve SSH key:
   ```bash
   ./setup-ssh.sh SimpleEc2Stack
   ```

4. (Optional) Set up Tailscale:
   ```bash
   # See instructions for interactive setup
   ./setup-tailscale.sh
   ```

## What Gets Installed

The instance is automatically provisioned with:

- **Git**: For source code management
- **Node.js & npm**: Latest LTS version for building the application
- **Docker & Docker Compose**: For running containerized applications
- **Tailscale**: Installed but not configured (run `sudo tailscale up` to set up)
- **mulm repository**: Cloned to `/home/ec2-user/mulm`

## Accessing the Instance

### Via SSH (initially):
```bash
ssh -i ~/.ssh/SimpleEc2Stack.pem ec2-user@<ELASTIC-IP>
```

### Via Tailscale (after running `sudo tailscale up`):
```bash
ssh ec2-user@<TAILSCALE-IP>
```

## Building the Application

After connecting to the instance:

```bash
cd ~/mulm
npm install
npm run build
```

## Security Considerations

1. The instance initially allows SSH access from anywhere (0.0.0.0/0)
2. After Tailscale is configured, you can disable public SSH access via the security group
3. The instance has an IAM role with minimal permissions (SSM access only)

## Troubleshooting

- **Provisioning logs**: Check `/var/log/user-data.log` on the instance
- **Cloud-init logs**: Check `/var/log/cloud-init-output.log`
- **Docker permissions**: Log out and back in after first login for docker group membership

## Cleanup

To destroy all resources:
```bash
cdk destroy SimpleEc2Stack
```

This will remove the EC2 instance, EBS volume, Elastic IP, and all associated resources.