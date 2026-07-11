import { beforeEach, describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';

import { getDb, getTicket, initDb, insertTicket, updateTicketRouting } from '../../database/sqlite.js';
import { handler as routeTicket } from '../route_ticket.js';

describe('route_ticket tool', () => {
  const ticketId = 'T-ROUTE-TEST';

  beforeEach(() => {
    const db = initDb();
    db.prepare('DELETE FROM tickets').run();
  });

  it('successfully routes a ticket and returns markdown confirmation', async () => {
    insertTicket({ id: ticketId, subject: 'Double charge', status: 'pending' });

    const result = await routeTicket({
      destination: 'payment_team',
      reason: 'Billing issue detected'
    }, { ticketId });

    expect(result).toContain('# Ticket routed');
    expect(result).toContain('Destination: payment_team');
    expect(result).toContain('Reason: Billing issue detected');

    const updated = getTicket(ticketId);
    expect(updated.routing_destination).toBe('payment_team');
    expect(updated.routing_reason).toBe('Billing issue detected');
  });

  it('handles rerouting updates with previous destination information', async () => {
    insertTicket({ id: ticketId, subject: 'Compromised card', status: 'pending' });
    updateTicketRouting(ticketId, 'payment_team', 'Initial classification');

    const result = await routeTicket({
      destination: 'account_team',
      reason: 'Account compromise risk is higher'
    }, { ticketId });

    expect(result).toContain('# Ticket rerouted');
    expect(result).toContain('Previous destination: payment_team');
    expect(result).toContain('Destination: account_team');
    expect(result).toContain('Reason: Account compromise risk is higher');

    const updated = getTicket(ticketId);
    expect(updated.routing_destination).toBe('account_team');
    expect(updated.routing_reason).toBe('Account compromise risk is higher');
  });

  it('throws an error if no ticketId is present in session context', async () => {
    await expect(routeTicket({
      destination: 'escalate',
      reason: 'Need help'
    }, {}))
    .rejects.toThrow('No ticket ID is available for routing.');
  });
});
