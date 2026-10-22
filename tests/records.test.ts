import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool,PoolClient } from 'pg';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tallyRecord,recordsAtGame,currentTeamRecords,recordLabel,seasonForLeague,type RecordDataset } from '../src/shared/records';
import type { NormalizedGame,StoredGame } from '../src/shared/games';
import { normalizeGame } from '../src/server/providers/balldontlie/normalize';
import { syncNextRecordPage,type SeasonProvider } from '../src/server/ingestion/season-records';
import { readRecordBook } from '../src/server/db/records';
import { CurrentRecord,EnteringRecord,AfterGameRecords } from '../src/components/team-record';
import { BallDontLieAdapter } from '../src/server/providers/balldontlie/adapter';

const game=(id:number,date:string,home:number,away:number,status='final'):NormalizedGame=>normalizeGame('nba',{id,home_team:{id:10,full_name:'Golden State Warriors'},visitor_team:{id:14,full_name:'Los Angeles Lakers'},date:date.slice(0,10),datetime:date,season:2026,postseason:false,status_state:status,home_team_score:home,visitor_team_score:away});
const first=game(1,'2026-10-21T02:00:00Z',100,90),second=game(2,'2026-10-23T02:00:00Z',90,100),next=game(3,'2026-10-25T02:00:00Z',0,0,'scheduled');
const dataset=(games:NormalizedGame[]=[first,second,next]):RecordDataset=>({league:'nba',season:2026,phase:'regular',ready:true,checkedAt:'2026-10-24T01:00:00Z',delayed:false,games});
const now=Date.parse('2026-10-24T02:00:00Z');

test('records use season-wide final results, retain historical before/after points, and keep future games at current totals',()=>{
  const book=[dataset()];
  assert.deepEqual(tallyRecord(book[0],10,now),{wins:1,losses:1,ties:0});
  assert.deepEqual(recordsAtGame(first,book,now)?.homeBefore,{wins:0,losses:0,ties:0});
  assert.deepEqual(recordsAtGame(first,book,now)?.homeAfter,{wins:1,losses:0,ties:0});
  assert.deepEqual(recordsAtGame(second,book,now)?.homeBefore,{wins:1,losses:0,ties:0});
  assert.deepEqual(recordsAtGame(second,book,now)?.homeAfter,{wins:1,losses:1,ties:0});
  assert.deepEqual(recordsAtGame(next,book,now)?.homeBefore,{wins:1,losses:1,ties:0});
  assert.deepEqual(recordsAtGame(second,book,now)?.awayBefore,{wins:0,losses:1,ties:0});
  assert.equal(tallyRecord({...book[0],ready:false},10,now),null);
  assert.equal(tallyRecord(dataset([{...first,homeScore:null}]),10,now),null);
  assert.equal(tallyRecord(dataset([{...first,homeScore:90}]),10,now),null,'basketball ties cannot become wins or 0–0');
  assert.deepEqual(tallyRecord(dataset([game(4,first.startsAt!,0,0,'canceled'),game(5,second.startsAt!,0,0,'in_progress')]),10,now),{wins:0,losses:0,ties:0});
  const corrected=dataset([{...first,homeScore:70},second,next]);
  assert.deepEqual(recordsAtGame(next,[corrected],now)?.homeBefore,{wins:0,losses:2,ties:0});
});
test('NFL ties, playoffs and season rollover remain separate',()=>{
  const regular={...dataset([{...first,league:'nfl' as const,homeScore:20,awayScore:20}]),league:'nfl' as const};
  assert.equal(recordLabel(tallyRecord(regular,10,now)!,'nfl'),'0–0–1');
  const playoff={...dataset([{...first,recordPhase:'playoffs' as const}]),phase:'playoffs' as const};
  assert.deepEqual(recordsAtGame({...first,providerId:8,recordPhase:'playoffs'},[dataset(),playoff],now)?.homeBefore,{wins:0,losses:0,ties:0});
  assert.equal(seasonForLeague('nba',new Date('2027-01-10T20:00:00Z')),2026);
  assert.equal(seasonForLeague('nfl',new Date('2027-01-10T20:00:00Z')),2026);
  assert.equal(seasonForLeague('wnba',new Date('2027-06-10T20:00:00Z')),2027);
  const current=currentTeamRecords([dataset(),playoff],now).find(r=>r.league==='nba')!;
  assert.deepEqual(current.regular,{wins:1,losses:1,ties:0});assert.deepEqual(current.playoffs,{wins:1,losses:0,ties:0});
});
test('spoiler protection omits current, entering and postgame record numbers from markup',()=>{
  const current=currentTeamRecords([dataset()],now)[0];
  const stored={...second,localDate:'2026-10-22',observedAt:'',changedAt:'',records:recordsAtGame(second,[dataset()],now)} as StoredGame;
  const sidebar=renderToStaticMarkup(createElement(CurrentRecord,{record:current,league:'nba',hidden:true}));
  assert.match(sidebar,/Record hidden/);assert.doesNotMatch(sidebar,/1–1|2026/);
  const entering=renderToStaticMarkup(createElement(EnteringRecord,{game:stored,home:true,hidden:true}));
  assert.doesNotMatch(entering,/1–0|entering/);
  assert.equal(renderToStaticMarkup(createElement(AfterGameRecords,{game:stored,hidden:true})), '');
  assert.match(renderToStaticMarkup(createElement(AfterGameRecords,{game:stored,hidden:false})),/After this game|1–1/);
});
test('season adapters use verified league-specific free games filters',async t=>{
  const calls:URL[]=[];
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{calls.push(new URL(String(input)));return Response.json({data:[],meta:{}})});
  for(const league of ['nba','nfl','wnba'] as const)for(const phase of ['regular','playoffs'] as const)await new BallDontLieAdapter(league,'fixture-key').getSeasonGames(2026,phase,'2026-10-23',undefined);
  assert.deepEqual(calls.map(u=>u.searchParams.get('season_type')??u.searchParams.get('season_types[]')),['regular','playoffs','2','3','2','3']);
  assert.ok(calls.every(u=>u.pathname.endsWith('/games')&&u.searchParams.get('seasons[]')==='2026'&&!u.searchParams.has('team_ids[]')));
});
test('season pagination publishes atomically, resumes after restart, overlays corrections and retains the previous complete generation on failure',async()=>{
  const db=await PGlite.create(),client=db as unknown as PoolClient,pool=db as unknown as Pick<Pool,'query'>;
  try {
    for(const file of ['001_foundation.sql','002_game_ingestion.sql','006_season_records.sql','007_advanced_game_details.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
    const season=seasonForLeague('nba');
    const firstPage={...first,season},lastPage={...second,season};
    let bad=false;
    const provider:SeasonProvider={league:'nba',getGames:async()=>({games:[],nextCursor:null}),getSeasonGames:async(_season,phase,_end,cursor)=>{
      if(phase==='playoffs')return {games:[],nextCursor:null};
      if(bad)return {games:[{...firstPage,season:season-1}],nextCursor:null};
      return {games:[cursor?lastPage:firstPage],nextCursor:cursor?null:11};
    }};
    async function tick(){await db.exec("UPDATE record_poll_gate SET next_check_at=now()-interval '1 second';UPDATE provider_throttle SET next_request_at=now()-interval '1 minute';");await syncNextRecordPage(client,[provider],new AbortController().signal)}
    await tick();
    let book=await readRecordBook(pool);assert.equal(book.find(d=>d.phase==='regular')?.ready,false);
    await db.exec("UPDATE record_sync SET next_sync_at=now()+interval '1 day' WHERE phase='playoffs'");
    await tick();book=await readRecordBook(pool);
    const regular=book.find(d=>d.phase==='regular')!;
    assert.equal(regular.ready,true);assert.equal(regular.games.length,2);
    assert.deepEqual(tallyRecord(regular,10,now),{wins:1,losses:1,ties:0});
    await db.exec("INSERT INTO teams(league,provider_id,name,enabled) VALUES('nba',14,'Los Angeles Lakers',false)");
    await db.query("INSERT INTO games(league,provider_id,home_team_id,away_team_id,starts_at,status,home_score,away_score,observed_at,season,record_phase) VALUES('nba',1,10,14,$1,'final',70,90,now()+interval '1 minute',$2,'regular')",[first.startsAt,season]);
    book=await readRecordBook(pool);assert.deepEqual(tallyRecord(book.find(d=>d.phase==='regular'),10,now),{wins:0,losses:2,ties:0});
    bad=true;await db.exec("UPDATE record_sync SET next_sync_at=now()-interval '1 second' WHERE phase='regular'");
    await tick();book=await readRecordBook(pool);assert.equal(book.find(d=>d.phase==='regular')?.games.length,2);assert.equal(book.find(d=>d.phase==='regular')?.delayed,true);
    assert.equal((await db.query('SELECT * FROM games')).rows.length,1,'league backfill does not add opponents to the followed schedule');
  }finally{await db.close();}
});
