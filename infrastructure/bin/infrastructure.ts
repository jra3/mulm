#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
//import { InfrastructureStack } from '../lib/infrastructure-stack';
import { SimpleEc2Stack } from '../lib/simple-ec2-stack';

const app = new cdk.App();
//new InfrastructureStack(app, 'InfrastructureStack', {});
new SimpleEc2Stack(app, 'SimpleEc2Stack', {});
