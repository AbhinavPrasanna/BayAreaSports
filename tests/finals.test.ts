import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {reviewedFinals} from '../src/shared/finals';
import {finalsAtGame,recordsAtGame,currentTeamRecords,type RecordDataset} from '../src/shared/records';
import type {NormalizedGame,StoredGame} from '../src/shared/games';
import {CurrentRecord,EnteringRecord,FinalsSeriesRecord} from '../src/components/team-record';

const definition=reviewedFinals[0],now=Date.parse('2026-10-22T20:00:00Z');
const games:NormalizedGame[]=definition.games.map((entry,i)=>({provider:'balldontlie',league:'wnba',providerId:entry.providerId,season:2026,recordPhase:'playoffs',
  homeTeamId:entry.homeTeamId,awayTeamId:entry.awayTeamId,homeTeam:{providerId:entry.homeTeamId,name:entry.homeTeamId===13?'Golden State Valkyries':'Atlanta Dream',abbreviation:entry.homeTeamId===13?'GV':'ATL'},awayTeam:{providerId:entry.awayTeamId,name:entry.awayTeamId===13?'Golden State Valkyries':'Atlanta Dream',abbreviation:entry.awayTeamId===13?'GV':'ATL'},
  startsAt:entry.startsAt,calendarDate:entry.startsAt.slice(0,10),status:i<3?'final':'scheduled',homeScore:i===0?68:i===1?65:i===2?97:0,awayScore:i===0?64:i===1?79:i===2?71:0,originalStatus:null,period:null,clock:null}));
const earlier={...games[0],providerId:99,startsAt:'2026-10-01T19:00:00Z',homeScore:99,awayScore:70};
const book=(rows:NormalizedGame[]=[earlier,...games]):RecordDataset[]=>[{league:'wnba',season:2026,phase:'playoffs',ready:true,checkedAt:'2026-10-22T19:00:00Z',delayed:false,games:rows}];
const tally=(wins:number,losses:number)=>({wins,losses,ties:0});

test('finals records keep historical before/after points and future games use the current series only',()=>{
  const first=finalsAtGame(games[0],book(),now)!;
  assert.deepEqual(first.homeBefore,tally(0,0));assert.deepEqual(first.homeAfter,tally(1,0));assert.equal(first.gameNumber,1);
  const second=finalsAtGame(games[1],book(),now)!;
  assert.deepEqual(second.homeBefore,tally(1,0));assert.deepEqual(second.homeAfter,tally(1,1));
  const third=recordsAtGame(games[2],book(),now)!.finals!;
  assert.deepEqual(third.awayBefore,tally(1,1));assert.deepEqual(third.awayAfter,tally(1,2));assert.deepEqual(third.homeAfter,tally(2,1));
  for(const future of games.slice(3)){
    const series=finalsAtGame(future,book(games.slice(0,3)),now)!;
    assert.deepEqual(future.homeTeamId===13?series.homeBefore:series.awayBefore,tally(1,2));
    assert.equal(series.homeAfter,null);assert.equal(series.ifNecessary,series.gameNumber>=6);
  }
  assert.deepEqual(currentTeamRecords(book(),now).find(r=>r.league==='wnba')!.finals,tally(1,2));
  assert.equal(finalsAtGame(earlier,book(),now),null,'other playoff games between the teams are excluded');
  assert.equal(finalsAtGame({...games[0],season:2025},book(),now),null);
  assert.equal(finalsAtGame({...games[0],awayTeamId:5},book(),now),null);
  assert.equal(currentTeamRecords(book(),Date.parse('2026-10-15T20:00:00Z')).find(r=>r.league==='wnba')!.finals,null);
});

test('finals missing history stays pending, corrections are reflected and nonfinal scores do not count',()=>{
  assert.equal(finalsAtGame(games[3],[],now)!.homeBefore,null);
  assert.equal(finalsAtGame(games[3],book([games[0],games[2]]),now)!.homeBefore,null);
  assert.equal(finalsAtGame(games[3],book([{...games[0],homeScore:null},...games.slice(1)]),now)!.homeBefore,null);
  const corrected=[{...games[0],homeScore:60},...games.slice(1)];
  assert.deepEqual(finalsAtGame(games[3],book(corrected),now)!.awayBefore,tally(0,3));
  const live=[games[0],games[1],{...games[2],status:'in_progress' as const},...games.slice(3)];
  assert.deepEqual(finalsAtGame(games[3],book(live),now)!.awayBefore,tally(1,1));
  assert.equal(finalsAtGame(games[3],[{...book()[0],ready:false}],now)!.awayBefore,null);
});

test('completed/upcoming finals UI and sidebar obey spoiler protection',()=>{
  for(const game of [games[2],games[3]]){
    const stored={...game,localDate:game.calendarDate!,observedAt:'',changedAt:'',records:recordsAtGame(game,book(),now)} as StoredGame;
    const visible=renderToStaticMarkup(createElement(FinalsSeriesRecord,{game:stored,hidden:false}));
    assert.match(visible,/WNBA Finals/);assert.match(visible,/1–2|2–1/);
    assert.match(visible,game.status==='final'?/After this game/:/Entering this game/);
    const hidden=renderToStaticMarkup(createElement(FinalsSeriesRecord,{game:stored,hidden:true}));
    assert.match(hidden,/Finals record hidden/);assert.doesNotMatch(hidden,/1–2|2–1|<strong/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(EnteringRecord,{game:stored,home:true,hidden:true})),/Finals|1–2|2–1/);
    const team=renderToStaticMarkup(createElement(EnteringRecord,{game:stored,home:game.homeTeamId===13,hidden:false}));
    assert.match(team,/Finals 1–2/);assert.match(team,game.status==='final'?/after/:/entering/);
  }
  const record=currentTeamRecords(book(),now).find(r=>r.league==='wnba')!;
  assert.match(renderToStaticMarkup(createElement(CurrentRecord,{record,league:'wnba',hidden:false})),/Finals/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(CurrentRecord,{record,league:'wnba',hidden:true})),/Finals|1–2/);
});
