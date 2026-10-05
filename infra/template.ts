import config from "./config.json";
const ref = (name: string) => ({ Ref: name });
const sub = (value: string) => ({ "Fn::Sub": value });
const arn = (name: string) => ({ "Fn::GetAtt": [name, "Arn"] });
const statement = (Action: string[], Resource: unknown, extra = {}) => ({ Effect: "Allow", Action, Resource, ...extra });
const trust = (service: string, source?: unknown) => ({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: service }, Action: "sts:AssumeRole", ...(source ? { Condition: { StringEquals: { "aws:SourceAccount": ref("AWS::AccountId") }, ArnEquals: { "aws:SourceArn": source } } } : {}) }] });
const policy = (name: string, statements: unknown[]) => [{ PolicyName: name, PolicyDocument: { Version: "2012-10-17", Statement: statements } }];
const tags = [{ Key: "Project", Value: "edge-india-docs" }];
const lambdaLog = `/aws/lambda/${config.functionName}`;
const buildLog = `/aws/codebuild/${config.projectName}`;
const logsArn = (name: string) => sub(`arn:\${AWS::Partition}:logs:\${AWS::Region}:\${AWS::AccountId}:log-group:${name}:*`);
const buildArn = sub(`arn:\${AWS::Partition}:codebuild:\${AWS::Region}:\${AWS::AccountId}:project/${config.projectName}`);

export const artifactsTemplate = {
  AWSTemplateFormatVersion: "2010-09-09",
  Description: "Private artifacts for the India-only Bun indexer",
  Resources: {
    Artifacts: {
      Type: "AWS::S3::Bucket", DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain",
      Properties: {
        BucketName: sub("edge-india-indexer-artifacts-${AWS::AccountId}-${AWS::Region}"),
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] },
        LifecycleConfiguration: { Rules: [{ Id: "ExpireOldPackages", Status: "Enabled", ExpirationInDays: 30 }] },
        Tags: tags,
      },
    },
    BucketPolicy: { Type: "AWS::S3::BucketPolicy", Properties: { Bucket: ref("Artifacts"), PolicyDocument: {
      Version: "2012-10-17", Statement: [{ Effect: "Deny", Principal: "*", Action: "s3:*", Resource: [arn("Artifacts"), sub("${Artifacts.Arn}/*")], Condition: { Bool: { "aws:SecureTransport": "false" } } }],
    } } },
  },
  Outputs: { Bucket: { Value: ref("Artifacts") } },
};

export const refreshTemplate = {
  AWSTemplateFormatVersion: "2010-09-09",
  Description: "India reference refresh: EventBridge Scheduler, CodeBuild publisher, Bun Lambda",
  Parameters: {
    ArtifactBucket: { Type: "String" }, ArtifactKey: { Type: "String" }, IndexerHash: { Type: "String", AllowedPattern: "[a-f0-9]{64}" },
    ConnectionArn: { Type: "String", Default: config.connectionArn },
    ScheduleState: { Type: "String", Default: "DISABLED", AllowedValues: ["DISABLED", "ENABLED"] },
  },
  Resources: {
    LambdaLog: { Type: "AWS::Logs::LogGroup", Properties: { LogGroupName: lambdaLog, RetentionInDays: 14, Tags: tags } },
    BuildLog: { Type: "AWS::Logs::LogGroup", Properties: { LogGroupName: buildLog, RetentionInDays: 14, Tags: tags } },
    LambdaRole: { Type: "AWS::IAM::Role", Properties: {
      AssumeRolePolicyDocument: trust("lambda.amazonaws.com"), Tags: tags,
      Policies: policy("OnlyOwnLogs", [statement(["logs:CreateLogStream", "logs:PutLogEvents"], logsArn(lambdaLog))]),
    } },
    Indexer: { Type: "AWS::Lambda::Function", DependsOn: "LambdaLog", Properties: {
      FunctionName: config.functionName, Runtime: "provided.al2023", Handler: "bootstrap", Architectures: ["arm64"],
      MemorySize: 512, Timeout: 180, ReservedConcurrentExecutions: 1, Role: arn("LambdaRole"),
      Code: { S3Bucket: ref("ArtifactBucket"), S3Key: ref("ArtifactKey") },
      Environment: { Variables: { INDEXER_CODE_HASH: ref("IndexerHash") } }, Tags: tags,
    } },
    BuildRole: { Type: "AWS::IAM::Role", Properties: {
      AssumeRolePolicyDocument: trust("codebuild.amazonaws.com", buildArn), Tags: tags,
      Policies: policy("OnlyRefreshResources", [
        statement(["logs:CreateLogStream", "logs:PutLogEvents"], logsArn(buildLog)),
        statement(["lambda:InvokeFunction"], arn("Indexer")),
        statement(["codeconnections:GetConnection", "codeconnections:GetConnectionToken"], ref("ConnectionArn")),
        statement(["codeconnections:UseConnection"], ref("ConnectionArn"), { Condition: { StringEquals: { "codeconnections:FullRepositoryId": config.repository, "codeconnections:ProviderAction": ["GitPull", "GitPush"] } } }),
      ]),
    } },
    Publisher: { Type: "AWS::CodeBuild::Project", DependsOn: "BuildLog", Properties: {
      Name: config.projectName, Description: "Dedicated India-only publisher; Lambda performs all documentary fetching",
      ServiceRole: arn("BuildRole"), ConcurrentBuildLimit: 1, TimeoutInMinutes: 10, QueuedTimeoutInMinutes: 10,
      SourceVersion: "main", Artifacts: { Type: "NO_ARTIFACTS" },
      Source: { Type: "GITHUB", Location: `https://github.com/${config.repository}.git`, GitCloneDepth: 1, ReportBuildStatus: false,
        Auth: { Type: "CODECONNECTIONS", Resource: ref("ConnectionArn") },
        BuildSpec: "infra/buildspec.yml",
      },
      Environment: { Type: "LINUX_CONTAINER", ComputeType: "BUILD_GENERAL1_SMALL", Image: "aws/codebuild/standard:7.0", PrivilegedMode: false,
        EnvironmentVariables: [
          { Name: "INDEXER_FUNCTION_NAME", Value: ref("Indexer"), Type: "PLAINTEXT" },
          { Name: "REFRESH_MODE", Value: "publish", Type: "PLAINTEXT" },
        ],
      },
      LogsConfig: { CloudWatchLogs: { Status: "ENABLED", GroupName: buildLog, StreamName: "refresh" } }, Tags: tags,
    } },
    DeliveryQueue: { Type: "AWS::SQS::Queue", Properties: {
      QueueName: "edge-india-refresh-delivery-dlq", SqsManagedSseEnabled: true, MessageRetentionPeriod: 1209600, Tags: tags,
    } },
    ScheduleGroup: { Type: "AWS::Scheduler::ScheduleGroup", Properties: { Name: config.scheduleGroup, Tags: tags } },
    SchedulerRole: { Type: "AWS::IAM::Role", Properties: {
      AssumeRolePolicyDocument: trust("scheduler.amazonaws.com", arn("ScheduleGroup")), Tags: tags,
      Policies: policy("OnlyStartRefresh", [statement(["codebuild:StartBuild"], arn("Publisher")), statement(["sqs:SendMessage"], arn("DeliveryQueue"))]),
    } },
    Schedule: { Type: "AWS::Scheduler::Schedule", Properties: {
      Name: config.scheduleName, GroupName: ref("ScheduleGroup"), State: ref("ScheduleState"),
      ScheduleExpression: "rate(15 minutes)", ScheduleExpressionTimezone: "UTC", FlexibleTimeWindow: { Mode: "OFF" },
      Target: { Arn: sub("arn:${AWS::Partition}:scheduler:::aws-sdk:codebuild:startBuild"), RoleArn: arn("SchedulerRole"),
        Input: JSON.stringify({ ProjectName: config.projectName }), DeadLetterConfig: { Arn: arn("DeliveryQueue") },
        RetryPolicy: { MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 900 } },
    } },
    SchedulerFailureAlarm: { Type: "AWS::CloudWatch::Alarm", Properties: {
      AlarmName: "edge-india-refresh-scheduler-errors", Namespace: "AWS/Scheduler", MetricName: "TargetErrorCount",
      Dimensions: [{ Name: "ScheduleGroup", Value: ref("ScheduleGroup") }], Statistic: "Sum", Period: 900,
      EvaluationPeriods: 1, Threshold: 1, ComparisonOperator: "GreaterThanOrEqualToThreshold", TreatMissingData: "notBreaching",
    } },
    BuildFailureAlarm: { Type: "AWS::CloudWatch::Alarm", Properties: {
      AlarmName: "edge-india-refresh-build-failures", AlarmDescription: "India refresh failed; valid references remain published. Inspect dedicated CodeBuild logs.",
      Namespace: "AWS/CodeBuild", MetricName: "FailedBuilds", Dimensions: [{ Name: "ProjectName", Value: ref("Publisher") }],
      Statistic: "Sum", Period: 900, EvaluationPeriods: 1, Threshold: 1, ComparisonOperator: "GreaterThanOrEqualToThreshold", TreatMissingData: "notBreaching",
    } },
    LambdaFailureAlarm: { Type: "AWS::CloudWatch::Alarm", Properties: {
      AlarmName: "edge-india-indexer-errors", Namespace: "AWS/Lambda", MetricName: "Errors",
      Dimensions: [{ Name: "FunctionName", Value: ref("Indexer") }], Statistic: "Sum", Period: 900,
      EvaluationPeriods: 1, Threshold: 1, ComparisonOperator: "GreaterThanOrEqualToThreshold", TreatMissingData: "notBreaching",
    } },
  },
  Outputs: {
    Function: { Value: ref("Indexer") }, Project: { Value: ref("Publisher") }, Schedule: { Value: ref("Schedule") },
    ScheduleGroup: { Value: ref("ScheduleGroup") }, ScheduleState: { Value: ref("ScheduleState") }, IndexerHash: { Value: ref("IndexerHash") },
    DeliveryQueue: { Value: ref("DeliveryQueue") },
  },
};
