import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Deploy this separate stack in us-east-1: Route 53 publishes its health metrics there.
export function monitoringTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Bayline external HTTPS readiness monitor (deploy in us-east-1)',
    Parameters: { DomainName: { Type: 'String', AllowedPattern: '[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}' }, AlertEmail: { Type: 'String' } },
    Resources: {
      AlertTopic: { Type: 'AWS::SNS::Topic', Properties: { Subscription: [{ Protocol: 'email', Endpoint: { Ref: 'AlertEmail' } }] } },
      HealthCheck: { Type: 'AWS::Route53::HealthCheck', Properties: {
        HealthCheckConfig: { Type: 'HTTPS', Port: 443, ResourcePath: '/api/ready', FullyQualifiedDomainName: { Ref: 'DomainName' }, EnableSNI: true, RequestInterval: 30, FailureThreshold: 3, MeasureLatency: false },
        HealthCheckTags: [{ Key: 'Name', Value: 'Bayline: web, DB, worker, feeds, backup and restore' }]
      } },
      HealthAlarm: { Type: 'AWS::CloudWatch::Alarm', Properties: {
        AlarmName: 'Bayline-uptime', AlarmDescription: 'App or recovery-readiness failure; follow deploy/RUNBOOK.md.',
        Namespace: 'AWS/Route53', MetricName: 'HealthCheckStatus', Dimensions: [{ Name: 'HealthCheckId', Value: { Ref: 'HealthCheck' } }],
        Statistic: 'Minimum', Period: 60, EvaluationPeriods: 2, DatapointsToAlarm: 2, Threshold: 1, ComparisonOperator: 'LessThanThreshold', TreatMissingData: 'breaching',
        AlarmActions: [{ Ref: 'AlertTopic' }], OKActions: [{ Ref: 'AlertTopic' }]
      } }
    },
    Outputs: { HealthCheckId: { Value: { Ref: 'HealthCheck' } }, AlertTopic: { Value: { Ref: 'AlertTopic' } } }
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pass an output JSON path');
  writeFileSync(process.argv[2], JSON.stringify(monitoringTemplate(), null, 2));
}
