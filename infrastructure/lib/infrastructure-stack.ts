import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { readFileSync } from 'fs';
import * as path from 'path';

// ⚠️⚠️⚠️ CRITICAL PRODUCTION RESOURCES - DO NOT DELETE ⚠️⚠️⚠️
// These resource IDs are HARDCODED and contain production data
// Deleting these will result in COMPLETE DATA LOSS
const PRODUCTION_DATA_VOLUME_ID = 'vol-0aba5b85a1582b2c0'; // 8GB EBS volume with database
const PRODUCTION_ELASTIC_IP_ALLOCATION = 'eipalloc-01f29c26363e0465a'; // 98.91.62.199
const PRODUCTION_IP_ADDRESS = '98.91.62.199'; // bap.basny.org DNS points here
// ⚠️⚠️⚠️ DO NOT MODIFY THESE VALUES UNLESS YOU KNOW EXACTLY WHAT YOU'RE DOING ⚠️⚠️⚠️

export class InfrastructureStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// VPC Configuration - Simple public subnet only
		const vpc = new ec2.Vpc(this, 'BasnyVpc', {
			maxAzs: 1,
			natGateways: 0,
			subnetConfiguration: [
				{
					name: 'PublicSubnet',
					subnetType: ec2.SubnetType.PUBLIC,
					cidrMask: 24,
				},
			],
		});

		// Security Group
		const securityGroup = new ec2.SecurityGroup(this, 'BasnySecurityGroup', {
			vpc,
			description: 'Security group for BASNY BAP application',
			allowAllOutbound: true,
		});

		// Allow SSH access (restrict this to your IP in production)
		securityGroup.addIngressRule(
			ec2.Peer.anyIpv4(),
			ec2.Port.tcp(22),
			'Allow SSH access'
		);

		// Allow HTTP traffic
		securityGroup.addIngressRule(
			ec2.Peer.anyIpv4(),
			ec2.Port.tcp(80),
			'Allow HTTP traffic'
		);

		// Allow HTTPS traffic
		securityGroup.addIngressRule(
			ec2.Peer.anyIpv4(),
			ec2.Port.tcp(443),
			'Allow HTTPS traffic'
		);

		// IAM Role for EC2 Instance
		const role = new iam.Role(this, 'BasnyInstanceRole', {
			assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
			description: 'IAM role for BASNY BAP EC2 instance',
		});

		// Add necessary policies
		role.addManagedPolicy(
			iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
		);

		// Add S3 access for R2 operations (customize bucket as needed)
		role.addToPolicy(
			new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: [
					's3:GetObject',
					's3:PutObject',
					's3:DeleteObject',
					's3:ListBucket',
				],
				resources: [
					'arn:aws:s3:::basny-bap-data/*',
					'arn:aws:s3:::basny-bap-data',
				],
			})
		);

		// Add Systems Manager access for remote management (optional)
		role.addManagedPolicy(
			iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
		);

		// CloudWatch Logs Group
		new logs.LogGroup(this, 'BasnyLogGroup', {
			logGroupName: '/aws/ec2/basny',
			retention: logs.RetentionDays.TWO_WEEKS,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		// Read UserData script
		const userDataScript = readFileSync(
			path.join(__dirname, '../../scripts/ec2-userdata.sh'),
			'utf8'
		);

		// Create new key pair using the modern KeyPair construct
		const keyPair = new ec2.KeyPair(this, 'BasnyKeyPair', {
			keyPairName: 'basny-bap-keypair-v2',
			type: ec2.KeyPairType.RSA,
			format: ec2.KeyPairFormat.PEM,
		});

		// The KeyPair construct automatically stores the private key in SSM Parameter Store

		// Output for retrieving the key
		new cdk.CfnOutput(this, 'KeyPairId', {
			value: keyPair.keyPairId,
			description: 'Key Pair ID - retrieve private key using get-private-key.sh script',
		});

		new cdk.CfnOutput(this, 'PrivateKeyParameterName', {
			value: keyPair.privateKey.parameterName,
			description: 'SSM Parameter name containing the private key',
		});

		// EC2 Instance (root volume only - data volume attached separately)
		const instance = new ec2.Instance(this, 'BasnyInstance', {
			vpc,
			vpcSubnets: {
				subnetType: ec2.SubnetType.PUBLIC,
			},
			instanceType: ec2.InstanceType.of(
				ec2.InstanceClass.T3,
				ec2.InstanceSize.MICRO
			),
			machineImage: ec2.MachineImage.latestAmazonLinux2023(),
			securityGroup,
			role,
			keyPair: keyPair,
			blockDevices: [
				{
					deviceName: '/dev/xvda',
					volume: ec2.BlockDeviceVolume.ebs(8, {
						volumeType: ec2.EbsDeviceVolumeType.GP3,
						encrypted: true,
					}),
				},
			],
			userData: ec2.UserData.custom(userDataScript),
			userDataCausesReplacement: false,
		});

		// ⚠️ CRITICAL: Attach existing persistent data volume
		// This volume contains the production database, config, and SSL certificates
		// It must NEVER be deleted or formatted. DeletionPolicy is set to RETAIN.
		const dataVolumeAttachment = new ec2.CfnVolumeAttachment(this, 'DataVolumeAttachment', {
			volumeId: PRODUCTION_DATA_VOLUME_ID,
			instanceId: instance.instanceId,
			device: '/dev/xvdf',
		});
		// RETAIN policy ensures volume persists even if stack is destroyed
		dataVolumeAttachment.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;

		// ⚠️ CRITICAL: Associate existing production Elastic IP
		// DNS (bap.basny.org) points to this IP - do not change without updating DNS
		// This EIP was created outside CDK and will not be deleted by stack operations
		const eipAssociation = new ec2.CfnEIPAssociation(this, 'EIPAssociation', {
			allocationId: PRODUCTION_ELASTIC_IP_ALLOCATION,
			instanceId: instance.instanceId,
		});
		// RETAIN policy protects EIP association (though EIP itself is external)
		eipAssociation.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;

		// Outputs
		new cdk.CfnOutput(this, 'InstanceId', {
			value: instance.instanceId,
			description: 'EC2 Instance ID',
		});

		new cdk.CfnOutput(this, 'PublicIP', {
			value: PRODUCTION_IP_ADDRESS,
			description: 'Elastic IP Address (persistent - bap.basny.org)',
		});

		new cdk.CfnOutput(this, 'SSHCommand', {
			value: `ssh ec2-user@${PRODUCTION_IP_ADDRESS}`,
			description: 'SSH connection command',
		});

		new cdk.CfnOutput(this, 'ApplicationURL', {
			value: `http://${PRODUCTION_IP_ADDRESS}`,
			description: 'Application URL (use https://bap.basny.org in production)',
		});

		// Tags
		cdk.Tags.of(this).add('Application', 'BASNY-BAP');
		cdk.Tags.of(this).add('Environment', 'Production');
		cdk.Tags.of(this).add('ManagedBy', 'CDK');
	}
}