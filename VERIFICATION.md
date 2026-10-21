# Verification

## Production deployment — October 21, 2026

The app is live at **https://44.224.200.231/** on the $24/month Lightsail instance. Public trusted HTTPS, private PostgreSQL networking, prebuilt digest-pinned images, off-server backups, an isolated restore of 44 games, forced crash recovery for all three app/data processes, a full host reboot, and external ALARM → OK notifications have been verified. The latest application suite has 40 tests; four additional Python recovery guard tests passed on Linux. See [deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md) for evidence and limits, and [deploy/RUNBOOK.md](deploy/RUNBOOK.md) for server-loss recovery.

The historical local-development checks below describe the earlier MVP milestones. Local Docker access is still restricted in the shell sandbox; production verification used AWS CodeBuild and SSH to the Lightsail host. The development worker was stopped when production ingestion started.

## Completed

- Installed dependencies and generated `package-lock.json`.
- Initialized a local Git repository on `main`.
- Created a local ignored `.env` with a generated database password; no provider key is saved in it.
- TypeScript: `npm.cmd run typecheck` passed.
- Tests: `npm.cmd test` passed all 34 tests, including real PostgreSQL SQL execution through PGlite: migration application, upserts, score corrections, idempotent replay, league-scoped IDs, atomic rollback, request-slot reservation, and cached-game preservation after provider failures. Additional checks cover cursor pagination/loops, cancellation, rate-limit backoff, API validation, Pacific/DST dates, placeholder scores, credential redaction, and standalone startup.
- Fan tests cover preference parsing and empty selections, next-game selection, removing protected scores/winner styling from rendered cards, 15-second polling and visibility/online/focus recovery, listener cleanup, and anchor-based scroll restoration when content is inserted or removed. SQL tests also verify game lookup by ID outside the schedule date window and missing IDs.
- Final production build passed using Webpack with `$env:NEXT_BUILD_DIR='.next-fan-final'; npm.cmd run build -- --debug`. Routes include `/`, `/api/games`, `/api/games/[league]/[id]`, `/api/health`, and `/api/teams`. Reusing an existing verification cache hit a Windows `EPERM` directory-creation error; a fresh isolated build completed successfully. Generated `.next-*` directories are ignored by Git and Docker.
- Compose: `docker compose config --quiet` passed without displaying interpolated configuration.
- Host Next.js process reached its Ready state without receiving a provider key.
- Docker preflight correctly rejects the unavailable engine with bounded execution and recovery instructions; the updated PowerShell launcher passes syntax validation.
- The Compose output capture was exercised against the sandbox's Docker permission error: output and exit status were saved to the ignored startup log. The PowerShell wrapper now reports the log path instead of claiming every Compose failure means Docker Desktop is stopped.
- Reproduced the migration startup bug locally: the default `@next/env` import was undefined in the standalone tsx process. Replaced it with the named `loadEnvConfig` import used in the official Next.js documentation. A regression test confirms standalone loading and preservation of a Compose-supplied database URL. A controlled connection attempt to an unavailable diagnostic port now reaches the database-connect stage and produces a safe error instead of crashing in configuration.
- The user's latest Compose output confirms successful startup (exit code 0): PostgreSQL healthy, migration completed, web and worker started.
- Browser verification: `http://localhost:3000/` renders the full Bayline scoreboard with stored game cards for all three free-tier teams, actual completed scores, and hidden upcoming score placeholders.
- Browser verification: `/api/health` returns `{"status":"ok","database":"reachable"}`.
- Browser verification: `/api/teams` returns Warriors/NBA/10, 49ers/NFL/30, and Valkyries/WNBA/13 from PostgreSQL.
- Browser verification: `/api/games?view=live` returned healthy league states with no error codes, a recent worker heartbeat, and 44 fetched games across the ingestion window: NBA 16, NFL 9, WNBA 19. Counts will change as the rolling window and provider data change.
- Observed league last-check times advance across multiple refreshes, confirming continued scheduled ingestion after startup.
- Interactive browser checks passed: Warriors-only filter; combined final results; empty live-games state; selection of a single day; next-week navigation; and return to the current week. The screenshot is saved in `preview/scoreboard.png`.
- Fan experience verified against the running Docker app at 390×844 and 320×720 viewport sizes. Today shows the followed teams' next games with Pacific dates/times. Both layouts fit without horizontal overflow; primary controls measure at least 44px high, and the narrow calendar buttons measure approximately 64×58px.
- Opened next-game and completed-game details on the phone layout; verified matchup/time/status, score reveal/hide consistency, Escape dismissal, trigger focus return, and fitting dialogs. At 320×720, team preferences fit with all controls accessible.
- Unfollowed Valkyries, reloaded, and confirmed only Warriors/49ers remained in the lineup and next-game list. Restored all three teams. Enabled spoiler protection, checked combined results contained only dashes and no winner styling, revealed one completed game, and hid it again from its detail dialog. Reload confirmed spoiler protection remained enabled. Restored the original all-three/scores-visible preferences after QA.
- Real browser polling check: over a 17-second observation the scoreboard refresh counter advanced from 2 to 3 while scrollY remained 1637 and the visible game-card tops remained exactly 2.765625, 339.546875, and 676.328125 pixels. Cached scores remained hidden during refresh. Screenshots: `preview/phone-today.png` and `preview/phone-details.png`. Temporary viewport overrides were reset after testing.
- Enabled `WATCHPACK_POLLING` for the local web container so Windows bind-mounted source changes refresh reliably. The user recreated only the web container for this setting.

## Runtime verification limits

Docker Desktop/WSL remain inaccessible from the shell sandbox: `wsl --status` returned `Wsl/E_ACCESSDENIED`, and the Docker Linux-engine pipe returns permission denied. The user successfully ran the launcher from normal PowerShell, including migration 002. The application API confirms stored games, league refresh success, and a fresh worker heartbeat. A direct Docker-based test of worker survival across a web-only restart is still unverified from this chat.

Shell HTTP probes return `EACCES`. The in-app browser can reach the user's Docker app on port 3000 and was used for runtime and phone-viewport verification. An additional sandbox-hosted preview on port 3001 could not be reached from the browser and was stopped. Viewport emulation is not testing on a physical iOS/Android device. Offline/online, hidden-tab, and focus recovery were tested through the injectable lifecycle environment; browser network-disconnection emulation was unavailable.

Turbopack's first build attempt failed because the sandbox denied junction creation. The repository now uses supported Webpack flags for development and builds, and that production build succeeded.

## Optional additional operational checks from normal PowerShell

1. Open Docker Desktop and wait until its Linux engine is running.
2. Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1` from the repository.
3. Confirm `docker compose ps --all`: database healthy, migration exited with code 0, web and worker running.
4. Fetch `http://localhost:3000/api/health` and confirm HTTP 200; fetch `/api/teams` and confirm exactly NBA/Warriors, NFL/49ers, WNBA/Valkyries.
5. Run `docker compose run --rm migrate` again and confirm no duplicate migration/seed rows.
6. Run `docker compose exec db psql -U bayline -d bayline -c "SELECT * FROM worker_heartbeats;"` and note the heartbeat.
7. Restart only `web`, wait at least one worker interval, then confirm the worker's container start time is unchanged and its heartbeat advanced.

The worker runs in `game_ingestion` mode and makes only NBA/NFL/WNBA game requests. Successful league checks target a 60-second interval, requests are globally spaced at least 14 seconds apart, and the browser refreshes saved snapshots every 15 seconds while visible and online. No live target game was in progress during browser QA, so upstream score latency and changing live clocks have not been measured. No NHL/MLS request or paid subscription activation was performed.
