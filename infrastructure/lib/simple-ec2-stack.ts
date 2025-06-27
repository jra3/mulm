import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import * as path from 'path';

export class SimpleEc2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC with public subnet only
    const vpc = new ec2.Vpc(this, 'OneHostVpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // Security group allowing SSH access
    const securityGroup = new ec2.SecurityGroup(this, 'SSHSecurityGroup', {
      vpc,
      description: 'Security group for single EC2 instance',
      allowAllOutbound: true,
    });

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access'
    );

    // Create key pair
    const keyPair = new ec2.KeyPair(this, 'InstanceKeyPair', {
      keyPairName: `${this.stackName}-keypair`,
    });

    // Create IAM role for the instance
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Create EC2 instance (t3.micro for free tier)
    const instance = new ec2.Instance(this, 'Instance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
      }),
      securityGroup,
      keyPair,
      role: instanceRole,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Create EBS volume (8GB for free tier)
    const volume = new ec2.Volume(this, 'DataVolume', {
      availabilityZone: instance.instanceAvailabilityZone,
      size: cdk.Size.gibibytes(8),
      volumeType: ec2.EbsDeviceVolumeType.GP2,
    });

    // Attach EBS volume to instance
    new ec2.CfnVolumeAttachment(this, 'VolumeAttachment', {
      volumeId: volume.volumeId,
      instanceId: instance.instanceId,
      device: '/dev/xvdf',
    });

    // Create and associate Elastic IP
    const elasticIp = new ec2.CfnEIP(this, 'ElasticIP', {
      instanceId: instance.instanceId,
    });

    // Read and apply user data script
    const userDataScript = fs.readFileSync(
      path.join(__dirname, 'user-data.sh'),
      'utf8'
    );
    
    instance.addUserData(userDataScript);
    // Output the Elastic IP for easy access
    new cdk.CfnOutput(this, 'ElasticIPAddress', {
      value: elasticIp.ref,
      description: 'Elastic IP address of the EC2 instance',
    });

    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'EC2 Instance ID',
    });

    new cdk.CfnOutput(this, 'KeyPairId', {
      value: keyPair.keyPairId,
      description: 'SSH Key Pair ID',
    });

    new cdk.CfnOutput(this, 'GetSSHKeyCommand', {
      value: `aws ssm get-parameter --name /ec2/keypair/${keyPair.keyPairId} --region ${this.region} --with-decryption --query Parameter.Value --output text > ~/.ssh/${this.stackName}.pem && chmod 600 ~/.ssh/${this.stackName}.pem`,
      description: 'Command to retrieve SSH private key',
    });

    new cdk.CfnOutput(this, 'SSHCommand', {
      value: `ssh -i ~/.ssh/${this.stackName}.pem ec2-user@${elasticIp.ref}`,
      description: 'SSH connection command',
    });

    new cdk.CfnOutput(this, 'TailscaleSetupInstructions', {
      value: 'SSH into the instance and run: sudo tailscale up',
      description: 'Instructions to set up Tailscale',
    });
  }
}
