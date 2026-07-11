// src/tools/read_ticket.js
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
  const ticket = getTicket(sessionContext?.ticketId);
  if (!ticket) {
    return JSON.stringify({ error: `Ticket "${sessionContext?.ticketId}" not found`, ticket: null });
  }
  return JSON.stringify({ ticket });
}
