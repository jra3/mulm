#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PersistentStack } from '../lib/persistent-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

// ⚠️ TERMINATION PROTECTION ENABLED on PersistentStack ⚠️
// This prevents accidental `cdk destroy` - you must explicitly disable it first
//
// Deploy only monitoring (safe, frequent):
//   AWS_PROFILE=basny npx cdk deploy MonitoringStack
//
// Deploy only infrastructure (rare, careful):
//   AWS_PROFILE=basny npx cdk deploy PersistentStack --require-approval broadening

new PersistentStack(app, 'PersistentStack', {
  terminationProtection: true,
});

new MonitoringStack(app, 'MonitoringStack', {
  terminationProtection: false,
});
