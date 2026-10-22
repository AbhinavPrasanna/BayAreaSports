import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { matchesGame, verifiedMatch, type HighlightGame } from '../src/server/media/highlight-match';
import { syncNextHighlights, storeAutomaticHighlight } from '../src/server/media/highlight-discovery';
import { YouTubeClient, type YouTubeVideo } from '../src/server/media/youtube';
import { readGames } from '../src/server/db/game-reader';
import { importReviewedMedia } from '../src/server/media/reviewed-media';
import { GameMedia } from '../src/components/game-media';
import { parseWorkerEnv, parseDatabaseEnv } from '../src/server/config/env';
import type { ReviewedMedia } from '../src/shared/game-media';

const now = Date.parse('2026-10-22T06:00:00Z');
const channelId = 'UCWJ2lWNubArHWmf3FIHbfcQ';
const uploadsId = 'UUWJ2lWNubArHWmf3FIHbfcQ';
const secret = 'synthetic-youtube-secret-never-log';
const game: HighlightGame = { league:'nba',providerId:70,homeTeamId:14,awayTeamId:10,startsAt:'2026-10-22T02:00:00.000Z',localDate:'2026-10-21',homeName:'Los Angeles Lakers',awayName:'Golden State Warriors' };
const video: YouTubeVideo = { id:'abcdefghijk',snippet:{title:'WARRIORS at LAKERS | FULL GAME HIGHLIGHTS | October 21, 2026',channelId,publishedAt:'2026-10-22T05:10:00Z',liveBroadcastContent:'none'},status:{privacyStatus:'public',uploadStatus:'processed',embeddable:false},contentDetails:{duration:'PT12M20S'} };
const upload = (v = video) => ({id:v.id,title:v.snippet.title,publishedAt:v.snippet.publishedAt});

test('automatic matching distinguishes dates, opponents, season, full-game uploads and league channel ownership', () => {
  assert.equal(matchesGame(game,upload(),now),true);
  for (const title of [video.snippet.title.replace('21,','20,'),video.snippet.title.replace('LAKERS','CLIPPERS'),video.snippet.title.replace('2026','2025'),video.snippet.title.replace('FULL GAME HIGHLIGHTS','STEPH CURRY HIGHLIGHTS'),'MADDEN '+video.snippet.title,'Preseason '+video.snippet.title])
    assert.equal(matchesGame(game,{...upload(),title},now),false,title);
  assert.equal(matchesGame(game,{...upload(),publishedAt:'2026-10-22T02:30:00Z'},now),false);
  assert.equal(matchesGame(game,{...upload(),publishedAt:'2026-10-26T05:00:00Z'},now),false);
  assert.equal(verifiedMatch(game,video,'UCfakeChannelxxxxxxxxxxxx',now),false);
  for (const candidate of [{...video,status:{...video.status,privacyStatus:'private'}},{...video,snippet:{...video.snippet,liveBroadcastContent:'upcoming'}},{...video,contentDetails:{duration:'PT30S'}}]) assert.equal(verifiedMatch(game,candidate,channelId,now),false);
  const wnba={...game,league:'wnba' as const,homeName:'Golden State Valkyries',awayName:'Atlanta Dream'};
  assert.equal(matchesGame(wnba,{...upload(),title:'Atlanta Dream vs. Golden State Valkyries | FULL GAME HIGHLIGHTS | October 21, 2026'},now),true);
  const nfl={...game,league:'nfl' as const,homeName:'San Francisco 49ers',awayName:'Washington Commanders'};
  const football='Washington Commanders vs San Francisco 49ers Game Highlights | 2026 NFL Season Week 6';
  assert.equal(matchesGame(nfl,{...upload(),title:football},now),true);
  assert.equal(matchesGame(nfl,{...upload(),title:football.replace('2026','2025')},now),false);
  assert.equal(matchesGame({...nfl,startsAt:'2027-01-11T01:00:00Z',localDate:'2027-01-10'}, {...upload(),title:football.replace('Week 6','Wild Card'),publishedAt:'2027-01-11T05:00:00Z'},Date.parse('2027-01-11T06:00:00Z')),true,'January playoff titles use the previous season year');
  assert.equal(matchesGame({...game,localDate:'2026-10-22' },upload(),now),false,'back-to-back games cannot share an NBA date');
});

async function database() {
  const db = await PGlite.create();
  for(const file of ['001_foundation.sql','002_game_ingestion.sql','004_game_media.sql','005_automatic_highlights.sql']) await db.exec(await readFile(`migrations/${file}`,'utf8'));
  await db.query("INSERT INTO teams(league,provider_id,name,enabled) VALUES('nba',14,'Los Angeles Lakers',false)");
  await db.query("INSERT INTO games(league,provider_id,home_team_id,away_team_id,starts_at,calendar_date,status,observed_at,home_score,away_score) VALUES('nba',70,14,10,$1,'2026-10-21','final',now(),100,110)",[game.startsAt]);
  await db.query('UPDATE youtube_discovery_state SET next_check_at=$1',[new Date(now-1)]);
  return db;
}
function mockAPI(videos: YouTubeVideo[] = [video], calls: string[] = []) {
  return (async (input, options) => {
    const url=new URL(String(input));calls.push(url.pathname);
    assert.equal(url.origin,'https://www.googleapis.com');assert.equal(url.searchParams.has('key'),false);
    assert.equal((options?.headers as Record<string,string>)['X-Goog-Api-Key'],secret);
    if(url.pathname.endsWith('/channels')) return Response.json({items:[{id:channelId,snippet:{customUrl:'@NBA'},contentDetails:{relatedPlaylists:{uploads:uploadsId}}}]});
    if(url.pathname.endsWith('/playlistItems')) return Response.json({items:videos.map(v=>({contentDetails:{videoId:v.id},snippet:{title:v.snippet.title,publishedAt:v.snippet.publishedAt,videoOwnerChannelId:channelId}}))});
    if(url.pathname.endsWith('/videos')) return Response.json({items:videos});
    throw Error('Unexpected API method');
  }) as typeof fetch;
}
const query={league:'nba' as const,view:'results' as const,from:'2026-10-21',to:'2026-10-21'};

test('worker discovery persists exact game metadata, protects spoilers, keeps manual precedence and survives restart', async () => {
  const db=await database(), pool=db as unknown as Pick<Pool,'query'>, calls:string[]=[];
  try {
    assert.equal((await syncNextHighlights(pool,secret,['nba'],new AbortController().signal,{now,request:mockAPI([video],calls)})).status,'checked');
    assert.equal(calls.length,3);
    // Discovery uses a fixed test clock; PostgreSQL's read-time expiry uses the
    // wall clock. Keep this read fixture current when tests run in later months.
    await db.exec("UPDATE youtube_highlights SET expires_at=clock_timestamp()+interval '28 days'");
    let stored=(await readGames(pool,query)).data[0];
    assert.equal(stored.media?.highlight?.videoId,video.id);assert.equal(stored.media?.highlight?.embeddable,false);
    assert.equal('automaticMedia' in stored,false);
    const protectedHtml=renderToStaticMarkup(createElement(GameMedia,{game:stored,hideScore:true}));
    assert.match(protectedHtml,/Reveal highlights/);assert.doesNotMatch(protectedHtml,/abcdefghijk|October 21, 2026|youtube\.com|iframe/);
    const openHtml=renderToStaticMarkup(createElement(GameMedia,{game:stored,hideScore:false}));
    assert.match(openHtml,/Open on YouTube/);assert.doesNotMatch(openHtml,/Play highlights|iframe/);
    assert.equal((await syncNextHighlights(pool,secret,['nba'],new AbortController().signal,{now:now+60000,request:mockAPI([video],calls)})).status,'idle');
    assert.equal(calls.length,3,'new scheduler instances honor persisted next-check time');
    const payload=(await db.query<{payload:ReviewedMedia}>('SELECT payload FROM youtube_highlights')).rows[0].payload;
    await importReviewedMedia(pool,[{...payload,highlight:null}]);
    stored=(await readGames(pool,query)).data[0];assert.equal(stored.media?.highlight?.videoId,video.id);
    await importReviewedMedia(pool,[{...payload,highlight:{...payload.highlight!,videoId:'manualclip1'}}]);
    assert.equal((await readGames(pool,query)).data[0].media?.highlight?.videoId,'manualclip1');
    await db.query("UPDATE games SET starts_at=starts_at+interval '1 day'");
    assert.equal(await storeAutomaticHighlight(pool,game,video,now),0,'reject a schedule change during network I/O');
    assert.equal((await readGames(pool,{...query,to:'2026-10-22'})).data[0].media?.highlight,null);
    assert.deepEqual((await db.query('SELECT home_score,away_score FROM games')).rows,[{home_score:100,away_score:110}]);
    await db.query('UPDATE youtube_highlights SET expires_at=$1',[new Date(Date.now()-1000)]);
    await syncNextHighlights(pool,undefined,['nba'],new AbortController().signal,{now:Date.now(),request:mockAPI([],calls)});
    assert.equal((await db.query('SELECT * FROM youtube_highlights')).rows.length,0);
    assert.equal(calls.length,3,'disabled fetching still cleans expired cached data');
  } finally {await db.close();}
});

test('ambiguity and a different uploader never attach a video, even when playlist titles match', async () => {
  const db=await database(),pool=db as unknown as Pick<Pool,'query'>;
  try {
    for(const videos of [[video,{...video,id:'anotherclip'}],[{...video,snippet:{...video.snippet,channelId:'UCuntrustedUploaderxxxxxx'}}]]) {
      await db.query('UPDATE youtube_discovery_state SET next_check_at=$1',[new Date(now-1)]);
      await syncNextHighlights(pool,secret,['nba'],new AbortController().signal,{now,request:mockAPI(videos)});
      assert.equal((await db.query('SELECT * FROM youtube_highlights')).rows.length,0);
    }
  }finally{await db.close();}
});

test('API failures and daily caps persist backoff without disclosing keys or interrupting score reads', async () => {
  const db=await database(),pool=db as unknown as Pick<Pool,'query'>,signal=new AbortController().signal;
  try {
    const denied=(async()=>Response.json({error:{message:secret,errors:[{reason:'quotaExceeded'}]}},{status:403})) as typeof fetch;
    const result=await syncNextHighlights(pool,secret,['nba'],signal,{now,request:denied});
    assert.deepEqual(result,{status:'failed',league:'nba',code:'YOUTUBE_QUOTA'});assert.ok(!JSON.stringify(result).includes(secret));
    let state=(await db.query<{next_check_at:Date}>('SELECT next_check_at FROM youtube_discovery_state WHERE league=\'nba\'')).rows[0];
    assert.equal(state.next_check_at.getTime(),now+86400_000);
    let requests=0;
    await db.query("UPDATE youtube_discovery_state SET next_check_at=$1,quota_day=($2::timestamptz AT TIME ZONE 'America/Los_Angeles')::date,requests_today=500 WHERE league='nba'",[new Date(now-1),new Date(now)]);
    const blocked=await syncNextHighlights(pool,secret,['nba'],signal,{now,request:(async()=>{requests++;throw Error(secret)}) as typeof fetch});
    assert.deepEqual(blocked,{status:'failed',league:'nba',code:'YOUTUBE_LOCAL_QUOTA'});assert.equal(requests,0);
    assert.equal((await readGames(pool,query)).data[0].awayScore,110);
  } finally {await db.close();}
});

test('refresh removes a deleted/private upload and optional configuration never exposes the YouTube key to web code',async()=>{
  const db=await database(),pool=db as unknown as Pick<Pool,'query'>;
  try{
    await storeAutomaticHighlight(pool,game,video,now-8*86400_000);
    await syncNextHighlights(pool,secret,['nba'],new AbortController().signal,{now,request:mockAPI([])});
    assert.equal((await db.query('SELECT * FROM youtube_highlights')).rows.length,0);
    const env={DATABASE_URL:'postgresql://test:test@localhost/test',BALLDONTLIE_API_KEY:'test-key',YOUTUBE_API_KEY:secret};
    assert.deepEqual(parseDatabaseEnv(env),{DATABASE_URL:env.DATABASE_URL});
    assert.equal(parseWorkerEnv({...env,YOUTUBE_API_KEY:''}).YOUTUBE_API_KEY,undefined);
    assert.equal(parseWorkerEnv({...env,HIGHLIGHTS_ENABLED:'false'}).HIGHLIGHTS_ENABLED,false);
    assert.throws(()=>parseWorkerEnv({...env,YOUTUBE_API_KEY:'bad'}),/YOUTUBE_API_KEY/);
    const controller=new AbortController();controller.abort();let fetched=false;
    await assert.rejects(new YouTubeClient(secret,async()=>{},controller.signal,(async()=>{fetched=true}) as unknown as typeof fetch).videos([video.id]));assert.equal(fetched,false);
  }finally{await db.close();}
});
