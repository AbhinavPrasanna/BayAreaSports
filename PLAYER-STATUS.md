# Current player status
## Live Warriors and 49ers icon selector

Two labeled icon buttons directly on Injury Report select Warriors or 49ers. Warriors is selected initially; only the selected team's cached roster/report is shown. The selected button has a visible outline/background and `aria-pressed` state. Both reports are accessible here independently of the scoreboard's followed-team preferences. Switching teams resets search/filter/reveal state so a newly selected team stays protected when spoiler protection is enabled. Automatic refresh keeps the selected team. Existing game-details reports, API data, provider schedule and subscriptions are unchanged.

Source `a1ee91c807b0` was deployed on October 23, 2026. Typechecking and the production build passed. Live checks verified Warriors as the initial selection (18 players), switching to 49ers (89 players), switching back, player search, injury filtering and a single visible team. Selection and search survived refresh. With spoiler protection enabled, switching from a revealed team hid the newly selected roster until explicit reveal. Both icon buttons fit at 320 and 390 pixels without horizontal overflow. No browser console errors were observed; public readiness passed. Screenshot: `preview/injury-team-icons-live-phone.png`. Worker/database containers stayed unchanged and backup `postgres/20261023T191237Z-08811d94986a.json` was verified. See [DEPLOYMENT.md](deploy/DEPLOYMENT.md) for image/recovery references.

## Navigation release history

The October 23, 2026 web release added **Injury Report** beside **Scoreboard** in the top navigation. It opens `/#injury-report` without requiring a scheduled game. The shared roster/report display supports all followed teams or the existing sidebar team filter, player search, injury/availability filters, delayed-report notices and independent spoiler reveal. Switching back to Scoreboard retains its view and score-protection preference. Direct links, reload and browser Back select the correct tab.

`GET /api/player-status` reads the existing migration-008 cache for the three followed teams, with `Cache-Control: no-store` and a bounded error response. It does not call BALLDONTLIE. The page uses the existing 15-second visible refresh, reconnect handling and scroll preservation. WNBA remains explicitly unavailable; no new provider subscription, migration or worker change is required.

Local typechecking, all **71 tests**, the production Next build and publisher syntax checks passed. Browser tests used clearly labeled sample reports: top navigation, direct-link reload, Back, manual refresh, team filtering, player search, injury filters and spoiler protection passed, with no horizontal overflow at 320- and 390-pixel widths. Screenshot `preview/injury-tab-local-phone.png` is a local sample preview, not live deployment evidence.

Navigation source `3c62bbb49c71` was deployed and verified live on October 23, 2026. Both cached reports, filters, spoiler protection and a 390-pixel phone layout passed live checks. Off-server backup `postgres/20261023T181534Z-d131b09409ae.json` was verified; worker/database containers stayed unchanged. See ignored `deploy/evidence/injury-tab-release.json` and `preview/injury-tab-live-phone.png`. For future web-only publishing, from normal PowerShell run:

```powershell
node "C:\Users\abhin\Documents\Codex\2026-10-20\if-x20\outputs\bayline-mvp\deploy\aws\publish-player-status.mjs" --injury-tab
```

This mode builds the committed source and replaces only web. It verifies that worker/database container IDs and start times remain unchanged, checks the public navigation, roster API, existing stats/Finals data and readiness, verifies an off-server backup, and archives source/deployment settings for recovery. It rolls back web on failure. Evidence is saved to ignored `deploy/evidence/injury-tab-release.json`. The existing migration-008 isolated restore remains applicable. For future releases, verify both evidence and live browser behavior before marking publication complete.

## Existing game-details experience

An expandable **Player status** section in game details lists the followed Bay Area team's current provider roster plus any extra players in its injury report. It includes reported status (Out, Questionable, PUP/IR and other provider labels), injury commentary, position, report date and estimated return when supplied. Search and filters support long NFL rosters. Opponent rosters are outside this release's coverage.

The app never interprets absence from an injury feed as confirmed health. A player on a complete roster without an injury entry is labeled **No reported injury**. Explicit available/healthy/cleared designations remain provider statements. A roster or injury-fetch failure cannot publish a healthy-looking partial report. Missing coverage stays pending/unavailable, or delayed with the prior complete snapshot retained.

These are **current** reports, including when opened from an old game. The panel explicitly says it is not the injury report from that completed game's date. Upcoming games also warn that availability can change. The cache check time is distinct from the provider's report date; older comments retain their own date. Return dates are estimates. Spoiler protection omits player names/commentary until the fan deliberately reveals the report; revealing it keeps scores hidden.

## Coverage and publication

Production coverage was validated and activated on October 22, 2026 (Pacific): NBA active players and injuries returned 18 Warriors roster rows and 5 injury rows; NFL active players and injuries returned 89 49ers roster rows and 29 injury rows. The NFL depth-chart roster endpoint was rejected, so this implementation uses the scoped **active players** endpoint for both sports instead. The release helper validates both NBA and NFL active-player/injury endpoints from the production IP before building or changing services. If either endpoint fails, activation stops. WNBA active-player and injury probes returned HTTP 401; its status coverage stays disabled, with an explicit unavailable message. No subscription or trial was activated.

Official API references: [NBA active players/injuries](https://nba.balldontlie.io/#active-players), [NFL active players/injuries](https://nfl.balldontlie.io/#active-players), [WNBA injuries](https://wnba.balldontlie.io/#player-injuries). Active in these roster feeds describes current player coverage, not game-day availability.

The release is live with `PLAYER_STATUS_LEAGUES=nba,nfl`. For future releases, the publisher requires the owner's AWS session. From normal PowerShell in this repository run:

```powershell
node .\deploy\aws\publish-player-status.mjs
```

If AWS sign-in is expired, first run `aws sso login --profile default`. Do not paste keys into chat or write them into environment examples. The helper uses the existing mounted server secret, verifies endpoint coverage, builds the committed source in CodeBuild, deploys prebuilt images, applies migration 008, waits for complete NBA/NFL reports, checks public details, verifies an off-server backup and restores it into a separate database. It preserves the PostgreSQL container and unrelated AWS projects. On deployment failure it restores prior images/configuration while retaining additive tables. Credentials and expanded Compose configuration are never printed. Its short-lived SSH identity is Windows-account encrypted afterward. The resulting evidence is saved to ignored `deploy/evidence/player-status-release.json` and the private recovery bucket.

Release source `9933f59db9ae` passed CodeBuild production checks and all 70 application tests. Live browser checks confirmed Warriors/49ers search, injury filtering, explicit unavailable WNBA coverage and current-report notices on completed games. Spoiler protection hides names/commentary; independent reveal leaves final scores and records hidden. At 390×844 the page and report panel had no horizontal overflow. See `preview/player-status-phone.png` and `preview/player-status-spoiler-phone.png`. The post-release backup was restored into a separate database with eight migrations and all 107 cached status players verified; full release and restore references are in [DEPLOYMENT.md](deploy/DEPLOYMENT.md).

## Scheduling and recovery

`PLAYER_STATUS_LEAGUES=` defaults empty. The helper sets production to `nba,nfl` only after coverage passes; WNBA remains off. Migration 008 adds `team_player_status` and `player_status_gate`. The independent worker polls one followed team per minute, refreshes each complete report approximately every ten minutes, and shares the persistent 14-second provider throttle. Both feeds are bounded to four pages each and are published together only when complete. Duplicate players are merged by ID, with dated injury duplicates preferring the newer report; malformed/cross-team rows and cursor loops fail closed. Empty rosters cannot erase populated reports. Empty complete injury lists are valid. Retry and rate-limit backoff retain the prior snapshot. Reports older than 30 minutes or with refresh errors are marked delayed.

Only detail API responses add `playerStatus`; scoreboard lists omit these roster payloads. Web reads cached reports every 15 seconds through the existing detail refresh and never receives a provider key. The optional report cache does not change score-readiness rules; inspect bounded `player_status_synced`/`player_status_failed` events and database timestamps/errors separately.

Backups include the complete reports, access rows and check times. Recovery requires eight migrations, `PLAYER_STATUS_LEAGUES=nba,nfl`, the normal worker-only provider secret, populated NBA/NFL report rows and disabled WNBA coverage. Preserve current images and source alongside the snapshot. Rollback does not reverse migration 008 or delete reports. No new AWS service is introduced.
