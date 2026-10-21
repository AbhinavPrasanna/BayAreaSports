import type { GameStatus } from './games';
export function showScores(status: GameStatus): boolean { return ['in_progress', 'final', 'suspended'].includes(status); }
export const statusLabels: Record<GameStatus, string> = {
  scheduled: 'Upcoming', in_progress: 'Live', final: 'Final', postponed: 'Postponed', canceled: 'Canceled', delayed: 'Delayed', suspended: 'Suspended', abandoned: 'Abandoned', unknown: 'Status unavailable',
};
export function ageLabel(iso: string | null, now: number): string {
  if (!iso) return 'Not checked yet';
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 10) return 'Just checked';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
