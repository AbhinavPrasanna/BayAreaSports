import type {StoredGame} from '@/shared/games';
import {ticketForGame} from '@/shared/tickets';

export function TicketIcon(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="ticket-icon"><path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V6Z"/><path strokeDasharray="2 2" d="M15 7v10"/></svg>;}

export function GameTickets({game,now}:{game:StoredGame;now:number}){
  if(['final','in_progress','canceled','abandoned','suspended'].includes(game.status)||game.startsAt&&Date.parse(game.startsAt)<=now)return null;
  const ticket=ticketForGame(game,now);
  return <section className="game-media game-tickets" aria-label="Game tickets">
    <div className="media-heading"><TicketIcon/><h3>Tickets</h3></div>
    {ticket?<>
      <a className="broadcast-link ticket-link" href={ticket.url} target="_blank" rel="noopener noreferrer" aria-label={`View tickets on Ticketmaster for ${game.awayTeam.name} at ${game.homeTeam.name}`}><span><strong>View tickets on Ticketmaster</strong><small>{ticket.venue}</small></span><span aria-hidden="true">↗</span></a>
      <p className="media-caption">Opens this game’s event page. Ticket availability and prices are shown on Ticketmaster.</p>
      <p className="media-caption">Link verified {new Date(ticket.verifiedAt).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric'})}.</p>
    </>:<p className="media-note">{['delayed','postponed'].includes(game.status)?'The schedule changed. A verified ticket link will appear when the event details are confirmed.':'A specific Ticketmaster event link hasn’t been confirmed for this game yet.'}</p>}
  </section>;
}
