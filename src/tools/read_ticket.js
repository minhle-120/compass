import { getTicket } from '../database/sqlite.js';

export const schema = {
  type: 'function',
  function: {
    name: 'read_ticket',
    description: 'Read the player-authored content for the current ticket: ID, subject, description, media attachment metadata, and conversation updates.',
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
  return {
    id: ticket.id,
    subject: ticket.subject || '',
    description: ticket.description || '',
    platform: ticket.platform || null,
    region: ticket.region || null,
    attachments: Array.isArray(ticket.attachments)
      ? ticket.attachments.map((attachment) => ({
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          frame_count: Array.isArray(attachment.frames) ? attachment.frames.length : 0
        }))
      : [],
    conversation: Array.isArray(ticket.conversation) ? ticket.conversation : []
  };
}
