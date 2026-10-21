# Production deployment — October 21, 2026

Live app: **https://44.224.200.231/**. A custom domain is optional and remains the user's choice; none was purchased. Public HTTPS uses a trusted Let's Encrypt IP certificate, not a self-signed certificate. The certificate is automatically renewed by Caddy, and independent monitoring checks its identity, trust and remaining lifetime.

## Running infrastructure

- Region: `us-west-2` (Oregon). Regional stack: `bayline-mvp-prod`; server: `bayline-mvp-prod-01`, Ubuntu 24.04, Lightsail `medium_3_0`, $24/month, attached static IPv4.
- Separate prebuilt web and worker images were built in CodeBuild from application commit `48f0ab50bfa8`. The server only pulls/runs them; it does not compile the app. Images are deployed by digest. The later host-operation and monitoring changes are separate deployment files.
- Only Caddy publishes 80/443. Public probes reached those ports and could not reach 3000 or 5432. PostgreSQL has only the private internal container network. SSH is restricted to the operator's IPv4 /32.
- Web and worker run separately as non-root users, with read-only filesystems, resource limits and container restart policies. Migration is a one-shot service. The provider key is mounted only into the worker; no key was stored in an image, archive, Git or browser. Database/provider secrets are root-managed files.
- IMDSv2 is required with hop limit 1. Host backup access through the instance's bucket attachment works; app containers do not receive AWS credentials.
- Docker logs rotate at three 10 MB files per container. Journald is capped at 100 MB. Systemd starts the stack on boot; backup, restore and watchdog timers are active.

## Verified recovery evidence

- Off-server backup upload/download SHA-256 verification passed. The first dump was 14,196 bytes and a later post-reboot backup was 15,699 bytes. The private Lightsail bucket has versioning enabled and disallows public overrides.
- Before public launch, restored `postgres/20261021T081941Z-872ee5af1286.json` into **`bayline_restore_20261021082013`**, separately from the live database. Verified the recovery canary, three migrations, three enabled teams and **44 stored games**. Dump SHA-256: `82d2036a38b6220c163e68c410144b89505b7ac489d19592b545491c947db6d7`.
- Forced web, worker and PostgreSQL process termination independently. Each container's restart count increased from 0 to 1, health recovered and data/canary persisted. The web failure did not restart the worker.
- Rebooted the whole server. The boot ID changed, the stack and all three timers returned active, and the database still contained **44 games**. Public readiness returned HTTP 200 with worker, feeds, backup and restore checks all true.
- Performed a controlled 170-second web outage with an automatic restart and an independent four-minute failsafe restart. On October 21 in Pacific time, CloudWatch changed **OK → ALARM at 1:35:53 AM**, then **ALARM → OK at 1:37:53 AM**. AWS recorded successful SNS notification actions for both transitions. The alert email subscription is confirmed; inbox receipt was not inspected.
- Public API checks passed for health, readiness, all three teams, today's two games and game details. Trusted certificate validation passed for the IP SAN. The public phone layout and details were checked at 390×844; screenshots are in `preview/production-phone.png` and `preview/production-phone-details.png`.
- The build passed all 40 TypeScript/application tests in Linux. Four Python recovery guard tests passed on the server, including rejection of corrupted backups and refusal to promote over a populated live database. Production Compose topology/image/restart/logging/secret-isolation validation passed.

## Monitoring, backups and costs

`bayline-mvp-monitor` runs an independent Lambda once a minute. It requests `/api/ready` with full TLS verification, requires over 48 hours of certificate validity and publishes a `Bayline/Healthy` metric. Two failed minutes or missing metric data trigger the CloudWatch alarm. Alarm and recovery actions go to the configured email through SNS. Final observed state: **OK**.

Backups run every six hours, retain 35 days, and mark success only after an off-server checksum round trip. A restore drill runs monthly into a new separate database. A two-minute watchdog restarts running containers that become unhealthy. Backup freshness, ingestion freshness and restore-drill freshness are included in readiness, so operational failures also reach the external alarm.

Expected Bayline operating cost: **$30–40/month**, with the $24 instance as the main fixed charge. The $100 AWS budget sends actual alerts at $50/$80/$100 and a forecast alert at $100. Its service/region filter covers the app's Oregon Lightsail, ECR, CodeBuild, Lambda, CloudWatch, SNS, S3 and EventBridge usage. It may include other projects sharing those services in Oregon, while excluding unrelated RDS/EC2/network charges. Billing alerts lag and are not a hard spending cutoff. Annual domain purchases, taxes and exceptional usage need their own allowance. No existing unrelated resources were stopped or modified.

The Windows development worker was stopped before production ingestion began, preventing duplicate consumption of the free provider quota. Production continues to check only NBA, NFL and WNBA; page refreshes read cached scores every 15 seconds.

## Recovery procedure and release references

Follow [RUNBOOK.md](RUNBOOK.md), especially **Recovery from total server loss**. The recovery path uses retained images, a private off-server dump, a replacement host, verified restoration into a separate database and guarded promotion into an empty target. RPO target is six hours plus job duration; RTO target is one to two hours. A full replacement-host loss drill has **not** been measured; the separate-database restore, forced crashes and complete host reboot have been proven.

App image digests:

- Web: `sha256:f6a2abde322623a2940b947071e16f74f73a01c65850de30d8ecff9616c14902`
- Worker/migration: `sha256:7b56311b69d588cb0edb0a51c1a21ea848216a7bad41bcdc9aa364856142e3ed`
- PostgreSQL 17: `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`
- Caddy 2.11.7: `sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f`

Full private release settings, raw verification results and a source/recovery archive are saved off-server under the backup bucket's `releases/` prefix. Get the bucket/repository names with `aws cloudformation describe-stacks --stack-name bayline-mvp-prod --region us-west-2`. This avoids depending on the failed server or local Docker cache for recovery. The files under ignored `deploy/evidence/` are local copies of that evidence, not credentials.
