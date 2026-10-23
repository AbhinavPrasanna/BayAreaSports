import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {Pool,PoolClient} from 'pg';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {combinePlayerStatus} from '../src/shared/player-status';
import {normalizeRosterPlayer,normalizeInjuryReport} from '../src/server/providers/balldontlie/player-status';
import {BallDontLieAdapter,ProviderRequestError} from '../src/server/providers/balldontlie/adapter';
import {configurePlayerStatus,syncNextPlayerStatus,type StatusProvider} from '../src/server/ingestion/player-status';
import {readTeamPlayerStatus} from '../src/server/db/player-status';
import {readGames} from '../src/server/db/game-reader';
import {storeGames} from '../src/server/ingestion/store';
import {normalizeGame} from '../src/server/providers/balldontlie/normalize';
import {parseWorkerEnv} from '../src/server/config/env';
import {PlayerStatusSection} from '../src/components/player-status';
import type {StoredGame} from '../src/shared/games';

const raw={id:42,first_name:'Test',last_name:'Player',position:'G',team:{id:10}};
const roster=normalizeRosterPlayer('nba',raw,10),other={...roster,playerId:43,name:'Other Player'};
const injury=normalizeInjuryReport('nba',{player:{...raw,team_id:10},status:'Out',description:'Knee injury. A recent result is mentioned.',return_date:'Nov 1'},10);
const game=normalizeGame('nba',{id:7,home_team:{id:10},visitor_team:{id:14},date:'2026-10-22',datetime:'2026-10-23T02:00:00Z',status_state:'final',home_team_score:100,visitor_team_score:90});

test('status normalization preserves provider details and rejects cross-team data',()=>{
  assert.equal(roster.teamId,10);assert.equal(injury.description,'Knee injury. A recent result is mentioned.');assert.equal(injury.reportedAt,null);
  const nfl=normalizeInjuryReport('nfl',{player:{...raw,team:{id:30}},status:'Questionable',comment:'Limited with an ankle injury.',date:'2026-10-22T12:00:00Z'},30);
  assert.equal(nfl.reportedStatus,'Questionable');assert.equal(nfl.reportedAt,'2026-10-22T12:00:00.000Z');
  assert.throws(()=>normalizeRosterPlayer('nfl',{...raw,team:{id:9}},30));
  assert.throws(()=>normalizeRosterPlayer('nba',{...raw,team:undefined},10));
  assert.throws(()=>normalizeInjuryReport('nba',{player:raw},9));
});

test('complete roster/report merge never infers healthy from absence and keeps injured players outside the active roster',()=>{
  const extra={...injury,playerId:99,name:'Reserve Player',reportedStatus:'Injured reserve'};
  const rows=combinePlayerStatus([roster,other,roster],[injury,extra]);
  assert.equal(rows.length,3);assert.equal(rows.find(p=>p.playerId===43)!.category,'no_report');
  assert.equal(rows.find(p=>p.playerId===99)!.category,'reported');
  assert.throws(()=>combinePlayerStatus([],[injury]));
  const dated={...injury,reportedAt:'2026-10-22T12:00:00Z'};
  const older={...injury,reportedAt:'2026-10-21T12:00:00Z',reportedStatus:'Probable'};
  assert.equal(combinePlayerStatus([roster],[dated,older])[0].reportedStatus,'Out');
  assert.equal(combinePlayerStatus([roster],[{...injury,reportedStatus:'Available'}])[0].category,'available');
});

test('player status hides names and injury commentary until explicit reveal, and labels current reports on old games',()=>{
  const stored={...game,localDate:'2026-10-22',observedAt:'',changedAt:'',playerStatus:[{league:'nba',teamId:10,teamName:'Warriors',status:'ready',checkedAt:'2026-10-22T12:00:00Z',players:combinePlayerStatus([roster,other],[injury])}]} as StoredGame;
  const hidden=renderToStaticMarkup(createElement(PlayerStatusSection,{game:stored,hidden:true}));
  assert.match(hidden,/Show current player status/);assert.doesNotMatch(hidden,/Test Player|Knee injury|No reported injury|Out/);
  const shown=renderToStaticMarkup(createElement(PlayerStatusSection,{game:stored,hidden:false}));
  assert.match(shown,/Test Player|Knee injury|No reported injury/);assert.match(shown,/current team reports, not injury status on the date/);assert.doesNotMatch(shown,/>Healthy</);
  const disabled={...stored,playerStatus:[{...stored.playerStatus![0],status:'disabled' as const,players:[]}]};
  assert.match(renderToStaticMarkup(createElement(PlayerStatusSection,{game:disabled,hidden:false})),/coverage isn’t enabled/);
});

test('current roster/injury adapters use scoped active-player endpoints; league configuration defaults off',async t=>{
  const calls:URL[]=[];
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{const u=new URL(String(input));calls.push(u);assert.equal(u.searchParams.get('team_ids[]'),'10');return Response.json({data:u.pathname.includes('injuries')?[{player:raw,status:'Out'}]:[raw],meta:{}});});
  for(const league of ['nba','nfl'] as const){const adapter=new BallDontLieAdapter(league,'fixture-secret');await adapter.getRoster(10,undefined);await adapter.getInjuries(10,undefined);}
  assert.deepEqual(calls.map(u=>u.pathname),['/v1/players/active','/v1/player_injuries','/nfl/v1/players/active','/nfl/v1/player_injuries']);
  const env={DATABASE_URL:'postgresql://local:local@localhost/test',BALLDONTLIE_API_KEY:'fixture'};
  assert.deepEqual(parseWorkerEnv(env).PLAYER_STATUS_LEAGUES,[]);
  assert.throws(()=>parseWorkerEnv({...env,PLAYER_STATUS_LEAGUES:'nba,invalid'}));
  assert.throws(()=>parseWorkerEnv({...env,ENABLED_LEAGUES:'nba',PLAYER_STATUS_LEAGUES:'nfl'}));
});

test('status SQL publishes only complete roster/injury pages and retains the last report on failures',async()=>{
  const db=await PGlite.create(),client=db as unknown as PoolClient,pool=db as unknown as Pick<Pool,'query'>;
  try{
    for(const file of ['001_foundation.sql','002_game_ingestion.sql','004_game_media.sql','005_automatic_highlights.sql','006_season_records.sql','007_advanced_game_details.sql','008_player_status.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
    const run=await db.query<{id:string}>("INSERT INTO sync_runs(league,status) VALUES('nba','running') RETURNING id::text");await storeGames(client,'nba',[game],run.rows[0].id,{from:'2026-10-01',to:'2026-10-31'},new Date());
    let calls=0,mode:'ready'|'partial'|'emptyRoster'|'emptyReport'|'limited'='ready';
    const slot=async()=>{calls++;await db.exec("UPDATE provider_throttle SET next_request_at=now()-interval '1 minute'");};
    const provider:StatusProvider={league:'nba',getRoster:async()=>{await slot();if(mode==='limited')throw new ProviderRequestError(429,120000);return {players:mode==='emptyRoster'?[]:[roster,other],nextCursor:null};},getInjuries:async(_id,cursor)=>{await slot();if(mode==='partial'&&cursor)throw new ProviderRequestError(503);return {players:mode==='emptyReport'?[]:[injury],nextCursor:mode==='partial'&&!cursor?11:null};}};
    async function tick(){await db.exec("UPDATE player_status_gate SET next_check_at=now()-interval '1 second';UPDATE team_player_status SET next_sync_at=now()-interval '1 second';UPDATE provider_throttle SET next_request_at=now()-interval '1 minute'");await syncNextPlayerStatus(client,[provider],['nba'],new AbortController().signal);}
    await configurePlayerStatus(client,[]);await syncNextPlayerStatus(client,[provider],[],new AbortController().signal);assert.equal(calls,0);assert.equal((await readTeamPlayerStatus(pool,'nba',[10]))[0].status,'disabled');
    await configurePlayerStatus(client,['nba']);await tick();let saved=(await readTeamPlayerStatus(pool,'nba',[10]))[0];assert.equal(saved.status,'ready');assert.equal(saved.players.length,2);const checked=saved.checkedAt;
    assert.equal((await readGames(pool,{league:'nba',view:'all',from:'2026-10-22',to:'2026-10-22'})).data[0]?.playerStatus,undefined);
    const detail=(await readGames(pool,{league:'nba',view:'all',from:'2026-10-22',to:'2026-10-22'},7)).data[0];assert.equal(detail.playerStatus?.[0].players.length,2);
    mode='partial';await tick();saved=(await readTeamPlayerStatus(pool,'nba',[10]))[0];assert.equal(saved.status,'delayed');assert.equal(saved.checkedAt,checked);assert.equal(saved.players[0].reportedStatus,'Out');
    mode='emptyRoster';await tick();saved=(await readTeamPlayerStatus(pool,'nba',[10]))[0];assert.equal(saved.status,'delayed');assert.equal(saved.players.length,2);
    mode='emptyReport';await tick();saved=(await readTeamPlayerStatus(pool,'nba',[10]))[0];assert.equal(saved.status,'ready');assert.ok(saved.players.every(p=>p.category==='no_report'));
    mode='limited';await tick();assert.equal((await readTeamPlayerStatus(pool,'nba',[10]))[0].status,'delayed');
    const throttle=await db.query<{delayed:boolean}>("SELECT next_request_at>now()+interval '60 seconds' AS delayed FROM provider_throttle");assert.equal(throttle.rows[0].delayed,true);
    await configurePlayerStatus(client,[]);assert.deepEqual((await readTeamPlayerStatus(pool,'nba',[10]))[0].players,[]);
  }finally{await db.close();}
});
