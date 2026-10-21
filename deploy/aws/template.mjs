import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ref = name => ({ Ref: name });
const sub = value => ({ 'Fn::Sub': value });
const att = (name, attribute) => ({ 'Fn::GetAtt': [name, attribute] });

export function template() {
  const retained = { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' };
  const repo = suffix => ({ Type: 'AWS::ECR::Repository', ...retained, Properties: {
    RepositoryName: sub('${AWS::StackName}/' + suffix), ImageTagMutability: 'IMMUTABLE',
    ImageScanningConfiguration: { ScanOnPush: true },
    LifecyclePolicy: { LifecyclePolicyText: JSON.stringify({ rules: [{ rulePriority: 1, description: 'Remove unused untagged layers after seven days', selection: { tagStatus: 'untagged', countType: 'sinceImagePushed', countUnit: 'days', countNumber: 7 }, action: { type: 'expire' } }] }) }
  } });
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Bayline single-host MVP: $24 Lightsail, private PostgreSQL, off-server backups, prebuilt ECR images and $100 account budget.',
    Parameters: {
      AlertEmail: { Type: 'String', AllowedPattern: '[^@\\s]+@[^@\\s]+\\.[^@\\s]+' },
      AdminCidr: { Type: 'String', AllowedPattern: '(?:[0-9]{1,3}\\.){3}[0-9]{1,3}/32', Description: 'Operator public IPv4 /32; never open SSH globally' },
      InstanceSuffix: { Type: 'String', Default: '01', AllowedPattern: '[a-z0-9-]+' }
    },
    Resources: {
      Instance: { Type: 'AWS::Lightsail::Instance', DependsOn: 'Budget', ...retained, Properties: {
        InstanceName: sub('${AWS::StackName}-${InstanceSuffix}'), AvailabilityZone: sub('${AWS::Region}a'),
        BlueprintId: 'ubuntu_24_04', BundleId: 'medium_3_0',
        UserData: readFileSync(new URL('./bootstrap.sh', import.meta.url), 'utf8'),
        Networking: { Ports: [
          { FromPort: 22, ToPort: 22, Protocol: 'tcp', Cidrs: [ref('AdminCidr')] },
          { FromPort: 80, ToPort: 80, Protocol: 'tcp', Cidrs: ['0.0.0.0/0'] },
          { FromPort: 443, ToPort: 443, Protocol: 'tcp', Cidrs: ['0.0.0.0/0'] }
        ] }, Tags: [{ Key: 'Project', Value: 'Bayline' }]
      } },
      StaticIp: { Type: 'AWS::Lightsail::StaticIp', ...retained, Properties: { StaticIpName: sub('${AWS::StackName}-ip'), AttachedTo: ref('Instance') } },
      BackupBucket: { Type: 'AWS::Lightsail::Bucket', ...retained, Properties: {
        BucketName: sub('bayline-backups-${AWS::AccountId}-${AWS::Region}'), BundleId: 'small_1_0',
        ObjectVersioning: true, AccessRules: { GetObject: 'private', AllowPublicOverrides: false },
        ResourcesReceivingAccess: [ref('Instance')], Tags: [{ Key: 'Project', Value: 'Bayline' }]
      } },
      SourceBucket: { Type: 'AWS::S3::Bucket', ...retained, Properties: {
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        VersioningConfiguration: { Status: 'Enabled' },
        LifecycleConfiguration: { Rules: [{ Id: 'ExpireBuildSources', Status: 'Enabled', ExpirationInDays: 35, NoncurrentVersionExpiration: { NoncurrentDays: 7 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] }
      } },
      SourceBucketPolicy: { Type: 'AWS::S3::BucketPolicy', Properties: {
        Bucket: ref('SourceBucket'), PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [att('SourceBucket', 'Arn'), sub('${SourceBucket.Arn}/*')], Condition: { Bool: { 'aws:SecureTransport': 'false' } } }] }
      } },
      WebRepository: repo('web'), WorkerRepository: repo('worker'),
      BuildLogs: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: sub('/codebuild/${AWS::StackName}'), RetentionInDays: 14 } },
      BuildRole: { Type: 'AWS::IAM::Role', Properties: {
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'codebuild.amazonaws.com' }, Action: 'sts:AssumeRole', Condition: { StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') }, ArnLike: { 'aws:SourceArn': sub('arn:${AWS::Partition}:codebuild:${AWS::Region}:${AWS::AccountId}:project/${AWS::StackName}') } } }] },
        Policies: [{ PolicyName: 'BuildOnly', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: ['s3:GetObject', 's3:GetObjectVersion'], Resource: sub('${SourceBucket.Arn}/source/*') },
          { Effect: 'Allow', Action: ['s3:GetBucketLocation'], Resource: att('SourceBucket', 'Arn') },
          { Effect: 'Allow', Action: ['ecr:GetAuthorizationToken'], Resource: '*' },
          { Effect: 'Allow', Action: ['ecr:BatchCheckLayerAvailability', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload', 'ecr:PutImage', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'], Resource: [att('WebRepository', 'Arn'), att('WorkerRepository', 'Arn')] },
          { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: att('BuildLogs', 'Arn') }
        ] } }]
      } },
      Build: { Type: 'AWS::CodeBuild::Project', Properties: {
        Name: ref('AWS::StackName'), ServiceRole: att('BuildRole', 'Arn'), TimeoutInMinutes: 20, QueuedTimeoutInMinutes: 10, ConcurrentBuildLimit: 1,
        Source: { Type: 'S3', Location: sub('${SourceBucket}/source/source.zip'), BuildSpec: 'deploy/buildspec.yml' },
        Artifacts: { Type: 'NO_ARTIFACTS' },
        Environment: { Type: 'LINUX_CONTAINER', ComputeType: 'BUILD_GENERAL1_SMALL', Image: 'aws/codebuild/standard:7.0', PrivilegedMode: true,
          EnvironmentVariables: [{ Name: 'WEB_REPOSITORY', Value: att('WebRepository', 'RepositoryUri') }, { Name: 'WORKER_REPOSITORY', Value: att('WorkerRepository', 'RepositoryUri') }, { Name: 'IMAGE_TAG', Value: 'set-at-build-start' }] },
        LogsConfig: { CloudWatchLogs: { Status: 'ENABLED', GroupName: ref('BuildLogs') } }
      } },
      Budget: { Type: 'AWS::Budgets::Budget', Properties: {
        Budget: { BudgetName: 'Bayline-account-safety-100', BudgetType: 'COST', TimeUnit: 'MONTHLY', BudgetLimit: { Amount: 100, Unit: 'USD' },
          CostTypes: { IncludeTax: true, IncludeSubscription: true, UseBlended: false, IncludeRefund: false, IncludeCredit: false } },
        NotificationsWithSubscribers: [
          { Notification: { NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', Threshold: 50, ThresholdType: 'PERCENTAGE' }, Subscribers: [{ SubscriptionType: 'EMAIL', Address: ref('AlertEmail') }] },
          { Notification: { NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', Threshold: 80, ThresholdType: 'PERCENTAGE' }, Subscribers: [{ SubscriptionType: 'EMAIL', Address: ref('AlertEmail') }] },
          { Notification: { NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', Threshold: 100, ThresholdType: 'PERCENTAGE' }, Subscribers: [{ SubscriptionType: 'EMAIL', Address: ref('AlertEmail') }] },
          { Notification: { NotificationType: 'FORECASTED', ComparisonOperator: 'GREATER_THAN', Threshold: 100, ThresholdType: 'PERCENTAGE' }, Subscribers: [{ SubscriptionType: 'EMAIL', Address: ref('AlertEmail') }] }
        ]
      } }
    },
    Outputs: {
      InstanceName: { Value: ref('Instance') }, PublicIp: { Value: att('StaticIp', 'IpAddress') },
      BackupBucket: { Value: ref('BackupBucket') }, SourceBucket: { Value: ref('SourceBucket') },
      WebRepository: { Value: att('WebRepository', 'RepositoryUri') }, WorkerRepository: { Value: att('WorkerRepository', 'RepositoryUri') },
      BuildProject: { Value: ref('Build') }
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pass an output JSON path');
  writeFileSync(process.argv[2], JSON.stringify(template(), null, 2));
}
