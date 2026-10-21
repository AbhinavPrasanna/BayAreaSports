import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { gameMedia, parseMediaCatalog, type ReviewedMedia } from '../src/shared/game-media';
import type { StoredGame } from '../src/shared/games';
import { GameMedia } from '../src/components/game-media';
import { GameCard } from '../src/components/game-ui';
import { importReviewedMedia } from '../src/server/media/reviewed-media';
import { readGames } from '../src/server/db/game-reader';

const now = Date.parse('2026-10-21T19:00:00Z');
const game: StoredGame = { provider: 'balldontlie', league: 'nba', providerId: 7, homeTeamId: 10, awayTeamId: 14, startsAt: '2026-10-22T02:00:00Z', calendarDate: '2026-10-21', localDate: '2026-10-21', homeScore: 110, awayScore: 100, status: 'scheduled', originalStatus: null, period: null, clock: null, homeTeam: {providerId:10,name:'Golden State Warriors',abbreviation:'GSW'}, awayTeam:{providerId:14,name:'Los Angeles Lakers',abbreviation:'LAL'}, observedAt: new Date(now).toISOString(), changedAt: new Date(now).toISOString() };
const entry: ReviewedMedia = { league:'nba', providerId:7, homeTeamId:10, awayTeamId:14, startsAt:game.startsAt!, verifiedAt:new Date(now).toISOString(), sourceUrl:'https://www.nba.com/warriors/schedule', broadcasts:[{label:'ESPN',url:'https://www.espn.com/watch/',kind:'stream',region:'US',access:'Subscription required.'}], highlight:{videoId:'CTJGJH9hPVU',title:'Warriors WIN 110-100 — spoiler test fixture',channel:'NBA',verifiedAt:new Date(now).toISOString()} };

test('reviewed media rejects unsafe links, invalid video IDs and duplicate entries', () => {
  assert.equal(parseMediaCatalog([entry]).length,1);
  for (const url of ['javascript:alert(1)','https://www.espn.com.evil.test/watch/','https://user:password@www.espn.com/watch/','http://www.espn.com/watch/']) assert.throws(()=>parseMediaCatalog([{...entry,broadcasts:[{...entry.broadcasts[0],url}]}]));
  assert.throws(()=>parseMediaCatalog([{...entry,highlight:{...entry.highlight,videoId:'https://evil.test'}}]));
  assert.throws(()=>parseMediaCatalog([entry,entry]));
});
test('viewing listings match the exact game, expire and do not claim postponed broadcasts', () => {
  assert.equal(gameMedia(game,entry,now).broadcasts[0].label,'ESPN');
  for(const other of [{...game,league:'nfl' as const},{...game,providerId:8},{...game,homeTeamId:14,awayTeamId:10},{...game,startsAt:'2026-10-23T02:00:00Z'}]) assert.equal(gameMedia(other,entry,now).broadcasts.length,0);
  assert.equal(gameMedia(game,entry,now+8*86400000).broadcasts.length,0);
  assert.equal(gameMedia({...game,status:'postponed'},entry,now).broadcasts.length,0);
  assert.equal(gameMedia(game,entry,now).highlight,null);
  assert.equal(gameMedia(game,{...entry,sourceUrl:'broken URL'},now).broadcasts.length,0);
  assert.equal(gameMedia({...game,status:'final'},entry,now).highlight?.videoId,entry.highlight?.videoId);
});
test('spoiler protection renders no video title, ID, thumbnail, player or outbound YouTube link', () => {
  const final={...game,status:'final' as const};final.media=gameMedia(final,entry,now);
  const protectedHtml=renderToStaticMarkup(createElement(GameMedia,{game:final,hideScore:true}));
  assert.match(protectedHtml,/Reveal highlights/);
  assert.doesNotMatch(protectedHtml,/WIN|110-100|CTJGJH9hPVU|iframe|youtube\.com|ytimg|<img/);
  const card=renderToStaticMarkup(createElement(GameCard,{game:final,now,delayed:false,hideScore:true,protection:true,onReveal(){},onOpen(){}}));
  assert.match(card,/spoiler protected/);assert.doesNotMatch(card,/WIN|110-100|CTJGJH9hPVU|iframe/);
  const revealedHtml=renderToStaticMarkup(createElement(GameMedia,{game:final,hideScore:false}));
  assert.match(revealedHtml,/Play highlights/);assert.match(revealedHtml,/Open on YouTube/);
  assert.doesNotMatch(revealedHtml,/<iframe|<script|<img/);
});
test('missing highlights retain a clearly labeled official-channel search fallback', () => {
  const final={...game,status:'final' as const,media:gameMedia(game,null,now)};
  const html=renderToStaticMarkup(createElement(GameMedia,{game:final,hideScore:false}));
  assert.match(html,/Highlights not available yet/);assert.match(html,/Search the official YouTube channel/);assert.doesNotMatch(html,/<iframe/);
});
test('PostgreSQL media imports are idempotent and remain isolated from scores and rescheduled games', async () => {
  const db=await PGlite.create();
  const pool=db as unknown as Pick<Pool,'query'>;
  try {
    for(const file of ['001_foundation.sql','002_game_ingestion.sql','004_game_media.sql']) await db.exec(await readFile(`migrations/${file}`,'utf8'));
    await db.query("INSERT INTO teams (league,provider_id,name,enabled) VALUES ('nba',14,'Los Angeles Lakers',false) ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO games (league,provider_id,home_team_id,away_team_id,starts_at,calendar_date,status,observed_at,home_score,away_score) VALUES ('nba',7,10,14,$1,'2026-10-21','scheduled',now(),110,100)",[game.startsAt]);
    assert.equal((await importReviewedMedia(pool,[entry])).changed,1);
    assert.equal((await importReviewedMedia(pool,[entry])).changed,0);
    const stored=(await readGames(pool,{league:'nba',view:'all',from:'2026-10-21',to:'2026-10-21'})).data[0];
    assert.equal(stored.homeScore,110);assert.equal(stored.media?.guide.label,'Warriors official schedule');
    assert.equal((await db.query<{payload:ReviewedMedia}>('SELECT payload FROM game_media')).rows[0].payload.highlight?.videoId,entry.highlight?.videoId);
    assert.equal((await importReviewedMedia(pool,[{...entry,startsAt:'2026-10-23T02:00:00Z'}])).changed,0);
    await db.query("UPDATE games SET starts_at='2026-10-23T02:00:00Z' WHERE league='nba' AND provider_id=7");
    const moved=(await readGames(pool,{league:'nba',view:'all',from:'2026-10-22',to:'2026-10-22'})).data[0];
    assert.equal(moved.media?.broadcasts.length,0);assert.equal(moved.media?.highlight,null);
  } finally { await db.close(); }
});
test('the shipped media catalog validates before deployment', async () => {
  const entries=parseMediaCatalog(JSON.parse(await readFile('data/reviewed-game-media.json','utf8')));
  assert.ok(entries.some(e=>e.highlight));assert.ok(entries.some(e=>e.broadcasts.length));
});
