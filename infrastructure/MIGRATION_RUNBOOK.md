# Migration Runbook: Single Stack → Two-Stack Architecture

This runbook covers migrating from the single `InfrastructureStack` to the new
`PersistentStack` + `MonitoringStack` architecture.

**Goal**: Deploying monitoring changes can never affect the EC2 instance.

## Prerequisites

- AWS CLI configured with `basny` profile
- CDK CLI installed: `npm install -g aws-cdk`
- Infrastructure dependencies installed: `cd infrastructure && npm install`
- SSH access to production via `ssh BAP`

## Phase 1: Build New Stacks in Parallel

Deploy the new two-stack architecture alongside the existing `InfrastructureStack`.
The old stack remains untouched during this phase.

### 1.1 Store instance ID in SSM

The new architecture uses SSM for cross-stack communication. Before deploying,
ensure the current instance ID is stored:

```bash
# Get current instance ID from CloudFormation outputs
INSTANCE_ID=$(aws --profile basny cloudformation describe-stacks \
  --stack-name InfrastructureStack \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' \
  --output text)

echo "Current instance ID: $INSTANCE_ID"

# Store in SSM for MonitoringStack to reference
aws --profile basny ssm put-parameter \
  --name /basny/production/instance-id \
  --value "$INSTANCE_ID" \
  --type String \
  --overwrite
```

### 1.2 Create EBS snapshot (safety net)

```bash
aws --profile basny ec2 create-snapshot \
  --volume-id vol-0aba5b85a1582b2c0 \
  --description "Pre-migration backup $(date +%Y%m%d-%H%M%S)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=BASNY-PreMigration},{Key=DoNotDelete,Value=true}]'
```

Wait for the snapshot to complete:

```bash
aws --profile basny ec2 describe-snapshots \
  --filters "Name=tag:Name,Values=BASNY-PreMigration" \
  --query 'Snapshots[0].State'
```

### 1.3 Deploy MonitoringStack only (safe)

MonitoringStack is stateless and can be deployed/destroyed freely:

```bash
cd infrastructure
npm run build
AWS_PROFILE=basny npx cdk deploy MonitoringStack
```

### 1.4 Subscribe to alerts

```bash
# Subscribe your email to the alerts topic
aws --profile basny sns subscribe \
  --topic-arn $(aws --profile basny cloudformation describe-stacks \
    --stack-name MonitoringStack \
    --query 'Stacks[0].Outputs[?OutputKey==`AlertsTopicArn`].OutputValue' --output text) \
  --protocol email \
  --notification-endpoint YOUR_EMAIL

# Subscribe to critical alerts
aws --profile basny sns subscribe \
  --topic-arn $(aws --profile basny cloudformation describe-stacks \
    --stack-name MonitoringStack \
    --query 'Stacks[0].Outputs[?OutputKey==`CriticalTopicArn`].OutputValue' --output text) \
  --protocol email \
  --notification-endpoint YOUR_EMAIL
```

Confirm subscriptions via the confirmation emails.

### 1.5 Verify MonitoringStack

```bash
# Check alarms exist
aws --profile basny cloudwatch describe-alarms \
  --alarm-name-prefix basny- \
  --query 'MetricAlarms[*].[AlarmName,StateValue]' --output table

# Verify SNS topics
aws --profile basny sns list-topics --query 'Topics[*].TopicArn' --output table
```

## Phase 2: Import Existing Resources into PersistentStack

This is the critical phase. We need to adopt the existing CloudFormation resources
from `InfrastructureStack` into `PersistentStack` without recreating them.

### Option A: CloudFormation Import (recommended)

CDK supports importing existing resources. This avoids any resource recreation.

#### 2A.1 Synthesize PersistentStack template

```bash
cd infrastructure
npm run build
AWS_PROFILE=basny npx cdk synth PersistentStack > /tmp/persistent-template.yaml
```

#### 2A.2 Review the synthesized template

Examine `/tmp/persistent-template.yaml` and note all resource logical IDs.
Compare with the existing `InfrastructureStack` resources:

```bash
aws --profile basny cloudformation list-stack-resources \
  --stack-name InfrastructureStack \
  --query 'StackResourceSummaries[*].[LogicalResourceId,ResourceType,PhysicalResourceId]' \
  --output table
```

#### 2A.3 Determine resource mapping

The logical IDs in the new stack must match the old ones, OR you must use
`--import-existing-resources` to map them. Since we kept the same construct IDs,
the logical IDs should match.

If they don't match exactly, create a resource import mapping file. See the
AWS CloudFormation docs for `import-existing-resources`.

### Option B: Parallel Build + Cutover (safer but more work)

If CloudFormation import is too complex, use the parallel approach:

1. Deploy PersistentStack with a NEW VPC, EC2, etc.
2. Migrate data from old → new (Phase 3)
3. Move EIP from old → new (Phase 4)
4. Delete old stack

**This approach is documented in Phases 3 and 4 below.**

## Phase 3: Data Migration (Option B only)

Skip this phase if using Option A (CloudFormation import).

### 3.1 Stop application on old instance

```bash
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml down"
```

### 3.2 Create final snapshot

```bash
aws --profile basny ec2 create-snapshot \
  --volume-id vol-0aba5b85a1582b2c0 \
  --description "Final migration snapshot $(date +%Y%m%d-%H%M%S)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=BASNY-FinalMigration}]'
```

### 3.3 Create new volume from snapshot

```bash
# Get snapshot ID
SNAPSHOT_ID=$(aws --profile basny ec2 describe-snapshots \
  --filters "Name=tag:Name,Values=BASNY-FinalMigration" \
  --query 'Snapshots[0].SnapshotId' --output text)

# Create new volume in the same AZ as the new instance
NEW_AZ=$(aws --profile basny ec2 describe-instances \
  --filters "Name=tag:aws:cloudformation:stack-name,Values=PersistentStack" \
  --query 'Reservations[0].Instances[0].Placement.AvailabilityZone' --output text)

aws --profile basny ec2 create-volume \
  --snapshot-id "$SNAPSHOT_ID" \
  --availability-zone "$NEW_AZ" \
  --volume-type gp3 \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=BASNY-Data-New},{Key=DoNotDelete,Value=true}]'
```

### 3.4 Update SSM with new volume ID

```bash
aws --profile basny ssm put-parameter \
  --name /basny/production/data-volume-id \
  --value "$NEW_VOLUME_ID" \
  --overwrite
```

### 3.5 Deploy PersistentStack with new volume

```bash
cd infrastructure
npm run build
AWS_PROFILE=basny npx cdk deploy PersistentStack --require-approval broadening
```

### 3.6 Verify data integrity on new instance

```bash
# SSH to new instance and verify
NEW_IP=$(aws --profile basny cloudformation describe-stacks \
  --stack-name PersistentStack \
  --query 'Stacks[0].Outputs[?OutputKey==`PublicIP`].OutputValue' --output text)

ssh ec2-user@$NEW_IP "sqlite3 /mnt/basny-data/app/database/database.db 'PRAGMA integrity_check;'"
ssh ec2-user@$NEW_IP "ls -la /mnt/basny-data/app/config/config.production.json"
```

## Phase 4: Cutover (Option B only)

Skip this phase if using Option A (CloudFormation import).

### 4.1 Re-associate Elastic IP

```bash
# Disassociate from old instance
OLD_ASSOC=$(aws --profile basny ec2 describe-addresses \
  --allocation-ids eipalloc-01f29c26363e0465a \
  --query 'Addresses[0].AssociationId' --output text)

aws --profile basny ec2 disassociate-address --association-id "$OLD_ASSOC"

# Associate with new instance
NEW_INSTANCE=$(aws --profile basny cloudformation describe-stacks \
  --stack-name PersistentStack \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' --output text)

aws --profile basny ec2 associate-address \
  --allocation-id eipalloc-01f29c26363e0465a \
  --instance-id "$NEW_INSTANCE"
```

### 4.2 Start application on new instance

```bash
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml up -d"
```

### 4.3 Verify production

```bash
curl https://bap.basny.org/health
ssh BAP "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"
```

### 4.4 Keep old instance for rollback (1-2 weeks)

Do NOT delete the old instance immediately. Keep it stopped for rollback:

```bash
OLD_INSTANCE=$(aws --profile basny cloudformation describe-stacks \
  --stack-name InfrastructureStack \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' --output text)

aws --profile basny ec2 stop-instances --instance-ids "$OLD_INSTANCE"
```

## Phase 5: Cleanup

After 1-2 weeks of stable production on the new stack:

### 5.1 Delete old CloudFormation stack

```bash
# First disable termination protection
aws --profile basny cloudformation update-termination-protection \
  --no-enable-termination-protection \
  --stack-name InfrastructureStack

# Delete the stack (RETAIN policies will preserve resources)
aws --profile basny cloudformation delete-stack --stack-name InfrastructureStack
```

Resources with RETAIN deletion policy (EC2, EBS, EIP) will NOT be deleted by
CloudFormation. You must clean them up manually:

### 5.2 Terminate old EC2 instance

```bash
aws --profile basny ec2 terminate-instances --instance-ids "$OLD_INSTANCE"
```

### 5.3 Clean up old resources

- Delete old root EBS volume (NOT the data volume)
- Remove any orphaned security groups
- Remove any orphaned ENIs

## Rollback Procedures

### During Phase 1-2 (before cutover)

No rollback needed. Old stack is untouched. Just delete the new stacks:

```bash
AWS_PROFILE=basny npx cdk destroy MonitoringStack
```

### During Phase 4 (after cutover)

Re-associate EIP back to old instance:

```bash
# Start old instance if stopped
aws --profile basny ec2 start-instances --instance-ids "$OLD_INSTANCE"

# Wait for running
aws --profile basny ec2 wait instance-running --instance-ids "$OLD_INSTANCE"

# Move EIP back
aws --profile basny ec2 disassociate-address --association-id <current-assoc-id>
aws --profile basny ec2 associate-address \
  --allocation-id eipalloc-01f29c26363e0465a \
  --instance-id "$OLD_INSTANCE"

# Verify
curl https://bap.basny.org/health
```

### After Phase 5 (old stack deleted)

If old instance was terminated, restore from snapshot:

1. Create new volume from pre-migration snapshot
2. Launch new EC2 instance
3. Attach data volume
4. Associate EIP
5. Start application

## Verification Checklist

After migration is complete, verify:

- [ ] `curl https://bap.basny.org/health` returns healthy
- [ ] All Docker containers running: `ssh BAP "sudo docker ps"`
- [ ] Database integrity: `ssh BAP "sqlite3 /mnt/basny-data/app/database/database.db 'PRAGMA integrity_check;'"`
- [ ] SSL working: `curl -vI https://bap.basny.org 2>&1 | grep 'SSL certificate'`
- [ ] CloudWatch alarms in OK state: `aws --profile basny cloudwatch describe-alarms --alarm-name-prefix basny-`
- [ ] SNS subscriptions confirmed
- [ ] Old `InfrastructureStack` deleted (Phase 5)
- [ ] `cdk deploy MonitoringStack` works without affecting EC2
