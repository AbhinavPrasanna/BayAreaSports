import type {FreeLeague} from './games';
export interface RosterPlayer {playerId:number;teamId:number;name:string;position:string|null;rosterStatus:string|null;}
export interface InjuryReport extends RosterPlayer {reportedStatus:string|null;description:string|null;reportedAt:string|null;returnDate:string|null;}
export interface PlayerStatus extends RosterPlayer {category:'reported'|'available'|'no_report';reportedStatus:string|null;description:string|null;reportedAt:string|null;returnDate:string|null;}
export interface TeamPlayerStatus {league:FreeLeague;teamId:number;teamName:string;status:'disabled'|'pending'|'ready'|'delayed'|'unavailable';checkedAt:string|null;players:PlayerStatus[];}
export function combinePlayerStatus(roster:RosterPlayer[],injuries:InjuryReport[]):PlayerStatus[]{
  if(!roster.length)throw new Error('Current roster is empty; previous report retained.');
  const rows=new Map<number,PlayerStatus>();
  for(const p of roster){
    const status=p.rosterStatus;
    rows.set(p.playerId,{...p,category:status?'reported':'no_report',reportedStatus:status,description:null,reportedAt:null,returnDate:null});
  }
  for(const p of injuries){
    const old=rows.get(p.playerId);
    if(old&&old.teamId!==p.teamId)throw new Error('Injury report team mismatch.');
    if(old?.reportedAt&&p.reportedAt&&Date.parse(old.reportedAt)>Date.parse(p.reportedAt))continue;
    rows.set(p.playerId,{...old,...p,rosterStatus:old?.rosterStatus??p.rosterStatus,
      category:/^(healthy|available|cleared)$/i.test(p.reportedStatus??'')?'available':'reported'});
  }
  return [...rows.values()].sort((a,b)=>(a.category==='reported'?0:1)-(b.category==='reported'?0:1)||a.name.localeCompare(b.name));
}
