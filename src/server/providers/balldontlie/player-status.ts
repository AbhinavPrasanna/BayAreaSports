import {z} from 'zod';
import type {FreeLeague} from '../../../shared/games';
import type {RosterPlayer,InjuryReport} from '../../../shared/player-status';
const player=z.object({id:z.number().int().positive(),first_name:z.string(),last_name:z.string(),position:z.string().nullable().optional(),position_abbreviation:z.string().nullable().optional(),team_id:z.number().int().optional(),team:z.object({id:z.number().int()}).nullable().optional()});
const text=(value:unknown,max=3000)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):null;
export function normalizeRosterPlayer(league:FreeLeague,input:unknown,teamId:number):RosterPlayer {
  const parsed=player.safeParse(input).data;
  if(!parsed)throw new Error('Roster row failed validation.');
  const scoped=parsed.team_id??parsed.team?.id;
  if(scoped!==teamId)throw new Error('Roster team filter mismatch.');
  return {playerId:parsed.id,teamId,name:[parsed.first_name.trim(),parsed.last_name.trim()].filter(Boolean).join(' ')||'Player '+parsed.id,
    position:text(parsed.position_abbreviation??parsed.position,80),rosterStatus:null};
}
export function normalizeInjuryReport(league:FreeLeague,input:unknown,teamId:number):InjuryReport {
  const row=z.object({player:player}).parse(input),raw=input as Record<string,unknown>;
  const scoped=row.player.team_id??row.player.team?.id;if(scoped!==teamId)throw new Error('Injury team filter mismatch.');
  const p=row.player;
  const reportedAt=text(raw.date??raw.updated_at,100);
  return {playerId:p.id,teamId,name:[p.first_name.trim(),p.last_name.trim()].filter(Boolean).join(' ')||'Player '+p.id,
    position:text(p.position_abbreviation??p.position,80),rosterStatus:null,reportedStatus:text(raw.status,100),description:text(raw.description??raw.comment),
    reportedAt:reportedAt&&Number.isFinite(Date.parse(reportedAt))?new Date(reportedAt).toISOString():null,returnDate:text(raw.return_date,100)};
}
