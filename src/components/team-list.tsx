import { followedTeams } from '@/shared/games';

export function TeamList() {
  return <ul className="teams">{followedTeams.map(team => <li key={`${team.league}:${team.providerId}`}><span>{team.league.toUpperCase()}</span><h2>{team.name}</h2></li>)}</ul>;
}
