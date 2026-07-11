import { deleteResolvedTicket } from '../services/ticketDeletion.js';
import { getTicket } from '../database/sqlite.js';
import { assertValidTicketId } from '../utils/ticketId.js';

export const schema = {
  type: 'function',
  function: {
    name: 'delete_resolved_ticket',
    description: 'Permanently delete an already resolved ticket. When called for the currently running ticket, deletion is deferred and occurs only if idle successfully finalizes it with a resolved outcome. Failed, escalated, rejected, and clarification tickets cannot be deleted.',
    parameters: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The exact ID of the already resolved ticket to permanently delete.'
        }
      },
      required: ['ticket_id']
    }
  }
};

export async function handler(args, sessionContext) {
  const ticketId = assertValidTicketId(args?.ticket_id);
  const ticket = getTicket(ticketId);

  if (ticketId === sessionContext?.ticketId && ticket?.status === 'running') {
    sessionContext.deleteAfterResolution = true;
    return {
      deleted: false,
      deferred: true,
      ticket_id: ticketId,
      message: `Ticket "${ticketId}" will be deleted after it is successfully finalized as resolved.`
    };
  }

  const result = deleteResolvedTicket(ticketId);
  return {
    ...result,
    message: `Resolved ticket "${result.ticket_id}" was permanently deleted.`
  };
}
