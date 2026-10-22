# Enable automatic official highlights

Automatic discovery uses **@NBA for Warriors**, **@NFL for 49ers**, and **@WNBA for Valkyries**. There is no YouTube account sign-in for fans. Only the independent worker receives the API key. Without a configured key, the app continues showing reviewed links and official-channel search fallbacks.

## Create and restrict the key

1. Open [Google Cloud Console](https://console.cloud.google.com/), create/select a project named `Bayline Sports`, then open [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) and select **Enable**.
2. Open [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). Choose **Create credentials → API key**, name it `Bayline production highlights`, and edit its restrictions.
3. Under **Application restrictions**, select **IP addresses** and allow **44.224.200.231** (the production server). Under **API restrictions**, select **Restrict key → YouTube Data API v3**. Save. Server requests need an IP restriction; a website/referrer restriction will fail. If the server's outbound IP changes during recovery, update this restriction.
4. Review the project's [API quotas](https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas). The worker uses only `channels.list`, `playlistItems.list`, and `videos.list`, each costing one unit. It never calls `search.list`. Its persistent cap is **500 calls per league per Pacific day**, or **1,500 combined**; Google may impose a lower quota shared with other applications in the project. No paid sports subscription or new AWS service is required. Do not buy quota or enable another paid service for this feature.

## Save securely on Windows

Run this from normal PowerShell. It asks for the key with hidden input and saves it encrypted for your Windows account in a Git-ignored, ACL-restricted file. It makes no network requests. Do not paste the key into chat, source code, `.env`, or a command argument.

```powershell
Set-Location 'C:\Users\abhin\Documents\Codex\2026-10-20\if-x20\outputs\bayline-mvp'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-youtube-key.ps1
```

Then return to chat and say **YouTube key configured**. The key can be verified and installed on the server through encrypted SSH stdin. To do that yourself after this release is deployed:

```powershell
aws sso login --profile default
node .\deploy\aws\enable-youtube.mjs
```

The installer validates access to all three official channels **from the server's permitted IP**, installs the key under `/opt/bayline/deploy/secrets/`, and recreates only the worker. It restores the previous key/settings if activation fails. It never prints the key. An HTTP 403 normally requires checking API enablement, IP/API restrictions, and quota; new restrictions can take time to apply. Refresh the AWS SSO login if it expired.

## Operation and limits

The worker checks one league per minute, with each league's discovery attempts at least ten minutes apart. It checks final games from the last seven days that lack a verified clip. Publication time must be 90 minutes–72 hours after the game's start, both teams must match, and NBA/WNBA titles must contain the exact Pacific game date. NFL titles must identify the matching season; its narrow publication window distinguishes another week's meeting. Only public, processed full-game highlight clips from the resolved official league channel qualify. Multiple competing matches, changed matchups, and unfamiliar titles are skipped. Human-reviewed entries take precedence. Discovery never changes game scores.

Up to 150 recent channel uploads are inspected per check. A prolonged worker outage or an unusually busy channel can push a clip outside that window. Missing/ambiguous clips retain **Find highlights** and can be added manually through [MEDIA.md](MEDIA.md). Discovery latency is approximately ten minutes plus worker rotation and score ingestion, **after the league publishes its video**; publication itself is outside the app's control.

YouTube metadata is rechecked after seven days, expires from the UI after 28 days without successful verification, and is removed by the worker even when fetching is disabled. Missing/private/changed videos are removed on successful recheck. API failures use persisted backoff, with a 24-hour pause for exhausted quota; they do not fail the score service. Inspect bounded worker logs for `highlights_checked`, `highlights_check_failed` or `highlights_storage_failed`, and `youtube_discovery_state` for timing/error/counts. These contain no keys. The existing uptime endpoint continues to measure score availability; it does not claim highlight discovery is healthy.

Set `HIGHLIGHTS_ENABLED=false` in the worker's environment and recreate it to stop external YouTube requests. The web server never receives the key. Local `start-local.ps1` can load the encrypted key into the worker environment, but the production-IP-restricted key will not work locally. Use mocked tests, or a separate key restricted to the development machine's public IP. Keep the local production-score worker stopped while the live worker uses the free sports API quota.

Migration **005** must run before starting this web/worker release. Backups include `youtube_highlights` and `youtube_discovery_state`. After restoring a server, recover the key from your encrypted local copy, reapply any IP restriction, and run the secure installer again. A restored database cannot decrypt or recover an API key. Expired restored metadata is filtered from public reads until revalidated.

Spoiler protection still withholds the video title, outbound link, and player until **Reveal highlights**. That action does not reveal scores. YouTube may allow a video on its own site while refusing embedded playback; the API's embedding flag selects an external link immediately when possible, and the existing player error fallback handles later restrictions.

References: [YouTube API credentials](https://developers.google.com/youtube/registering_an_application), [upload playlists](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list), [video validation](https://developers.google.com/youtube/data/reference/rest/v3/videos/list), [key restrictions](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys).
