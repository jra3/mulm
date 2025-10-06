import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { readFileSync } from 'fs';
import * as path from 'path';

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

		// Attach existing persistent data volume
		// IMPORTANT: This volume (vol-0aba5b85a1582b2c0) contains production data
		// and must NEVER be replaced. It persists across all infrastructure updates.
		new ec2.CfnVolumeAttachment(this, 'DataVolumeAttachment', {
			volumeId: 'vol-0aba5b85a1582b2c0',
			instanceId: instance.instanceId,
			device: '/dev/xvdf',
		});

		// Use existing Elastic IP (54.87.111.167)
		// IMPORTANT: This EIP persists across all infrastructure updates
		const eipAllocationId = 'eipalloc-030fa3f3db2993cfc';

		// Associate existing Elastic IP with instance
		new ec2.CfnEIPAssociation(this, 'EIPAssociation', {
			allocationId: eipAllocationId,
			instanceId: instance.instanceId,
		});

		// Outputs
		new cdk.CfnOutput(this, 'InstanceId', {
			value: instance.instanceId,
			description: 'EC2 Instance ID',
		});

		new cdk.CfnOutput(this, 'PublicIP', {
			value: '54.87.111.167',
			description: 'Elastic IP Address (persistent)',
		});

		new cdk.CfnOutput(this, 'SSHCommand', {
			value: 'ssh ec2-user@54.87.111.167',
			description: 'SSH connection command',
		});

		new cdk.CfnOutput(this, 'ApplicationURL', {
			value: 'http://54.87.111.167',
			description: 'Application URL (before SSL setup)',
		});

		// Tags
		cdk.Tags.of(this).add('Application', 'BASNY-BAP');
		cdk.Tags.of(this).add('Environment', 'Production');
		cdk.Tags.of(this).add('ManagedBy', 'CDK');
	}
}