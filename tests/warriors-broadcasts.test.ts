import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {PoolClient,Pool} from 'pg';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseWarriorsBroadcasts,fetchWarriorsBroadcasts,syncWarriorsBroadcasts} from '../src/server/media/warriors-broadcasts';
import {resolveGameMedia,type ReviewedMedia} from '../src/shared/game-media';
import type {StoredGame} from '../src/shared/games';
import {readGames} from '../src/server/db/game-reader';
import {GameMedia} from '../src/components/game-media';

const now=Date.now(),checked=new Date(now).toISOString(),startsAt='2026-10-27T02:00:00Z';
const row=(label:string,id=-1,media='tv',url='')=>({broadcasterDisplay:label,broadcasterTeamId:id,broadcasterMedia:media,broadcasterVideoLink:url,localizationRegion:''});
const official={gameId:'0022600127',gameDateTimeUTC:startsAt,postponedStatus:'N',homeTeam:{teamId:1610612743,teamTricode:'DEN'},awayTeam:{teamId:1610612744,teamTricode:'GSW'},broadcasters:{nationalBroadcasters:[row('Peacock',-1,'tv','https://peacocktv.app.link/eKAuSFqZc7b'),row('NBC Sports Network')],nationalOttBroadcasters:[],homeTvBroadcasters:[row('Altitude',1610612743)],homeOttBroadcasters:[],awayTvBroadcasters:[row('NBCSBA/PCK-GSW',1610612744,'tv','https://unsafe.example/watch')],awayOttBroadcasters:[]}};
function feed(value:unknown=official){return {leagueSchedule:{gameDates:[{games:[value]}]}};}
const request=(value:unknown=feed())=>(async()=>new Response(JSON.stringify(value))) as typeof fetch;
const game:StoredGame={provider:'balldontlie',league:'nba',providerId:21717970,homeTeamId:8,awayTeamId:10,startsAt,calendarDate:'2026-10-27',localDate:'2026-10-26',status:'scheduled',originalStatus:null,homeScore:null,awayScore:null,period:null,clock:null,homeTeam:{providerId:8,name:'Denver Nuggets',abbreviation:'DEN'},awayTeam:{providerId:10,name:'Golden State Warriors',abbreviation:'GSW'},observedAt:checked,changedAt:checked};
const snapshot:ReviewedMedia={league:'nba',providerId:game.providerId,homeTeamId:8,awayTeamId:10,startsAt,verifiedAt:checked,sourceUrl:'https://www.nba.com/warriors/schedule',broadcasts:parseWarriorsBroadcasts(feed())[0].broadcasts,highlight:null};

test('official adapter keeps national and Warriors TV/OTT, excludes opponent/radio, validates outbound links',()=>{
  const data=structuredClone(official);
  data.broadcasters.nationalBroadcasters.push(row('Radio',-1,'radio'),row('Peacock'));
  data.broadcasters.awayTvBroadcasters.push(row('TSN/TSN+',1610612744),row('SN/SN+',1610612744));
  const parsed=parseWarriorsBroadcasts(feed(data));
  assert.equal(parsed[0].nbaGameId,'0022600127');
  assert.deepEqual(parsed[0].broadcasts.map(row=>row.label),['Peacock','NBC Sports Network','NBCSBA/PCK-GSW']);
  assert.match(parsed[0].broadcasts[2].url,/^https:\/\/www.nba.com\/how-to-watch-game-redirect\/0022600127/);
  assert.equal(parsed[0].broadcasts[0].kind,'stream');
  assert.equal(parseWarriorsBroadcasts(feed({...official,broadcasters:{...official.broadcasters,nationalBroadcasters:[{...row('NBC'),localizationRegion:'West'}]}}))[0].broadcasts[0].label,'NBC');
  assert.deepEqual(parseWarriorsBroadcasts(feed({...official,postponedStatus:'Y'}))[0].broadcasts,[]);
  assert.throws(()=>parseWarriorsBroadcasts(feed({...official,broadcasters:{}})));
  assert.throws(()=>parseWarriorsBroadcasts({leagueSchedule:{gameDates:[{games:[official,official]}]}}));
  // Unassigned unrelated NBA Cup matchups have null team codes in the real NBA feed.
  assert.equal(parseWarriorsBroadcasts({leagueSchedule:{gameDates:[{games:[{homeTeam:{teamId:0},awayTeam:{teamId:0}},official]}]}}).length,1);
});

test('bounded fetching rejects rate limits, malformed snapshots and oversized bodies without exposing response content',async()=>{
  assert.equal((await fetchWarriorsBroadcasts(new AbortController().signal,request())).length,1);
  await assert.rejects(fetchWarriorsBroadcasts(new AbortController().signal,async()=>new Response('private error',{status:429,headers:{'retry-after':'3600'}})),(e:any)=>e.code==='BROADCAST_RATE_LIMIT'&&e.retryMs===3600_000);
  await assert.rejects(fetchWarriorsBroadcasts(new AbortController().signal,request({wrong:true})),/BROADCAST_SCHEMA/);
  await assert.rejects(fetchWarriorsBroadcasts(new AbortController().signal,async()=>new Response(new Uint8Array(16*1024*1024+1))),/BROADCAST_SIZE/);
});

test('network corrections, empty snapshots and expiration never revive older manual networks; highlights remain spoiler protected',()=>{
  const manual={...snapshot,verifiedAt:new Date(now-60_000).toISOString(),broadcasts:[{...snapshot.broadcasts[0],label:'Old network'}]};
  const expires=new Date(now+86400_000).toISOString();
  const resolve=(value:unknown=snapshot,at=now,expiry=expires)=>resolveGameMedia(game,manual,null,value,expiry,true,at);
  assert.equal(resolve().broadcasts[0].label,'Peacock');assert.equal(resolve().broadcastDelayed,true);
  assert.equal(resolve({...snapshot,broadcasts:[]}).broadcasts.length,0);
  assert.equal(resolve(snapshot,now+86400_001).broadcasts.length,0);
  assert.equal(resolve(snapshot,now,new Date(now-1).toISOString()).broadcasts.length,0);
  assert.equal(resolve({...snapshot,homeTeamId:10,awayTeamId:8}).broadcasts[0].label,'Old network');
  assert.equal(resolveGameMedia({...game,status:'postponed'},manual,null,snapshot,expires,false,now).broadcasts.length,0);
  const newer={...manual,verifiedAt:new Date(now+1).toISOString()};
  assert.equal(resolveGameMedia(game,newer,null,snapshot,expires,false,now).broadcasts[0].label,'Old network');
  const youtube={...snapshot,verifiedAt:new Date(now+1000).toISOString(),highlight:{videoId:'CTJGJH9hPVU',channel:'NBA' as const,title:'Spoiler Warriors WIN 110-100',verifiedAt:checked}};
  const media=resolveGameMedia({...game,status:'final'},null,youtube,snapshot,expires,false,now);
  assert.equal(media.verifiedAt,checked);assert.equal(media.highlight?.videoId,'CTJGJH9hPVU');
  const html=renderToStaticMarkup(createElement(GameMedia,{game:{...game,status:'final',media},hideScore:true}));
  assert.match(html,/Reveal highlights/);assert.doesNotMatch(html,/WIN|110-100|CTJGJH9hPVU|iframe|youtube\.com/);
  const watch=renderToStaticMarkup(createElement(GameMedia,{game:{...game,media:resolve()},hideScore:true}));
  assert.match(watch,/Checked/);assert.match(watch,/Viewing updates are delayed/);assert.doesNotMatch(watch,/unsafe\.example|Altitude/);
});

test('database sync joins different provider IDs by exact matchup/time, persists its gate, and retains cache on failures',async()=>{
  const db=await PGlite.create();const client=db as unknown as Pick<PoolClient,'query'>;
  try {
    for(const file of ['001_foundation.sql','002_game_ingestion.sql','004_game_media.sql','005_automatic_highlights.sql','006_season_records.sql','007_advanced_game_details.sql','008_player_status.sql','009_official_broadcasts.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
    await db.exec("INSERT INTO teams(league,provider_id,name,abbreviation,enabled) VALUES('nba',8,'Denver Nuggets','DEN',false) ON CONFLICT DO NOTHING;UPDATE teams SET abbreviation='GSW' WHERE league='nba' AND provider_id=10;");
    await db.query("INSERT INTO games(league,provider_id,home_team_id,away_team_id,starts_at,calendar_date,status,observed_at) VALUES('nba',21717970,8,10,$1,'2026-10-27','scheduled',now())",[startsAt]);
    const signal=new AbortController().signal;
    assert.equal(await syncWarriorsBroadcasts(client,signal,request()),true);
    let stored=(await db.query<{payload:ReviewedMedia}>('SELECT payload FROM official_broadcasts')).rows[0].payload;
    assert.equal(stored.providerId,21717970);assert.equal(stored.broadcasts[0].label,'Peacock');
    let requests=0;
    assert.equal(await syncWarriorsBroadcasts(client,signal,async()=>{requests++;throw Error('not due');}),false);assert.equal(requests,0);
    const current=(await readGames(db as unknown as Pick<Pool,'query'>,{league:'nba',view:'all',from:'2026-10-26',to:'2026-10-26'})).data[0];
    assert.equal(current.media?.broadcasts[1].label,'NBC Sports Network');assert.equal(current.media?.broadcastSource,'official_schedule');assert.equal(current.homeScore,null);
    await db.exec("UPDATE broadcast_sync_state SET next_check_at=now()-interval '1 second'");
    await syncWarriorsBroadcasts(client,signal,request({invalid:true}));
    const state=(await db.query<{code:string;failures:number}>(`SELECT last_error_code AS code,consecutive_failures AS failures FROM broadcast_sync_state`)).rows[0];
    assert.equal(state.code,'BROADCAST_SCHEMA');assert.equal(state.failures,1);
    assert.deepEqual((await db.query<{payload:ReviewedMedia}>('SELECT payload FROM official_broadcasts')).rows[0].payload,stored);
    await db.exec("UPDATE broadcast_sync_state SET next_check_at=now()-interval '1 second'");
    await syncWarriorsBroadcasts(client,signal,request({...feed(),leagueSchedule:{gameDates:[{games:[{...official,gameDateTimeUTC:'2026-10-28T02:00:00Z'}]}]}}));
    assert.equal((await readGames(db as unknown as Pick<Pool,'query'>,{league:'nba',view:'all',from:'2026-10-26',to:'2026-10-26'})).data[0].media?.broadcasts.length,0);
  } finally {await db.close();}
});
