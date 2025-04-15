import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
//import * as s3 from 'aws-cdk-lib/aws-s3';

import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class InfrastructureStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		const vpc = new ec2.Vpc(this, 'Vpc2', {
			maxAzs: 2,
			natGateways: 0,
		});

		const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
		cluster.addCapacity('ASGroup', {
			instanceType: new ec2.InstanceType('t3.micro'),
			desiredCapacity: 1,
			machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
			vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
		});

		// Define the service/tasks that run in the single cluster instance

		const taskDef = new ecs.Ec2TaskDefinition(this, 'TaskDef', {
			networkMode: ecs.NetworkMode.HOST,
		});

		taskDef.addVolume({
			name: 'basny-data-volume',
			host: { sourcePath: '/mnt/data' },
		});

		const app = taskDef.addContainer('AppContainer', {
			image: ecs.ContainerImage.fromAsset('..', {
				platform: ecr_assets.Platform.LINUX_AMD64,
				exclude: ["node_modules", "Dockerfile", "infrastructure", "cdk.out"],
			}),
			memoryLimitMiB: 256,
			environment: {
				DATABASE_FILE: '/mnt/data/database.sqlite',
			},
			logging: new ecs.AwsLogDriver({ streamPrefix: 'ecs-ebs' }),
			essential: true,
		});
		app.addMountPoints({
			containerPath: '/mnt/data',
			sourceVolume: 'basny-data-volume',
			readOnly: false,
		})
		app.addPortMappings({
			containerPort: 4200,
			protocol: ecs.Protocol.TCP,
		});

		const cloudflareTunnelToken = secretsmanager.Secret.fromSecretNameV2(this, 'TunnelToken', 'cf-tunnel-token');

		taskDef.addContainer('Cloudflared', {
			image: ecs.ContainerImage.fromRegistry('cloudflare/cloudflared:latest'),
			logging: ecs.LogDriver.awsLogs({ streamPrefix: 'cloudflared' }),
			memoryLimitMiB: 256,
			secrets: {
				"TUNNEL_TOKEN": ecs.Secret.fromSecretsManager(cloudflareTunnelToken),
			},
			entryPoint: ["cloudflared", "tunnel", "--no-autoupdate", "run"],
		});

		const service = new ecs.Ec2Service(this, 'Service', {
			cluster,
			taskDefinition: taskDef,
			desiredCount: 1,
		});
		cloudflareTunnelToken.grantRead(service.taskDefinition.obtainExecutionRole());

		// tell it to stop all old tasks before starting new ones
		const cfnSvc = service.node.defaultChild as ecs.CfnService;
		cfnSvc.addPropertyOverride('DeploymentConfiguration.MinimumHealthyPercent', 0);
		cfnSvc.addPropertyOverride('DeploymentConfiguration.MaximumPercent', 100);
	}
}
