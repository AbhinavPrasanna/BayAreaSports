import type { NormalizedGame } from './games';
import type { RecordTally } from './records';

export interface FinalsGame { providerId:number; officialId:string; homeTeamId:number; awayTeamId:number; startsAt:string; ifNecessary:boolean; }
export interface FinalsDefinition { league:'wnba'; season:number; label:string; sourceUrl:string; games:readonly FinalsGame[]; }
export interface GameFinalsRecord { label:string; gameNumber:number; ifNecessary:boolean; homeBefore:RecordTally|null; awayBefore:RecordTally|null; homeAfter:RecordTally|null; awayAfter:RecordTally|null; }

// Reviewed against the WNBA schedule's explicit gameLabel/seriesGameNumber.
// BALLDONTLIE IDs were matched by season, both teams and UTC start time.
// Scope by exact IDs so regular-season meetings and earlier playoff rounds never count.
export const reviewedFinals:readonly FinalsDefinition[]=[{
  league:'wnba',season:2026,label:'WNBA Finals',
  sourceUrl:'https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2.json',
  games:[
    {providerId:1392707,officialId:'1042600301',homeTeamId:13,awayTeamId:4,startsAt:'2026-10-17T19:30:00Z',ifNecessary:false},
    {providerId:1392708,officialId:'1042600302',homeTeamId:13,awayTeamId:4,startsAt:'2026-10-20T00:00:00Z',ifNecessary:false},
    {providerId:1392715,officialId:'1042600303',homeTeamId:4,awayTeamId:13,startsAt:'2026-10-22T00:00:00Z',ifNecessary:false},
    {providerId:1392716,officialId:'1042600304',homeTeamId:4,awayTeamId:13,startsAt:'2026-10-24T17:00:00Z',ifNecessary:false},
    {providerId:1392723,officialId:'1042600305',homeTeamId:13,awayTeamId:4,startsAt:'2026-10-27T00:00:00Z',ifNecessary:false},
    {providerId:1392724,officialId:'1042600306',homeTeamId:4,awayTeamId:13,startsAt:'2026-10-30T00:00:00Z',ifNecessary:true},
    {providerId:1392731,officialId:'1042600307',homeTeamId:13,awayTeamId:4,startsAt:'2026-11-01T00:00:00Z',ifNecessary:true},
  ],
}];
export function matchesFinalsGame(game:NormalizedGame,definition:FinalsDefinition,entry:FinalsGame){
  return game.league===definition.league&&game.season===definition.season&&game.providerId===entry.providerId&&game.homeTeamId===entry.homeTeamId&&game.awayTeamId===entry.awayTeamId;
}
export function finalsForGame(game:NormalizedGame){
  return reviewedFinals.find(definition=>definition.games.some(entry=>matchesFinalsGame(game,definition,entry)));
}
