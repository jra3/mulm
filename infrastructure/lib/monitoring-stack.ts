import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export class MonitoringStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// Read instance ID from SSM (written by PersistentStack)
		const instanceId = ssm.StringParameter.valueForStringParameter(
			this,
			'/basny/production/instance-id'
		);

		// --- SNS Topics ---

		const alertsTopic = new sns.Topic(this, 'AlertsTopic', {
			topicName: 'basny-alerts',
			displayName: 'BASNY BAP Alerts',
		});

		const criticalTopic = new sns.Topic(this, 'CriticalTopic', {
			topicName: 'basny-critical',
			displayName: 'BASNY BAP Critical Alerts',
		});

		// --- CloudWatch Alarms ---

		// CPU utilization alarm
		new cloudwatch.Alarm(this, 'HighCpuAlarm', {
			alarmName: 'basny-high-cpu',
			alarmDescription: 'CPU utilization exceeds 80% for 10 minutes',
			metric: new cloudwatch.Metric({
				namespace: 'AWS/EC2',
				metricName: 'CPUUtilization',
				dimensionsMap: { InstanceId: instanceId },
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 80,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.BREACHING,
		}).addAlarmAction(new cloudwatch_actions.SnsAction(alertsTopic));

		// Instance status check alarm
		new cloudwatch.Alarm(this, 'StatusCheckAlarm', {
			alarmName: 'basny-status-check-failed',
			alarmDescription: 'EC2 instance or system status check failed',
			metric: new cloudwatch.Metric({
				namespace: 'AWS/EC2',
				metricName: 'StatusCheckFailed',
				dimensionsMap: { InstanceId: instanceId },
				period: cdk.Duration.minutes(1),
				statistic: 'Maximum',
			}),
			threshold: 0,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.BREACHING,
		}).addAlarmAction(new cloudwatch_actions.SnsAction(criticalTopic));

		// Network traffic alarm (unusually low = possible outage)
		new cloudwatch.Alarm(this, 'LowNetworkOutAlarm', {
			alarmName: 'basny-low-network-out',
			alarmDescription: 'Network output unusually low - possible application issue',
			metric: new cloudwatch.Metric({
				namespace: 'AWS/EC2',
				metricName: 'NetworkOut',
				dimensionsMap: { InstanceId: instanceId },
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 1000,
			evaluationPeriods: 3,
			comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.BREACHING,
		}).addAlarmAction(new cloudwatch_actions.SnsAction(alertsTopic));

		// --- Outputs ---

		new cdk.CfnOutput(this, 'AlertsTopicArn', {
			value: alertsTopic.topicArn,
			description: 'SNS topic ARN for general alerts',
		});

		new cdk.CfnOutput(this, 'CriticalTopicArn', {
			value: criticalTopic.topicArn,
			description: 'SNS topic ARN for critical alerts',
		});

		new cdk.CfnOutput(this, 'SubscribeCommand', {
			value: `aws sns subscribe --topic-arn ${alertsTopic.topicArn} --protocol email --notification-endpoint YOUR_EMAIL --profile basny`,
			description: 'Command to subscribe an email to alerts',
		});

		// Tags
		cdk.Tags.of(this).add('Application', 'BASNY-BAP');
		cdk.Tags.of(this).add('Environment', 'Production');
		cdk.Tags.of(this).add('ManagedBy', 'CDK');
	}
}
