# Event-specific Ticketmaster links

Upcoming game cards and game details offer **View tickets** links to a confirmed Ticketmaster event. They open a new tab with `noopener noreferrer`. Bayline does not sell tickets or cache prices/seat inventory; availability and checkout live on Ticketmaster.

## Initial coverage and maintenance

This release uses a **reviewed catalog**, not automatic Ticketmaster discovery. On October 30, 2026, Ticketmaster's public team listings were checked against the 30-day stored schedule. Nineteen distinct events matched: 15 Warriors games, three 49ers games and the Valkyries-Dream game on October 31. Home and away identities, the venue and the exact start time were reviewed. Venue-local times were compared in the venue's timezone, including Pacific/Central differences and daylight-saving changes.

Sources: [Warriors Ticketmaster listing](https://www.ticketmaster.com/golden-state-warriors-tickets/artist/805946), [49ers Ticketmaster listing](https://www.ticketmaster.com/san-francisco-49ers-tickets/artist/806015), [Valkyries Ticketmaster listing](https://www.ticketmaster.com/golden-state-valkyries-tickets/artist/3369949), and the [49ers official schedule](https://www.49ers.com/schedule/). The 49ers-Vikings game had no confirmed Ticketmaster event in these sources; its details show an unavailable message. No artist page, search URL or another game's link is substituted.

Newly scheduled games need reviewed links added to `data/reviewed-game-media.json`. Ticket reviews expire after 30 days. Re-importing the same catalog does not advance its verification timestamps. Review the rolling schedule and refresh entries before they expire. Automatic coverage would be a separate Ticketmaster Discovery API integration with a server-only key; this release adds no API key, paid data subscription or new AWS service.

## Validation and data flow

- A `ticket` object stores the Ticketmaster event ID, canonical event URL, event UTC start, venue and review timestamp inside the existing `game_media.payload` JSONB field. No new migration is required.
- The parent entry must match league, BALLDONTLIE game ID, home team, away team and exact start time. Ticket start time must also match. A single Ticketmaster event cannot be assigned to multiple catalog games.
- URLs must be HTTPS on exactly `www.ticketmaster.com`, contain a single event ID matching `ticket.eventId`, and have no credentials, custom port, tracking/redirect query or fragment. Both normal and resale event IDs are supported. Generic team/search/account-manager links are rejected.
- Links appear only for scheduled games with a future start and a fresh review. Completed, live, canceled, delayed, postponed, unknown-time and rescheduled games do not expose an active purchase link. The client rechecks time eligibility as the page clock advances.
- Ticket freshness is independent of viewing-network and YouTube freshness. A new broadcast check cannot refresh an old ticket review. No ticket titles, scores, external images or players are embedded, preserving spoiler protection.
- The independent worker imports the bundled media catalog about every ten minutes; the release helper also imports it immediately. Browser refreshes read the stored API snapshot every 15 seconds while visible. They do not contact Ticketmaster or consume sports-provider quota.

## Release and recovery

Prepared locally; production activation remains pending until verified. Publish the clean committed source from an authenticated PowerShell session:

```powershell
node "C:\Users\abhin\Documents\Codex\2026-10-20\if-x20\outputs\bayline-mvp\deploy\aws\publish-tickets.mjs"
```

The dedicated release mode builds prebuilt web/worker images, verifies an off-server backup, checks existing migrations, imports the catalog, verifies public upcoming-game ticket metadata, and restores a new backup into an isolated database. Recovery checks include ticket-bearing JSONB rows and all nine existing migrations. PostgreSQL is not restarted. Evidence is written to ignored `deploy/evidence/tickets-release.json`; source, deployment files and manifest are archived privately with the release.

Rollback restores prior images/configuration and retains the compatible JSONB metadata. For server loss, follow `deploy/RUNBOOK.md` with the matching source/image archive and database backup. Ticket eligibility and review expiration are evaluated again after restore.

Local validation passed 81 application/SQL/UI tests, type checking, runtime compilation and a production Next.js build. Local browser access was unavailable in this Windows sandbox; desktop/phone browser verification must be recorded after deployment.
