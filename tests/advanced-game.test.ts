import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool,PoolClient } from 'pg';
import { normalizeGame } from '../src/server/providers/balldontlie/normalize';
import { normalizePlayerStats } from '../src/server/providers/balldontlie/player-stats';
import { BallDontLieAdapter,ProviderRequestError } from '../src/server/providers/balldontlie/adapter';
import { AdvancedGameDetails } from '../src/components/advanced-game-details';
import { configurePlayerStats,syncNextPlayerStats,type PlayerStatsProvider } from '../src/server/ingestion/player-stats';
import { readPlayerStats } from '../src/server/db/player-stats';
import { storeGames } from '../src/server/ingestion/store';
import { readGames } from '../src/server/db/game-reader';
import { parseWorkerEnv } from '../src/server/config/env';
import type { StoredGame } from '../src/shared/games';

const raw={id:7,home_team:{id:10,full_name:'Golden State Warriors',abbreviation:'GSW'},visitor_team:{id:14,full_name:'Los Angeles Lakers',abbreviation:'LAL'},season:2026,postseason:false,date:'2026-10-21',datetime:'2026-10-22T02:00:00Z',status_state:'final',home_team_score:110,visitor_team_score:100,home_q1:20,home_q2:30,home_q3:25,home_q4:35,visitor_q1:22,visitor_q2:28,visitor_q3:20,visitor_q4:30};
const base=normalizeGame('nba',raw);
const playerRaw={player:{id:42,first_name:'Test',last_name:'Player',position:'G'},team:{id:10},game:{id:7},min:'31:22',pts:24,reb:7,ast:8,fgm:8,fga:16,plus_minus:-5};
const player=normalizePlayerStats('nba',playerRaw,7,[10,14]);
const stored={...base,localDate:'2026-10-21',observedAt:new Date().toISOString(),changedAt:new Date().toISOString(),playerStats:{status:'ready',checkedAt:new Date().toISOString(),players:[player]}} as StoredGame;

test('period scores retain true zeroes, missing cells and multiple overtimes without inventing WNBA data',()=>{
  assert.equal(base.lineScore?.complete,true);
  const overtime=normalizeGame('nba',{...raw,home_team_score:122,visitor_team_score:113,home_ot1:5,visitor_ot1:5,home_ot2:7,visitor_ot2:8});
  assert.deepEqual(overtime.lineScore?.periods.slice(-2),[{label:'OT1',home:5,away:5},{label:'OT2',home:7,away:8}]);assert.equal(overtime.lineScore?.complete,true);
  const incomplete=normalizeGame('nba',{...raw,home_q3:null,visitor_q2:'28',home_q4:-1});assert.equal(incomplete.lineScore?.complete,false);assert.equal(incomplete.lineScore?.periods[2].home,null);assert.equal(incomplete.lineScore?.periods[1].away,null);
  const nfl=normalizeGame('nfl',{...raw,home_team_q1:0,home_team_q2:7,home_team_q3:0,home_team_q4:3,visitor_team_q1:0,visitor_team_q2:0,visitor_team_q3:null,visitor_team_q4:7,home_team_score:10,visitor_team_score:7});
  assert.equal(nfl.lineScore?.periods[0].home,0);assert.equal(nfl.lineScore?.periods[2].away,null);assert.equal(nfl.lineScore?.complete,false);
  assert.equal(normalizeGame('wnba',{...raw,home_score:110,away_score:100}).lineScore,null);
  assert.equal(normalizeGame('nba',{...raw,home_q1:null,home_q2:null,home_q3:null,home_q4:null,visitor_q1:null,visitor_q2:null,visitor_q3:null,visitor_q4:null}).lineScore,null);
});

test('advanced details keep all quarter/player content out of protected markup and distinguish scheduled/unavailable data',()=>{
  const protectedHTML=renderToStaticMarkup(createElement(AdvancedGameDetails,{game:stored,hidden:true}));
  assert.match(protectedHTML,/Spoiler protection/);assert.doesNotMatch(protectedHTML,/<table|Test Player|31:22|24|Q1/);
  const visible=renderToStaticMarkup(createElement(AdvancedGameDetails,{game:stored,hidden:false}));
  assert.match(visible,/Q1|Q4|Test Player|31:22|8\/16/);assert.match(visible,/—/);
  const scheduled=renderToStaticMarkup(createElement(AdvancedGameDetails,{game:{...stored,status:'scheduled'},hidden:false}));assert.doesNotMatch(scheduled,/<table|Test Player/);assert.match(scheduled,/once the game is underway/);
  const wnba=renderToStaticMarkup(createElement(AdvancedGameDetails,{game:{...stored,league:'wnba',lineScore:null,playerStats:{status:'disabled',players:[],checkedAt:null}},hidden:false}));assert.match(wnba,/Quarter scores aren’t available|Player statistics aren’t available/);assert.doesNotMatch(wnba,/Test Player|<table/);
  const scheduledWnba=renderToStaticMarkup(createElement(AdvancedGameDetails,{game:{...stored,league:'wnba',status:'scheduled',lineScore:null,playerStats:{status:'disabled',players:[],checkedAt:null}},hidden:false}));assert.doesNotMatch(scheduledWnba,/will appear|Test Player|<table/);assert.match(scheduledWnba,/Quarter scores aren’t available/);assert.match(scheduledWnba,/Player statistics aren’t available/);
});

test('player stats enforce matchup scope, preserve nullable stats and use documented endpoints',async t=>{
  assert.equal(player.values.reb,7);assert.equal(player.values.stl,null);assert.equal(player.values.plus_minus,-5);
  assert.throws(()=>normalizePlayerStats('nba',{...playerRaw,game:{id:99}},7,[10,14]));
  assert.throws(()=>normalizePlayerStats('wnba',{...playerRaw,team:{id:99}},7,[10,14]));
  const football=normalizePlayerStats('nfl',{...playerRaw,total_tackles:4,defensive_sacks:1,sacks:7},7,[10,14]);assert.equal(football.values.defensive_sacks,1);assert.equal(football.values.sacks,undefined);
  const calls:URL[]=[];
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request,init?:RequestInit)=>{const u=new URL(String(input));calls.push(u);assert.equal(u.searchParams.get('game_ids[]'),'7');assert.ok(!u.href.includes('fixture-secret'));assert.equal((init?.headers as Record<string,string>).Authorization,'fixture-secret');return Response.json({data:[playerRaw],meta:{}});});
  for(const league of ['nba','nfl','wnba'] as const)await new BallDontLieAdapter(league,'fixture-secret').getPlayerStats({providerId:7,homeTeamId:10,awayTeamId:14},undefined);
  assert.deepEqual(calls.map(u=>u.pathname),['/v1/stats','/nfl/v1/stats','/wnba/v1/player_stats']);
});

test('player fetching defaults off and validates explicit league configuration',()=>{
  const env={DATABASE_URL:'postgresql://local:local@localhost/bayline',BALLDONTLIE_API_KEY:'fixture-secret'};
  assert.deepEqual(parseWorkerEnv(env).PLAYER_STATS_LEAGUES,[]);
  assert.throws(()=>parseWorkerEnv({...env,PLAYER_STATS_LEAGUES:'nba,unknown'}),/PLAYER_STATS_LEAGUES/);
  assert.throws(()=>parseWorkerEnv({...env,ENABLED_LEAGUES:'nba',PLAYER_STATS_LEAGUES:'nfl'}),/PLAYER_STATS_LEAGUES/);
});

test('actual SQL stores corrected quarter snapshots and only exposes player payloads on game details',async()=>{
  const db=await PGlite.create(),client=db as unknown as PoolClient,pool=db as unknown as Pick<Pool,'query'>;
  try {
    for(const file of ['001_foundation.sql','002_game_ingestion.sql','004_game_media.sql','005_automatic_highlights.sql','006_season_records.sql','007_advanced_game_details.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
    const save=async(game=base)=>{const r=await db.query<{id:string}>("INSERT INTO sync_runs(league,status) VALUES('nba','running') RETURNING id::text");await storeGames(client,'nba',[game],r.rows[0].id,{from:'2026-10-01',to:'2026-10-31'},new Date());};
    await save();
    let requests=0,mode:'ready'|'fail'|'empty'='ready';
    const provider:PlayerStatsProvider={league:'nba',getGames:async()=>({games:[],nextCursor:null}),getPlayerStats:async(_game,cursor)=>{requests++;await db.exec("UPDATE provider_throttle SET next_request_at=now()-interval '1 minute'");if(mode==='fail'&&cursor)throw new ProviderRequestError(403);if(mode==='empty')return {players:[],nextCursor:null};return {players:[{...player,values:{...player.values,pts:requests}}],nextCursor:cursor?null:11};}};
    async function tick(){await db.exec("UPDATE player_stats_gate SET next_check_at=now()-interval '1 second';UPDATE provider_throttle SET next_request_at=now()-interval '1 minute';UPDATE game_player_stats SET next_sync_at=now()-interval '1 second'");await syncNextPlayerStats(client,[provider],['nba'],new AbortController().signal);}
    await configurePlayerStats(client,[]);await syncNextPlayerStats(client,[provider],[],new AbortController().signal);assert.equal(requests,0);assert.equal((await readPlayerStats(pool,'nba',7)).status,'disabled');
    await configurePlayerStats(client,['nba']);await tick();let snapshot=await readPlayerStats(pool,'nba',7);assert.equal(snapshot.status,'ready');assert.equal(snapshot.players.length,1);assert.equal(snapshot.players[0].values.pts,2,'duplicate pages replace a player rather than double-counting');
    const query={league:'nba' as const,view:'all' as const,from:'2026-10-21',to:'2026-10-21'};
    assert.equal((await readGames(pool,query)).data[0].playerStats,undefined);
    const detail=(await readGames(pool,query,7)).data[0];assert.equal(detail.playerStats?.players.length,1);assert.deepEqual(detail.lineScore,base.lineScore);
    await save({...base,lineScore:{...base.lineScore!,periods:base.lineScore!.periods.map((p,i)=>i===0?{...p,home:21}:p),complete:false}});
    assert.equal((await readGames(pool,query,7)).data[0].lineScore?.periods[0].home,21);
    mode='fail';await tick();snapshot=await readPlayerStats(pool,'nba',7);assert.equal(snapshot.status,'delayed');assert.equal(snapshot.players[0].values.pts,2,'a failure on page two cannot publish page one');
    mode='empty';await tick();snapshot=await readPlayerStats(pool,'nba',7);assert.equal(snapshot.status,'delayed');assert.equal(snapshot.players.length,1);
    await configurePlayerStats(client,[]);assert.deepEqual((await readPlayerStats(pool,'nba',7)).players,[]);
  }finally{await db.close();}
});
