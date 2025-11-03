# CDK Deployment Safety Guide

This guide explains when it's safe to deploy CDK changes and when to avoid it.

## ⚠️ CRITICAL: Current Production State

**Running Instance:** `i-04344678eca4d35cc`
**Elastic IP:** `98.91.62.199` (eipalloc-01f29c26363e0465a)
**Data Volume:** Referenced in SSM `/basny/production/data-volume-id`
**Production URL:** https://bap.basny.org

The CDK stack (`InfrastructureStack`) manages this infrastructure but includes **protection policies** to prevent accidental instance replacement.

## Protection Mechanisms in Place

1. **Stack Termination Protection**: Enabled - prevents `cdk destroy`
2. **Instance Deletion Policy**: `RETAIN` - instance persists even if removed from stack
3. **Instance Update Replace Policy**: `RETAIN` - prevents instance replacement on updates
4. **UserData Policy**: `userDataCausesReplacement: false` - prevents recreation on script changes
5. **Data Volume Policy**: `RETAIN` - volume never deleted
6. **Elastic IP Policy**: `RETAIN` - EIP association preserved

## Safe to Deploy ✅

These changes can be deployed via `npm run cdk:deploy:safe`:

### Security Group Rules
- ✅ Add/remove ingress rules (e.g., opening/closing ports)
- ✅ Modify CIDR blocks for existing rules
- ✅ Change rule descriptions

**Example:** We removed SSH port 22 via AWS CLI. This could also be done via CDK.

### IAM Role Permissions
- ✅ Add/remove IAM policies to instance role
- ✅ Modify S3 bucket permissions
- ✅ Add SSM or CloudWatch permissions

### Monitoring & Logging
- ✅ Create/update CloudWatch alarms
- ✅ Modify log retention periods
- ✅ Add SNS topics for alerts

### Tags
- ✅ Add/remove/modify tags on resources
- ✅ Change stack-level tags

### VPC Configuration
- ✅ Modify route tables
- ✅ Add/remove subnets (if not in use)
- ✅ Update VPC CIDR blocks

## Requires Caution ⚠️

These changes can cause brief service disruption:

### EIP Association Changes
- ⚠️ Changing EIP association can cause 1-2 minute downtime
- ⚠️ DNS propagation may take longer
- **Mitigation:** Test during maintenance window

### Volume Attachments
- ⚠️ Modifying volume attachment can fail if volume is in use
- ⚠️ Never detach the data volume while instance is running
- **Mitigation:** Stop instance first (planned downtime)

### Instance Metadata
- ⚠️ Some metadata changes may require instance reboot
- **Mitigation:** Schedule maintenance window

## Never Deploy ❌

These changes would require manual intervention or cause data loss:

### Instance Configuration
- ❌ **Instance Type** (e.g., t3.micro → t3.small): Requires instance stop/start
- ❌ **AMI/Machine Image**: Would create new instance
- ❌ **Block Device Configuration**: Would recreate instance
- ❌ **Availability Zone**: Would recreate instance
- ❌ **VPC/Subnet** (if changing for existing instance): Would recreate

**Why:** Even with RETAIN policies, these changes trigger CloudFormation replacement logic. The old instance would be retained but a new one would be created, causing:
- Elastic IP disassociation
- Data volume detachment failures
- Service downtime

**Alternative:** Use AWS CLI/Console for these changes, or create a new instance manually and migrate.

### Data Volume
- ❌ **Never** delete or modify the production data volume via CDK
- ❌ **Never** change volume ID or device path
- ❌ **Never** add deletion or update policies that could affect data

### Elastic IP
- ❌ **Never** change the production Elastic IP allocation ID
- ❌ **Never** create a new EIP to replace the existing one (DNS points to specific IP)

## Safe Deployment Workflow

### 1. Always Use the Validation Script

```bash
# DO THIS (safe)
npm run cdk:deploy:safe

# NEVER DO THIS (risky)
npm run cdk:deploy
cdk deploy
```

The safe script runs pre-deployment validation to catch dangerous changes.

### 2. Review the Diff Carefully

```bash
npm run cdk:diff
```

Look for these warnings in the output:
- `[-] AWS::EC2::Instance` or `[~] AWS::EC2::Instance (replacement)` ❌ **STOP!**
- `[~] AWS::EC2::SecurityGroup` ✅ Usually safe (rule changes)
- `[~] AWS::IAM::Role` ✅ Usually safe (policy changes)

### 3. Understand CloudFormation Change Types

- **Add (+)**: New resource created ✅
- **Modify (~)**: Existing resource updated ✅ (usually)
- **Remove (-)**: Resource deleted ⚠️ (check deletion policy)
- **Replacement (⇄)**: Resource recreated ❌ **DANGEROUS**

### 4. Test in Staging First

If you have a staging environment:
1. Deploy changes to staging
2. Verify application works
3. Deploy to production during maintenance window

## What to Do If Something Goes Wrong

### EIP Disassociated (site unreachable)

```bash
# Re-associate the Elastic IP
aws --profile basny ec2 associate-address \
  --instance-id i-04344678eca4d35cc \
  --allocation-id eipalloc-01f29c26363e0465a
```

### Stack Update Failed

```bash
# Check stack status
aws --profile basny cloudformation describe-stacks \
  --stack-name InfrastructureStack \
  --query 'Stacks[0].StackStatus'

# View failure reason
aws --profile basny cloudformation describe-stack-events \
  --stack-name InfrastructureStack \
  --max-items 20
```

**CloudFormation will automatically rollback failed updates.** Your production instance should remain running.

### Instance Stopped or Terminated

If the instance shows as stopping/stopped:

```bash
# Check instance state
aws --profile basny ec2 describe-instances \
  --instance-ids i-04344678eca4d35cc \
  --query 'Reservations[0].Instances[0].State'

# Start instance if stopped
aws --profile basny ec2 start-instances \
  --instance-ids i-04344678eca4d35cc
```

**If instance was terminated:** The RETAIN policies mean it still exists. Check for any replacement instances and manually attach the data volume and EIP to the correct instance.

## Regular Application Deployments

**For normal application updates (code, Docker containers), DO NOT use CDK.**

Use the standard deployment process:

```bash
# Application deployment (safe, no infrastructure changes)
ssh BAP "cd /opt/basny && git pull && \
  sudo docker-compose -f docker-compose.prod.yml pull && \
  sudo docker-compose -f docker-compose.prod.yml up -d"
```

CDK is only for **infrastructure** changes (security groups, IAM, monitoring).

## When to Use CDK vs AWS CLI

| Task | Tool | Reason |
|------|------|--------|
| Update security group rules | CDK ✅ | Infrastructure as Code, version controlled |
| Update IAM policies | CDK ✅ | Consistent with IaC approach |
| Add CloudWatch alarms | CDK ✅ | Managed in code |
| One-off security rule change | AWS CLI ⚡ | Faster for quick fixes |
| Emergency fix (site down) | AWS CLI 🚨 | Don't wait for CDK deploy |
| Change instance type | Manual/CLI 🔧 | Too risky for CDK |
| Deploy application code | SSH/Docker 📦 | Not infrastructure |

## Emergency Contacts & Resources

- **Instance ID:** `i-04344678eca4d35cc`
- **SSH Access:** `ssh BAP` (via Tailscale)
- **AWS Console:** https://console.aws.amazon.com/ec2/
- **Systems Manager:** Use if Tailscale is down
  ```bash
  aws ssm start-session --target i-04344678eca4d35cc --profile basny
  ```

## Stack Drift Detection

Periodically check if manual changes have drifted from CDK:

```bash
npm run cdk:diff
```

If you see unexpected differences, it means manual changes were made via CLI/Console. Options:
1. Accept the drift (manual changes become the source of truth)
2. Update CDK code to match the current state
3. Re-deploy CDK to revert manual changes (⚠️ use caution)

## Summary

**Golden Rule:** When in doubt, DON'T deploy via CDK. Use AWS CLI for one-off changes.

**Safe Workflow:**
1. ✅ Make changes to `infrastructure/lib/infrastructure-stack.ts`
2. ✅ Run `npm run cdk:diff` to preview
3. ✅ Run `npm run cdk:deploy:safe` (validation included)
4. ✅ Verify application is still running at https://bap.basny.org

**Red Flags in `cdk diff`:**
- ❌ EC2 Instance replacement
- ❌ Volume ID changes
- ❌ EIP allocation changes
- ❌ "Will be created: AWS::EC2::Instance"

**Get Help:**
- Check CloudFormation events in AWS Console
- Review `infrastructure/README.md` for deployment procedures
- Test changes in a staging environment first
