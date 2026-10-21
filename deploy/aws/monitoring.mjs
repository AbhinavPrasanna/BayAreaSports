import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run outside the Lightsail host; validate HTTPS trust, identity and expiry too.
export function monitoringTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Bayline external HTTPS, TLS-expiry and recovery-readiness monitor',
    Parameters: { Endpoint: { Type: 'String', AllowedPattern: '[a-zA-Z0-9.-]+' }, AlertEmail: { Type: 'String' } },
    Resources: {
      AlertTopic: { Type: 'AWS::SNS::Topic', Properties: { Subscription: [{ Protocol: 'email', Endpoint: { Ref: 'AlertEmail' } }] } },
      Logs: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: '/aws/lambda/bayline-uptime', RetentionInDays: 14 } },
      Role: { Type: 'AWS::IAM::Role', Properties: {
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
        Policies: [{ PolicyName: 'UptimeOnly', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: { 'Fn::GetAtt': ['Logs', 'Arn'] } },
          { Effect: 'Allow', Action: 'cloudwatch:PutMetricData', Resource: '*', Condition: { StringEquals: { 'cloudwatch:namespace': 'Bayline' } } }
        ] } }]
      } },
      Check: { Type: 'AWS::Lambda::Function', Properties: {
        FunctionName: 'bayline-uptime', Runtime: 'nodejs22.x', Architectures: ['arm64'], Handler: 'index.handler', MemorySize: 128, Timeout: 15, ReservedConcurrentExecutions: 1,
        Role: { 'Fn::GetAtt': ['Role', 'Arn'] }, Environment: { Variables: { ENDPOINT: { Ref: 'Endpoint' } } },
        Code: { ZipFile: readFileSync(new URL('./uptime.cjs', import.meta.url), 'utf8') }
      } },
      Schedule: { Type: 'AWS::Events::Rule', Properties: { ScheduleExpression: 'rate(1 minute)', State: 'ENABLED', Targets: [{ Arn: { 'Fn::GetAtt': ['Check', 'Arn'] }, Id: 'Uptime', RetryPolicy: { MaximumRetryAttempts: 1, MaximumEventAgeInSeconds: 60 } }] } },
      Permission: { Type: 'AWS::Lambda::Permission', Properties: { Action: 'lambda:InvokeFunction', FunctionName: { Ref: 'Check' }, Principal: 'events.amazonaws.com', SourceArn: { 'Fn::GetAtt': ['Schedule', 'Arn'] }, SourceAccount: { Ref: 'AWS::AccountId' } } },
      HealthAlarm: { Type: 'AWS::CloudWatch::Alarm', Properties: {
        AlarmName: 'Bayline-uptime', AlarmDescription: 'HTTPS, certificate, app or recovery-readiness failure; follow deploy/RUNBOOK.md.',
        Namespace: 'Bayline', MetricName: 'Healthy', Dimensions: [{ Name: 'App', Value: 'Bayline' }],
        Statistic: 'Minimum', Period: 60, EvaluationPeriods: 2, DatapointsToAlarm: 2, Threshold: 1, ComparisonOperator: 'LessThanThreshold', TreatMissingData: 'breaching',
        AlarmActions: [{ Ref: 'AlertTopic' }], OKActions: [{ Ref: 'AlertTopic' }]
      } }
    },
    Outputs: { FunctionName: { Value: { Ref: 'Check' } }, AlertTopic: { Value: { Ref: 'AlertTopic' } } }
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pass an output JSON path');
  writeFileSync(process.argv[2], JSON.stringify(monitoringTemplate(), null, 2));
}
