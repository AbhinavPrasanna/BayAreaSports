import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {ticketmasterEventId,ticketForGame,type GameTicket} from '../src/shared/tickets';
import {gameMedia,parseMediaCatalog,resolveGameMedia,type ReviewedMedia} from '../src/shared/game-media';
import type {StoredGame} from '../src/shared/games';
import {GameTickets} from '../src/components/game-tickets';
import {GameCard} from '../src/components/game-ui';
import {importReviewedMedia} from '../src/server/media/reviewed-media';
import {readGames} from '../src/server/db/game-reader';
import {pacificDate} from '../src/shared/dates';

const now=Date.parse('2026-10-30T19:25:00Z');
const game:StoredGame={provider:'balldontlie',league:'nba',providerId:7,homeTeamId:10,awayTeamId:14,startsAt:'2026-11-02T01:30:00Z',calendarDate:'2026-11-01',localDate:'2026-11-01',status:'scheduled',originalStatus:null,period:null,clock:null,homeScore:0,awayScore:0,homeTeam:{providerId:10,name:'Golden State Warriors',abbreviation:'GSW'},awayTeam:{providerId:14,name:'Los Angeles Lakers',abbreviation:'LAL'},observedAt:new Date(now).toISOString(),changedAt:new Date(now).toISOString()};
const ticket:GameTicket={eventId:'AAAAAAAAAAAAAAAA',url:'https://www.ticketmaster.com/event/AAAAAAAAAAAAAAAA',startsAt:game.startsAt!,venue:'Test arena',verifiedAt:new Date(now).toISOString()};
const entry:ReviewedMedia={league:'nba',providerId:7,homeTeamId:10,awayTeamId:14,startsAt:game.startsAt!,verifiedAt:ticket.verifiedAt,sourceUrl:'https://www.nba.com/warriors/schedule',broadcasts:[],highlight:null,ticket};

test('ticket links must identify one exact Ticketmaster event and reject generic, unsafe or conflicting assignments',()=>{
  assert.equal(ticketmasterEventId(ticket.url),ticket.eventId);
  assert.equal(ticketmasterEventId('https://www.ticketmaster.com/event/Z7r9jZ1AAZI-V'),'Z7r9jZ1AAZI-V');
  for(const url of ['http://www.ticketmaster.com/event/AAAAAAAAAAAAAAAA','https://www.ticketmaster.com.evil.test/event/AAAAAAAAAAAAAAAA','https://user:secret@www.ticketmaster.com/event/AAAAAAAAAAAAAAAA','https://www.ticketmaster.com:444/event/AAAAAAAAAAAAAAAA','https://am.ticketmaster.com/warriors','https://www.ticketmaster.com/search?q=warriors','https://www.ticketmaster.com/artist/805946','https://www.ticketmaster.com/event/AAAAAAAAAAAAAAAA?redirect=https://evil.test','https://www.ticketmaster.com/event/AAAAAAAAAAAAAAAA#other','javascript:alert(1)']){
    assert.equal(ticketmasterEventId(url),null);assert.throws(()=>parseMediaCatalog([{...entry,ticket:{...ticket,url}}]));
  }
  assert.throws(()=>parseMediaCatalog([{...entry,ticket:{...ticket,eventId:'BBBBBBBBBBBBBBBB'}}]));
  assert.throws(()=>parseMediaCatalog([entry,{...entry,providerId:8}]));
  assert.throws(()=>parseMediaCatalog([{...entry,ticket:{...ticket,startsAt:'2026-11-03T01:30:00Z'}}]));
});

test('ticket metadata binds the league, game, home/away teams and exact start time, including UTC date boundaries',()=>{
  assert.equal(gameMedia(game,entry,now).ticket?.eventId,ticket.eventId);
  assert.equal(gameMedia({...game,startsAt:'2026-11-01T17:30:00-08:00'},entry,now).ticket?.eventId,ticket.eventId);
  for(const changed of [{...game,league:'nfl' as const},{...game,providerId:8},{...game,homeTeamId:14,awayTeamId:10},{...game,startsAt:'2026-11-03T01:30:00Z'},{...game,startsAt:null}])assert.equal(gameMedia(changed,entry,now).ticket,null);
  for(const status of ['final','in_progress','delayed','postponed','canceled','unknown'] as const)assert.equal(gameMedia({...game,status},entry,now).ticket,null);
});

test('expired reviews and past starts hide purchase links; fresh broadcasts cannot refresh a stale ticket review',()=>{
  const withMedia={...game,media:gameMedia(game,entry,now)};
  assert.equal(ticketForGame(withMedia,Date.parse(game.startsAt!)),null);
  assert.equal(ticketForGame(withMedia,now,{...ticket,verifiedAt:new Date(now+300_001).toISOString()}),null);
  const stale={...entry,ticket:{...ticket,verifiedAt:new Date(now-31*86400_000).toISOString()}};
  assert.equal(gameMedia(game,stale,now).ticket,null);
  const official={...entry,verifiedAt:new Date(now+1000).toISOString(),ticket:undefined};
  assert.equal(resolveGameMedia(game,stale,null,official,new Date(now+86400_000).toISOString(),false,now).ticket,null);
  assert.equal(resolveGameMedia(game,entry,null,official,new Date(now+86400_000).toISOString(),false,now).ticket?.verifiedAt,ticket.verifiedAt);
});

test('cards and details offer direct event links with phone-sized actions while preserving spoiler protection and honest gaps',()=>{
  for(const league of ['nba','nfl','wnba'] as const){
    const source={...entry,league},g={...game,league};g.media=gameMedia(g,source,now);
    const card=renderToStaticMarkup(createElement(GameCard,{game:g,now,delayed:false,hideScore:true,protection:true,onReveal(){},onOpen(){}}));
    const details=renderToStaticMarkup(createElement(GameTickets,{game:g,now}));
    for(const html of [card,details]){assert.match(html,/https:\/\/www.ticketmaster.com\/event\/AAAAAAAAAAAAAAAA/);assert.match(html,/target="_blank"/);assert.match(html,/rel="noopener noreferrer"/);assert.doesNotMatch(html,/youtube|iframe|thumbnail|WIN|0–0/);}
    assert.match(card,/View tickets/);assert.match(details,/Ticket availability and prices are shown on Ticketmaster/);
  }
  const absent=renderToStaticMarkup(createElement(GameTickets,{game:{...game,media:gameMedia(game,null,now)},now}));
  assert.match(absent,/hasn’t been confirmed/);assert.doesNotMatch(absent,/href=|Search/);
  for(const status of ['final','in_progress','canceled'] as const)assert.equal(renderToStaticMarkup(createElement(GameTickets,{game:{...game,status,media:gameMedia(game,entry,now)},now})), '');
});

test('SQL imports retain viewing data and store ticket metadata idempotently; rescheduled reads suppress the old event link',async()=>{
  const db=await PGlite.create(),pool=db as unknown as Pick<Pool,'query'>;
  try{
    for(const file of ['001_foundation.sql','002_game_ingestion.sql','004_game_media.sql','005_automatic_highlights.sql','006_season_records.sql','007_advanced_game_details.sql','008_player_status.sql','009_official_broadcasts.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
    const startsAt=new Date(Date.now()+86400_000).toISOString(),day=pacificDate(new Date(startsAt));
    const payload={...entry,startsAt,verifiedAt:new Date().toISOString(),broadcasts:[{label:'ESPN',url:'https://www.espn.com/watch/',kind:'stream' as const,region:'US' as const,access:'Subscription required.'}],ticket:{...ticket,startsAt,verifiedAt:new Date().toISOString()}};
    await db.exec("INSERT INTO teams(league,provider_id,name,enabled) VALUES('nba',14,'Los Angeles Lakers',false) ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO games(league,provider_id,home_team_id,away_team_id,starts_at,calendar_date,status,observed_at,home_score,away_score) VALUES('nba',7,10,14,$1,$2,'scheduled',now(),0,0)",[startsAt,day]);
    assert.equal((await importReviewedMedia(pool,[payload])).changed,1);assert.equal((await importReviewedMedia(pool,[payload])).changed,0);
    let stored=(await readGames(pool,{league:'nba',view:'all',from:day,to:day})).data[0];
    assert.equal(stored.media?.ticket?.eventId,ticket.eventId);assert.equal(stored.media?.broadcasts[0].label,'ESPN');assert.equal(stored.homeScore,0);
    await db.query("UPDATE games SET starts_at=starts_at+interval '1 hour' WHERE league='nba' AND provider_id=7");
    stored=(await readGames(pool,{league:'nba',view:'all',from:day,to:pacificDate(new Date(Date.parse(startsAt)+3600_000))})).data[0];assert.equal(stored.media?.ticket,null);
  }finally{await db.close();}
});

test('shipped ticket catalog covers all three leagues with distinct event URLs and matching game times',async()=>{
  const catalog=parseMediaCatalog(JSON.parse(await readFile('data/reviewed-game-media.json','utf8'))),tickets=catalog.filter(entry=>entry.ticket);
  assert.ok(tickets.length>=19);assert.deepEqual([...new Set(tickets.map(entry=>entry.league))].sort(),['nba','nfl','wnba']);
  for(const entry of tickets)assert.equal(Date.parse(entry.ticket!.startsAt),Date.parse(entry.startsAt));
});
