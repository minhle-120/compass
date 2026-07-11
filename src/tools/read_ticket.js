import { getTicket } from '../database/sqlite.js';

export const schema = {
  type: 'function',
  function: {
    name: 'read_ticket',
    description: 'Read the current ticket being processed. Returns ticket content, metadata, and status.',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
};

export async function handler(args, sessionContext) {
  const { ticketId } = sessionContext;
  const ticket = getTicket(ticketId);
  if (!ticket) {
    throw new Error(`Ticket "${ticketId}" not found in database.`);
  }
  return JSON.stringify(ticket);
}

