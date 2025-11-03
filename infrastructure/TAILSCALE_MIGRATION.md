# Migrating SSH Access to Tailscale

This guide walks through migrating from public SSH access to Tailscale-only SSH access for improved security.

## Overview

**Current State:** SSH port 22 is open to the entire internet (`0.0.0.0/0`)

**Target State:** SSH accessible only via Tailscale, with AWS SSM as emergency backup

**Security Benefits:**
- Eliminates SSH brute-force attacks from internet scanners
- Zero-trust networking with device-level authentication
- MagicDNS for easier connection management
- Granular access control via Tailscale ACLs

## Prerequisites

- [x] Tailscale account (free for personal use: https://tailscale.com/start)
- [x] Tailscale installed on your admin machine
- [x] AWS CLI configured with `basny` profile
- [x] CDK CLI installed and bootstrapped
- [x] SSH access to production server

## Phase 1: Install & Verify Tailscale (Zero Downtime)

This phase installs Tailscale while keeping public SSH access available as fallback.

### Step 1.1: Get Tailscale Auth Key (Optional but Recommended)

For automated setup without browser authentication:

1. Visit: https://login.tailscale.com/admin/settings/keys
2. Generate a new **reusable** auth key with these settings:
   - ✅ Reusable (for server reinstalls)
   - ✅ Ephemeral: **DISABLED** (we want persistent access)
   - ✅ Pre-authorized (skip manual approval)
   - Optional: Set expiry (90 days recommended)
3. Save the key securely (password manager)

### Step 1.2: Install Tailscale on EC2 Server

**Option A: With Auth Key (Automated)**

```bash
# Copy install script to server
scp scripts/install-tailscale.sh BAP:/tmp/

# Install and authenticate in one step
ssh BAP "sudo bash /tmp/install-tailscale.sh --auth-key tskey-auth-YOUR_KEY_HERE"
```

**Option B: Manual Authentication**

```bash
# Copy install script to server
scp scripts/install-tailscale.sh BAP:/tmp/

# Install (will show authentication URL)
ssh BAP "sudo bash /tmp/install-tailscale.sh"

# Follow the URL shown to authenticate in browser
```

### Step 1.3: Verify Tailscale Installation

```bash
# Check Tailscale status
ssh BAP "tailscale status"

# Get Tailscale IPv4 address
ssh BAP "tailscale ip -4"
# Example output: 100.x.y.z

# Verify SSH is enabled via Tailscale
ssh BAP "tailscale status | grep ssh"
# Should show: "Tailscale SSH: running"
```

### Step 1.4: Test SSH via Tailscale

**CRITICAL:** Test this BEFORE closing public SSH!

```bash
# Get the Tailscale IP
TAILSCALE_IP=$(ssh BAP "tailscale ip -4")
echo "Tailscale IP: $TAILSCALE_IP"

# Test SSH via Tailscale (use new terminal window)
ssh ec2-user@$TAILSCALE_IP

# If successful, you should see the EC2 prompt
# Try running a command to verify:
# $ hostname
# Expected: ip-xx-xx-xx-xx.ec2.internal
```

**✅ Checkpoint:** If SSH via Tailscale works, proceed. If not, troubleshoot before continuing.

### Step 1.5: Update Local SSH Config

Add Tailscale-based connection to your `~/.ssh/config`:

```bash
# Get the Tailscale IP
TAILSCALE_IP=$(ssh BAP "tailscale ip -4")

# Option 1: Replace existing BAP entry with Tailscale IP
# Edit ~/.ssh/config and update the HostName to use $TAILSCALE_IP

# Option 2: Add separate entry for Tailscale (recommended during transition)
cat >> ~/.ssh/config <<EOF

# BASNY Production Server (via Tailscale)
Host BAP-tailscale
    HostName $TAILSCALE_IP
    User ec2-user
    IdentityFile ~/.ssh/basny-ec2-keypair.pem
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
EOF
```

Test the new config:

```bash
ssh BAP-tailscale "hostname"
# Should succeed via Tailscale
```

### Step 1.6: Optional - Setup MagicDNS Hostname

Tailscale can assign a friendly hostname instead of IP:

```bash
# Check current MagicDNS name
ssh BAP "tailscale status | grep $(hostname)"

# Example: basny-production.your-tailnet.ts.net
```

Update `~/.ssh/config` to use MagicDNS hostname for easier access:

```
Host BAP-tailscale
    HostName basny-production.your-tailnet.ts.net
    User ec2-user
    IdentityFile ~/.ssh/basny-ec2-keypair.pem
```

## Phase 2: Close Public SSH Port (Requires Redeploy)

**⚠️ CRITICAL SAFETY CHECKS BEFORE PROCEEDING:**
- [ ] Tailscale SSH is working (verified in Step 1.4)
- [ ] You have Tailscale installed on ALL admin machines
- [ ] You understand AWS SSM Session Manager is emergency backup
- [ ] You have created an EBS snapshot (see below)

### Step 2.1: Create EBS Snapshot (Safety)

**ALWAYS create snapshot before infrastructure changes:**

```bash
aws --profile basny ec2 create-snapshot \
  --volume-id vol-0aba5b85a1582b2c0 \
  --description "Pre-Tailscale-migration snapshot $(date +%Y%m%d-%H%M%S)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=BASNY-PreTailscale-Backup},{Key=DoNotDelete,Value=true}]'

# Note the snapshot ID (snap-xxxx)
# Track progress:
aws --profile basny ec2 describe-snapshots --snapshot-ids snap-XXXX --query 'Snapshots[0].State'
```

### Step 2.2: Build and Preview CDK Changes

```bash
cd infrastructure

# Build the stack
npm run build

# Preview changes (should show security group modification)
npm run cdk diff -- --profile basny

# Expected output:
# SecurityGroupIngress removed: 0.0.0.0/0:22
```

### Step 2.3: Deploy Updated Stack

**This will close port 22 to the public!**

```bash
cd infrastructure
npm run cdk deploy -- --profile basny

# Type 'y' to confirm deployment
# Wait for deployment to complete (~2-3 minutes)
```

### Step 2.4: Verify Public SSH is Blocked

**From a machine NOT on Tailscale** (or disconnect Tailscale temporarily):

```bash
# This should FAIL (timeout or connection refused)
ssh -o ConnectTimeout=10 ec2-user@98.91.62.199
# Expected: Connection timeout or refused

# Check security group rules
aws --profile basny ec2 describe-security-groups \
  --filters "Name=group-name,Values=*BASNY*" \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`]'
# Expected: Empty array [] (no SSH ingress rules)
```

### Step 2.5: Verify Tailscale SSH Still Works

```bash
# This should SUCCEED
ssh BAP-tailscale "hostname"

# Or using IP directly:
ssh ec2-user@100.x.y.z "hostname"
```

**✅ Success!** SSH is now Tailscale-only.

## Phase 3: Update Documentation & Finalize

### Step 3.1: Update Main SSH Config

Replace your public-IP SSH config with Tailscale:

```bash
# Edit ~/.ssh/config
# Change the BAP entry from:
#   HostName 98.91.62.199
# To:
#   HostName 100.x.y.z  (or basny-production.your-tailnet.ts.net)

# Or keep both entries if you want flexibility
```

### Step 3.2: Test All Common Operations

```bash
# SSH
ssh BAP "sudo docker ps"

# SCP (file transfer)
scp test.txt BAP:/tmp/

# Database backup
ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db '.backup /tmp/test-backup.db'"
scp BAP:/tmp/test-backup.db ./
```

### Step 3.3: Setup Emergency Access via AWS SSM

AWS Systems Manager Session Manager provides browser-based shell access without SSH:

```bash
# Install AWS Session Manager plugin (one-time setup)
# macOS:
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac/sessionmanager-bundle.zip" -o "sessionmanager-bundle.zip"
unzip sessionmanager-bundle.zip
sudo ./sessionmanager-bundle/install -i /usr/local/sessionmanagerplugin -b /usr/local/bin/session-manager-plugin

# Verify installation
session-manager-plugin --version

# Get instance ID
INSTANCE_ID=$(aws --profile basny ec2 describe-instances \
  --filters "Name=tag:Name,Values=BASNY-Production" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

# Start emergency SSH session (no Tailscale needed!)
aws --profile basny ssm start-session --target $INSTANCE_ID

# This opens a shell on the server via AWS Systems Manager
```

### Step 3.4: Document for Team

Share the following with other admins:

```markdown
## SSH Access to Production

SSH access is now **Tailscale-only** for improved security.

**Setup (One-time):**
1. Install Tailscale: https://tailscale.com/download
2. Join the tailnet (ask admin for invite)
3. Update ~/.ssh/config:
   ```
   Host BAP
       HostName basny-production.your-tailnet.ts.net
       User ec2-user
       IdentityFile ~/.ssh/basny-ec2-keypair.pem
   ```

**Usage:**
- Ensure Tailscale is running before SSH
- Connect: `ssh BAP`

**Emergency Access (if Tailscale is down):**
```bash
aws --profile basny ssm start-session --target i-xxxxx
```
```

## Rollback Procedure

If you need to restore public SSH access (emergency only):

### Quick Rollback (Temporary)

```bash
# Get current security group ID
SG_ID=$(aws --profile basny ec2 describe-instances \
  --filters "Name=tag:Name,Values=BASNY-Production" \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' \
  --output text)

# Add temporary SSH rule
aws --profile basny ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 22 \
  --cidr 0.0.0.0/0

# You can now SSH from anywhere
# REMEMBER TO REMOVE THIS RULE WHEN DONE!
```

### Permanent Rollback (CDK)

1. Edit `infrastructure/lib/infrastructure-stack.ts`
2. Uncomment the SSH ingress rule (lines 68-72)
3. Rebuild and deploy:
   ```bash
   cd infrastructure
   npm run build
   npm run cdk deploy -- --profile basny
   ```

## Tailscale Management

### Useful Commands

```bash
# Check connection status
ssh BAP "tailscale status"

# View peers (other devices on tailnet)
ssh BAP "tailscale status --peers"

# Check IP addresses (IPv4 and IPv6)
ssh BAP "tailscale ip"

# Restart Tailscale daemon
ssh BAP "sudo systemctl restart tailscaled"

# View Tailscale logs
ssh BAP "sudo journalctl -u tailscaled -f"
```

### Access Control Lists (ACLs)

Configure which devices can access the server:

1. Visit: https://login.tailscale.com/admin/acls
2. Example ACL limiting SSH to specific users:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["user@example.com"],
      "dst": ["tag:production:22"]
    }
  ],
  "tagOwners": {
    "tag:production": ["user@example.com"]
  }
}
```

3. Tag the server in Tailscale admin panel with `tag:production`

### Key Rotation

Tailscale periodically rotates keys automatically. If you need to manually re-authenticate:

```bash
ssh BAP "sudo tailscale up --force-reauth"
```

## Troubleshooting

### Can't Connect via Tailscale

1. **Check Tailscale is running on client:**
   ```bash
   tailscale status
   ```

2. **Check Tailscale is running on server:**
   ```bash
   ssh BAP "sudo systemctl status tailscaled"
   # Or use AWS SSM if SSH doesn't work
   ```

3. **Verify both devices are on same tailnet:**
   ```bash
   tailscale status --peers
   # Server should appear in the list
   ```

4. **Check firewall isn't blocking Tailscale:**
   ```bash
   # Tailscale uses UDP 41641 (should work with allowAllOutbound: true)
   ssh BAP "sudo netstat -tulpn | grep tailscale"
   ```

### Lost All SSH Access

Use AWS Systems Manager Session Manager:

```bash
# Get instance ID
INSTANCE_ID=$(aws --profile basny ec2 describe-instances \
  --filters "Name=tag:Name,Values=BASNY-Production" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

# Start session
aws --profile basny ssm start-session --target $INSTANCE_ID

# Once in session:
$ sudo systemctl status tailscaled
$ sudo tailscale status
```

### Tailscale Service Not Starting

```bash
# Check service status
sudo systemctl status tailscaled

# Check logs
sudo journalctl -u tailscaled --no-pager -n 50

# Restart service
sudo systemctl restart tailscaled

# Re-authenticate
sudo tailscale up --force-reauth
```

## Security Considerations

### What Tailscale Provides

✅ **Encrypted mesh network** - All traffic encrypted (WireGuard protocol)
✅ **NAT traversal** - Works behind firewalls and NATs automatically
✅ **Zero-trust** - Device-level authentication required
✅ **MFA support** - Can require 2FA for tailnet access
✅ **ACLs** - Fine-grained access control
✅ **Audit logs** - Track device connections

### What Tailscale Doesn't Provide

❌ **Not a replacement for AWS security groups** - Still use SGs for defense-in-depth
❌ **Not anonymous** - Your Tailscale account knows all connected devices
❌ **Not self-hosted** - Control plane runs on Tailscale's infrastructure (though coordination servers can be self-hosted with Headscale)

### Best Practices

1. **Enable MFA** on Tailscale account: https://login.tailscale.com/admin/settings/security
2. **Use ACLs** to restrict which devices can access production servers
3. **Tag servers** for easier ACL management
4. **Key expiry** enabled for auth keys (90 days max)
5. **Monitor connections** via Tailscale admin panel
6. **Keep SSM access** as emergency backup (don't disable AmazonSSMManagedInstanceCore IAM policy)

## Cost

Tailscale is **free** for personal use (up to 100 devices, 3 users).

For team use: https://tailscale.com/pricing

AWS Systems Manager Session Manager is **free** (no additional charges).

## References

- [Tailscale Documentation](https://tailscale.com/kb/)
- [Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh/)
- [AWS Systems Manager Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)
- [WireGuard Protocol](https://www.wireguard.com/)
