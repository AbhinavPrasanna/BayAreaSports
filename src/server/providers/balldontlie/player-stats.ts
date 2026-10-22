import { z } from 'zod';
import type { FreeLeague } from '../../../shared/games';
import { basketballStatKeys,footballStatKeys,type PlayerGameStats } from '../../../shared/advanced-game';

const rowSchema=z.object({player:z.object({id:z.number().int().positive(),first_name:z.string(),last_name:z.string(),position:z.string().nullable().optional(),position_abbreviation:z.string().nullable().optional()}),team:z.object({id:z.number().int().positive()}),game:z.object({id:z.number().int().positive()})});
export function normalizePlayerStats(league:FreeLeague,input:unknown,gameId:number,teamIds:readonly number[]):PlayerGameStats {
  const result=rowSchema.safeParse(input);
  if(!result.success||result.data.game.id!==gameId||!teamIds.includes(result.data.team.id))throw new Error('Player statistics failed game/team validation.');
  const row=result.data,raw=input as Record<string,unknown>,values:PlayerGameStats['values']={};
  for(const key of league==='nfl'?footballStatKeys:basketballStatKeys){
    const value=raw[key];
    values[key]=key==='min'&&typeof value==='string'&&/^\d{1,3}(?::\d{2})?$/.test(value)?value:typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1_000_000?value:null;
  }
  return {playerId:row.player.id,name:[row.player.first_name.trim(),row.player.last_name.trim()].filter(Boolean).join(' ')||'Player '+row.player.id,position:row.player.position_abbreviation??row.player.position??null,teamId:row.team.id,values};
}
