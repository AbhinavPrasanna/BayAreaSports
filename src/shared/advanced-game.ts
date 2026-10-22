import type { FreeLeague } from './games';

export interface PeriodScore { label: string; home: number | null; away: number | null; }
export interface GameLineScore { periods: PeriodScore[]; complete: boolean; }
export interface PlayerGameStats { playerId: number; name: string; position: string | null; teamId: number; values: Record<string, number | string | null>; }
export interface PlayerStatsSnapshot { status: 'disabled' | 'pending' | 'ready' | 'delayed' | 'unavailable'; checkedAt: string | null; players: PlayerGameStats[]; }

export const basketballStatKeys = ['min','pts','reb','ast','stl','blk','fgm','fga','fg3m','fg3a','ftm','fta','turnover','pf','plus_minus'] as const;
export const footballStatKeys = ['passing_completions','passing_attempts','passing_yards','passing_touchdowns','passing_interceptions','rushing_attempts','rushing_yards','rushing_touchdowns','receptions','receiving_targets','receiving_yards','receiving_touchdowns','total_tackles','solo_tackles','defensive_sacks','defensive_interceptions','field_goals_made','field_goal_attempts','extra_points_made'] as const;

// Free game feeds provide individual periods for NBA/NFL. WNBA has no documented period fields.
export function normalizeLineScore(league: FreeLeague, input: Record<string, unknown>, homeTotal: number | null, awayTotal: number | null): GameLineScore | null {
  if (league === 'wnba') return null;
  const cell = (key: string) => typeof input[key] === 'number' && Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= 300 ? input[key] as number : null;
  const home = league === 'nfl' ? 'home_team_' : 'home_';
  const away = league === 'nfl' ? 'visitor_team_' : 'visitor_';
  const periods: PeriodScore[] = Array.from({length:4},(_,i)=>({label:`Q${i+1}`,home:cell(`${home}q${i+1}`),away:cell(`${away}q${i+1}`)}));
  if (league === 'nfl') {
    if (cell(home+'ot') !== null || cell(away+'ot') !== null) periods.push({label:'OT',home:cell(home+'ot'),away:cell(away+'ot')});
  } else {
    const overtime = Object.keys(input).map(k=>/^(?:home|visitor)_ot(\d+)$/.exec(k)).filter(m=>m && (input[m[0]] !== null && input[m[0]] !== undefined)).map(m=>Number(m![1]));
    const count=Math.min(12,Math.max(0,...overtime));
    for(let i=1;i<=count;i++)periods.push({label:`OT${i}`,home:cell(`${home}ot${i}`),away:cell(`${away}ot${i}`)});
  }
  if (!periods.some(p=>p.home!==null||p.away!==null)) return null;
  const complete=periods.every(p=>p.home!==null&&p.away!==null) && homeTotal!==null && awayTotal!==null && periods.reduce((n,p)=>n+p.home!,0)===homeTotal && periods.reduce((n,p)=>n+p.away!,0)===awayTotal;
  return {periods,complete};
}
