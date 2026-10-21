# Production deployment — October 21, 2026

Live app: **https://baylinescore.com/** (singular "score"). The user registered this exact domain in Route 53. `https://www.baylinescore.com/` redirects to the primary domain with HTTP 308 and preserves paths/query strings. The retained static IP `44.224.200.231` also continues to serve the app for existing bookmarks and recovery.

## Custom-domain launch — October 21, 2026

Registration was verified ACTIVE and its registrar nameservers matched public hosted zone `Z0972724104F8MLFVSCZ7`. The apex A record points to `44.224.200.231`; `www` is a CNAME to `baylinescore.com`; both TTLs are 300 seconds. The Route 53 change reached INSYNC, and independent public DNS resolution returned the expected address. The declarative records are saved in `aws/domain-records.json`.

Production uses `APP_DOMAIN=baylinescore.com` and `CADDY_CONFIG=./Caddyfile.bayline`. The new Caddy configuration was validated using the deployed Caddy image before replacing only that container. Web, worker and database container IDs/start times were unchanged. The domain has a trusted public certificate expiring January 19, 2027, with Caddy automatic renewal. Public page/readiness checks returned HTTP 200; HTTP redirects to HTTPS, and the HTTPS `www` redirect preserved `/api/ready?check=domain`. Browser verification passed; screenshot: `preview/custom-domain.png`.

The monitor stack update completed with Endpoint `baylinescore.com`; a real Lambda invocation returned healthy with about 90 certificate days remaining, and the uptime alarm was OK. Keep this hostname when restoring the server, retain/reassign the static IP and restore this Caddyfile with the other deployment files. Source/configuration and proof are archived off-server under the domain release reference recorded with the release.

The Route 53 hosted zone adds $0.50/month plus queries, and domain registration/renewal is an annual charge. These global DNS/registration costs are outside the existing Oregon service-filtered budget and need allowance alongside it; total expected MVP usage remains below $100/month. Browser-local team/spoiler preferences are scoped separately to the new domain and the old IP origin.

## Latest web release — simplified navigation

On October 21, removed the top "Your teams" link and its obsolete mobile hiding rule. The current web image is `sha256:12772a43df6c9bc2a13b610566eac712e1d3e16916096b7db2d2d9c7c0f9ccb6`, built from commit `392eac918a2d` by successful CodeBuild `bayline-mvp-prod:5357b11b-cb6b-4010-a5b6-cafbdeb7762c`. Node base images now use the AWS Public ECR Docker Library mirror after Docker Hub returned HTTP 429. Only the web container was recreated; worker and database container IDs/start times were preserved. Public readiness passed. Browser checks confirmed the main navigation contains only Scoreboard on desktop and at 390 pixels; screenshot: `preview/navigation-phone.png`. Source and release evidence are retained under `releases/392eac918a2d/` in the private backup bucket.

## Previous web release — supplied hero artwork

On October 21, the web image was updated from application commit `6220c74` to `sha256:91828b2643cda1d90ad4744f7e37dd9c9a26ae4fff813659e669085d4c93b0fd`. CodeBuild `bayline-mvp-prod:992c56f4-6a89-4e31-8ed0-eae10ccea574` passed the production build and checks. Only the web container was recreated; worker and database container IDs and start times were unchanged. Public readiness remained healthy after deployment. The initial web digest below is retained for rollback; the worker/migration digest is still current.

The deployed PNG matches the supplied image (SHA-256 `6539d1402cc72efa3f690c2ae1e6e06b61aed8ec49681b6bc2168220a8ba2b1c`). Responsive Next.js optimization returned a 39,316-byte WebP at 640 pixels. Browser checks at 1440 and 390 pixels confirmed the image loads without horizontal overflow and displays all three logos. Screenshots: `preview/hero-desktop.png` and `preview/hero-phone.png`. Source and deployment evidence are retained off-server under `releases/6220c74/`.

## Running infrastructure

- Region: `us-west-2` (Oregon). Regional stack: `bayline-mvp-prod`; server: `bayline-mvp-prod-01`, Ubuntu 24.04, Lightsail `medium_3_0`, $24/month, attached static IPv4.
- The initial prebuilt web and worker images were built in CodeBuild from application commit `48f0ab50bfa8`; the latest web image is recorded above. The server only pulls/runs them; it does not compile the app. Images are deployed by digest. The later host-operation and monitoring changes are separate deployment files.
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
