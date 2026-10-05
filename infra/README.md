# India reference refresh on AWS

Configuration: [`config.json`](./config.json). Region `us-east-2`; repository `p2p-lanes/edge-agent-skill`.

## Architecture

```text
EventBridge Scheduler: rate(15 minutes)
  → CodeBuild: fresh main checkout via existing CodeConnections GitHub App
  → Lambda: Bun 1.4.2, ARM64, provided.al2023, 512 MB, 180s timeout
  → CodeBuild: validated reference-only commit and fast-forward push
```

Lambda receives the prior reference snapshot and returns a complete validated snapshot. It has no GitHub credentials or write permissions, and fetches only approved documentary sources. CodeBuild gets short-lived provider credentials from the existing AWS Connector, using source-level `CODECONNECTIONS` authentication and `git-credential-helper`. It does not alter the account-level CodeBuild credential, which other projects may use.

The existing connector is installed on all `p2p-lanes` repositories. The new CodeBuild role can obtain tokens from only the configured connection; `UseConnection` is restricted to this repository and Git pull/push. `GetConnectionToken` supports connection-level, not repository-level, IAM restrictions. Treat changes to publisher code as privileged and review them before merging. No new permanent GitHub secret is created.

## Deploy

Requirements: Bun **1.4.2**, AWS CLI, `zip`, a clean committed checkout pushed to `main`, and AWS deployment permissions. Docker and ECR are not needed.

```bash
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run aws:deploy
```

The deploy script compiles a Linux ARM64 executable, stores its ZIP in a private encrypted S3 bucket, and deploys two CloudFormation stacks:

- `edge-india-reference-artifacts`: dedicated artifact bucket, HTTPS-only, public access blocked, packages expire after 30 days.
- `edge-india-reference-refresh`: dedicated Lambda, CodeBuild, scheduler, roles, log groups, and CloudWatch failure alarms.

Every deployment sets the schedule to **DISABLED**. Packages and template JSON are generated under ignored `dist/`; never commit credentials or compiled artifacts. The bucket is retained if its stack is deleted. Lambda retains its deployed code even after an artifact expires; deploying uploads the package again.

Indexer and dependency changes must be redeployed. The Lambda code-hash check fails safely until the repository and deployed runtime match.

## Verify before enabling

Run the complete verification sequence (write test, full refresh, and a real one-time scheduled refresh):

```bash
bun run infra/verify.ts
```

The one-time proof schedule auto-deletes and is also cleaned up on errors. The normal 15-minute schedule stays disabled throughout verification. For individual manual checks, first prove GitHub write access without modifying `main`: this creates and deletes a temporary `verify/edge-india-publisher-*` branch with an empty commit.

```bash
aws codebuild start-build --region us-east-2 \
  --project-name edge-india-reference-refresh \
  --environment-variables-override name=REFRESH_MODE,value=verify-write,type=PLAINTEXT
```

Then run two full refresh builds, waiting for each to succeed:

```bash
aws codebuild start-build --region us-east-2 \
  --project-name edge-india-reference-refresh
```

The first may publish real documentary changes; the second must avoid a commit when sources are unchanged. Do not fabricate reference edits to test publication.

Enable after those checks:

```bash
bun run aws:enable
```

The command checks the deployed hash and requires a successful write verification, two successful full refresh builds, and a scheduled-delivery proof after deployment. A failed check leaves scheduling disabled. Rate-based scheduling is best-effort, not a freshness guarantee.

## Operate

```bash
# Pause / resume (resume requires verification after a deployment)
bun run aws:disable
bun run aws:enable

# Inspect schedule
aws scheduler get-schedule --region us-east-2 \
  --group-name edge-india-reference-refresh --name edge-india-refresh-15m

# List recent attempts
aws codebuild list-builds-for-project --region us-east-2 \
  --project-name edge-india-reference-refresh --sort-order DESCENDING

# Logs (14-day retention)
aws logs tail /aws/codebuild/edge-india-reference-refresh --region us-east-2 --since 1h
aws logs tail /aws/lambda/edge-india-public-indexer --region us-east-2 --since 1h
```

Useful events: `publisher-write-verified`, `refresh-generated`, `refresh-no-changes`, `refresh-published`. Source failures, mismatched hashes, malformed snapshots, and concurrent main changes fail the build and leave GitHub references unchanged.

CodeBuild concurrency and Lambda reserved concurrency are both one. Builds time out after 10 minutes; Lambda after 180 seconds. Scheduler retries are disabled to avoid hidden duplicate attempts; the next scheduled run tries again.

CloudWatch alarms `edge-india-refresh-build-failures`, `edge-india-indexer-errors`, and `edge-india-refresh-scheduler-errors` show failures in AWS. Failed scheduler deliveries go to the encrypted queue `edge-india-refresh-delivery-dlq` with 14-day retention; messages are not automatically replayed. They have **no email/paging action configured**; add a notification destination if needed. Logs and metrics remain useful even when source content does not change.

## Costs and rollback

CodeBuild is the main running cost: a 15-minute schedule starts about **96 builds/day**, and builds have a minimum billable duration. Lambda, Scheduler, S3 artifacts, logs, SQS, and alarms also have AWS charges. Review current regional pricing and your free-tier eligibility; this setup is not claimed to be free.

Pause the schedule before rollback. Redeploy the previous code revision with its matching hash, run verification again, then enable. Do not force-push reference history or change shared connection installations, existing pipelines, or global source credentials.

To remove this setup, disable the schedule and delete only the dedicated refresh stack. Artifact bucket deletion is a separate explicit operation because its stack retains the bucket.
