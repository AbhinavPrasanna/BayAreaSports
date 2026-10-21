# Bayline MVP — schedules and scores

Next.js + TypeScript + PostgreSQL, with an independently supervised Node.js worker. The enabled leagues are NBA, NFL, and WNBA; the seeded teams are the Warriors, 49ers, and Golden State Valkyries. NHL/MLS remain disabled until their paid game endpoints are available and tested.

The independent worker fetches and stores schedules/scores for the three free-tier teams. The fan interface includes Today, each followed team's next game, a combined week/day schedule, the last 30 days of results, live snapshots, and game details. Team selections and spoiler protection are saved on the device. No simulated scores are displayed and no paid provider requests are scheduled. NHL/MLS are shown only as coming later.

## Start on this Windows computer

Prerequisites: Node.js 24, npm, and Docker Desktop using Linux containers. Docker Desktop must be running. Dependencies are locked by `package-lock.json`.

The scripts use Next.js's supported Webpack mode because Turbopack junction creation was blocked by the Windows execution sandbox. This does not change the Next.js application model.

From this repository:

```powershell
npm.cmd ci
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

The launcher preserves an existing `.env` or creates one with a random local database password. It loads the previously configured BALLDONTLIE DPAPI key from this task's `work/.secrets/` directory, holds its plaintext only in process memory, and passes it to the worker container. It never prints it or writes it into this repository. The process-scoped execution policy does not change saved system policy.

Open [http://localhost:3000](http://localhost:3000).

Startup order is PostgreSQL healthy → migration completes successfully → web and worker start independently. Restarting `web` does not restart `worker`.

### If the Docker Linux-engine pipe is missing

The launcher checks engine connectivity before setting up `.env`, decrypting the provider key, or starting Compose. The check has a ten-second timeout and requires a Linux engine.

Open Docker Desktop from the Windows Start menu and wait until it reports that the engine is running. Under Settings > General, enable **Use WSL 2 based engine** if that option is visible. If Docker is in Windows container mode, use its tray menu to **Switch to Linux containers**. See [Docker's Windows WSL setup instructions](https://docs.docker.com/desktop/features/wsl/).

In normal PowerShell, confirm:

```powershell
docker info --format '{{.OSType}}'
```

The result must be `linux`. Then rerun the launcher command above. If Docker Desktop cannot start, inspect its displayed error and run `wsl --status` from normal PowerShell. The sandbox's `Wsl/E_ACCESSDENIED` does not establish that your normal Windows session has the same problem.

If the engine check passes but Compose fails, the launcher now saves plain Compose output to `logs/compose-startup.log`, overwriting the previous attempt. The capture removes the configured provider key, database password/URL, and PostgreSQL URL passwords before printing or writing each line. The log is ignored by Git and excluded from Docker build context. It may identify an image pull, image build, port binding, or migration failure; the wrapper's exit code alone cannot identify the cause. For containers that were created, `docker compose ps --all` shows their state. If migration failed, `docker compose logs --tail=30 migrate` shows the migration runner's errors. Do not share rendered Compose configuration or container inspection output.

On startup failure, the launcher automatically appends container status and the most recent 60 lines from the migration and database containers to that same redacted log. Each diagnostic command has a 15-second timeout. Migration failures now report the stage, recognized PostgreSQL/network error code, and a redacted error message, without dumping the raw error object. The standalone environment loader uses the supported named `loadEnvConfig` export from `@next/env`.

## Other computers / shells

```sh
npm ci
npm run setup
# Set BALLDONTLIE_API_KEY through your shell's secure prompt or secret manager.
docker compose up --build -d
```

The API key must be a process environment variable before Compose starts the worker. Do not put it in a `NEXT_PUBLIC_*` variable, a command argument, or a tracked file. The example environment file contains only a commented key placeholder. The web service does not receive or require the provider key. Docker administrators can inspect container environments; this local setup is not a production secret vault.

## Commands

```sh
npm run typecheck
npm test
npm run build
docker compose ps
docker compose logs --tail=30 worker
docker compose restart web
docker compose run --rm migrate
docker compose down
```

`docker compose down` preserves the PostgreSQL volume. Adding `--volumes` deletes stored development data; it is not part of normal shutdown. Do not print `docker compose config` or `docker inspect` while a provider key is in the environment; use `docker compose config --quiet` for validation.

For host-based debugging, `npm run dev` starts Next.js, `npm run worker:dev` starts only the worker, and `npm run db:migrate` applies migrations using the local `DATABASE_URL`. These commands need an explicitly published database port as described below. Each process must load the environment it needs. Docker Compose is the supported one-command path for the encrypted Windows key.

## Layout

```text
src/app/                         Next.js App Router and read-only HTTP routes
src/components/                  Reusable UI components
src/shared/games.ts              Normalized types and free-tier team catalog
src/server/config/               Validation and Node-process environment loading
src/server/db/                   PostgreSQL pool and repositories
src/server/providers/types.ts    Provider interface
src/server/providers/balldontlie/ Per-league normalization and authenticated adapter
src/server/ingestion/             Rate control, pagination, transactional snapshots, scheduling
src/worker/main.ts               Independent ingestion scheduler and heartbeat entry point
migrations/                     Ordered immutable SQL migrations
scripts/                        Setup, migration runner, Windows launcher
tests/                          Configuration/security and normalization checks
```

The client-safe shared module contains no credentials or database imports. Provider and database code stay under `src/server`; Next-only repository modules use `server-only` to reject client imports. The worker shares plain Node-compatible server modules.

## Configuration

- `DATABASE_URL`: required PostgreSQL URL. Web, migration, and worker startup validate it; invalid-value errors include field names only.
- `BALLDONTLIE_API_KEY`: worker-only, required and nonempty. No API calls occur during configuration checks.
- `ENABLED_LEAGUES`: unique comma-separated subset of `nba,nfl,wnba`; defaults to all three. Paid leagues are rejected by this milestone.
- `WORKER_INTERVAL_SECONDS`: integer from 60 to 3600; defaults to 60. Target interval between successful checks for each league. Rate-limit waits, pagination, and failure backoff can delay checks.
- `POSTGRES_PASSWORD`: local Compose database password, generated by `npm run setup`.

The web uses Next instrumentation for startup checks. The worker validates independently, acquires a PostgreSQL session advisory lock, and writes `worker_heartbeats`. Ingestion and request reservations use that same database session, so losing ownership also stops writes. It handles SIGINT/SIGTERM and does not use overlapping async intervals.

## Scheduled ingestion

- Every enabled league targets one successful check per minute by default. Each query covers 45 days back and 30 days ahead, with UTC date padding for Pacific evening games.
- All provider calls, including cursor pages, reserve a persistent PostgreSQL request slot at least 14 seconds apart across the three leagues. This is conservative against the provider's documented [five-request-per-minute free allowance](https://www.balldontlie.io/account/). Other apps using the same key can still consume that allowance.
- HTTP 429 honors `Retry-After` with at least a one-minute delay and pauses shared provider traffic. HTTP 401/403 backs off for 15 minutes; other failures use exponential backoff capped at 30 minutes. No subscription is activated.
- Each complete league fetch validates every page and team ID before writing. A transaction upserts opponent names, games, league freshness, and run completion. Failed fetches or writes preserve the last successful snapshot.
- Games are keyed by `(league, provider_id)`. Replays update existing rows, including corrected scores/status/start times. `observed_at` is our last successful observation; `changed_at` advances only when game fields change. Neither claims upstream event latency.
- Cursor loops and more than 10 pages fail safely. A request has a 15-second timeout. Interrupted runs are marked on the next worker startup; schedule and request-spacing state survive restarts.

The browser reads cached database snapshots every 15 seconds while visible and online. It refetches immediately on reconnection, window focus, or return to the tab. Filtering or pressing Refresh does not call the sports provider. Background refreshes retain the visible game's scroll position and preserve successful snapshots when a request fails. The worker's independent provider schedule still targets about one minute; a 15-second page refresh does not guarantee 15-second upstream scores.

Today and the combined schedule use America/Los_Angeles dates, including daylight saving changes, with times explicitly labeled Pacific. Choose teams saves a device-local lineup, including an empty lineup. Spoiler protection removes scores, clocks, and winner styling from rendered game cards and details until individually revealed; it is a display preference, and the cached API still returns scores. Reveals reset after reload. Details open in a keyboard-accessible dialog with Escape, focus return, and background scroll restoration. The free feed does not supply full box scores or play-by-play.

Scores display only for live, final, or suspended games; scheduled/canceled zero placeholders remain dashes. Scheduled, live, final, postponed/delayed, suspended, canceled, and unknown states have explicit labels. Game clocks do not count down between source checks. Stale/error notices preserve cached games and distinguish a quiet schedule from an update failure.

## Database and migration behavior

The first migration seeds the three verified free teams and creates heartbeat/run tables. Migration `002_game_ingestion.sql` adds game snapshots, opponent abbreviations, league ingestion state, and persistent request spacing. Opponents are stored as disabled teams; the followed-team API still returns only the three Bay Area teams. No provider payload is required to migrate. The runner uses a separate advisory lock, applies each migration transactionally, and records a SHA-256 checksum. Re-running is safe; editing an applied migration is rejected. Add a new SQL file for a new schema change.

PostgreSQL is reachable by the Compose services at `db:5432`; the default stack publishes no host database port. This avoids Windows restrictions or conflicts on host port 5432. The web binds to `127.0.0.1:3000`. The existing database volume and password are preserved when the database container is recreated.

To inspect data without publishing any port, use `docker compose exec db psql -U bayline -d bayline`.

If you specifically need host-side database tools or Node processes, enable the optional mapping with `docker compose -f compose.yaml -f compose.host-db.yaml up -d db`. It binds `127.0.0.1:15432` by default; set `LOCAL_DB_PORT` to another available port if necessary. Set the host process's `DATABASE_URL` to that same port, using the existing database password. New `.env` files use 15432 as this optional host URL; existing `.env` files are preserved and may still specify 5432. None of these host URL settings change the Compose services' internal `db:5432` connection. The normal launcher does not load the optional mapping file.

## Checks available in this milestone

- `GET /api/health`: database reachability; HTTP 503 on failure without connection details.
- `GET /api/teams`: enabled seeded teams from PostgreSQL, never a direct provider request.
- `GET /api/games?league=all&view=all&from=2026-10-19&to=2026-10-25`: saved game snapshots, per-league last-success/error/retry metadata, and worker heartbeat. `league` is `all|nba|nfl|wnba`; `view` is `all|results|live|upcoming`. Dates must be valid ISO calendar dates spanning at most 31 inclusive days. Date grouping uses America/Los_Angeles; invalid queries return 400 and database failures return a sanitized 503. Responses are not browser/CDN cached.
- `GET /api/games/{league}/{providerId}`: one stored game, even outside the current schedule date window. Only enabled free-tier games involving a followed Bay Area team are returned. Invalid/missing IDs return 404, database failures return a sanitized 503, and responses are not cached. Details never call the provider.
- Worker heartbeat: inspect `worker_heartbeats.last_seen_at` or bounded worker logs.
- Adapter methods validate provider responses, preserve null scores and unknown statuses, and do not expose raw error payloads. A score snapshot is not complete play-by-play.

No AWS resources, public site, scheduled automation, paid API plan, or remote Git repository is created by this scaffold. Compose and its development Dockerfile are for local development; production hardening and deployment remain separate.

Tests include an in-memory PostgreSQL engine (PGlite, development dependency only) to execute the real migrations, transactional upserts, Pacific-date queries, corrections, rollback, league-scoped IDs, request reservation, and cached-data preservation. No tests call a paid or live provider endpoint.

See [VERIFICATION.md](VERIFICATION.md) for completed checks and runtime verification limits.

## Production deployment and recovery

The production Docker targets are `web` (Next.js standalone) and `worker` (compiled Node.js worker/migrations). `deploy/compose.production.yaml` consumes prebuilt images pinned by digest, has no source mounts or PostgreSQL host port, and puts Caddy on the public edge. Secrets are supplied through restricted host files. See [deploy/RUNBOOK.md](deploy/RUNBOOK.md) for AWS provisioning, launch gates, backup/restore operations, crash tests, and server-loss recovery. Production readiness is separate from the local development Compose stack.
