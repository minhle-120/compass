import { describe, expect, it } from 'vitest';
import { assertValidTicketId, isValidTicketId } from '../ticketId.js';

describe('ticket ID validation', () => {
  it.each(['T-100', 'ticket_name', 'ABC123'])('accepts safe ID %s', (ticketId) => {
    expect(isValidTicketId(ticketId)).toBe(true);
    expect(assertValidTicketId(ticketId)).toBe(ticketId);
  });

  it.each(['../secret', 'ticket/id', 'ticket id', '', null, 123])('rejects unsafe ID %s', (ticketId) => {
    expect(isValidTicketId(ticketId)).toBe(false);
    expect(() => assertValidTicketId(ticketId)).toThrow('Ticket ID may contain only');
  });
});
