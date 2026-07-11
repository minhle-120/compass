// src/tools/route_ticket.js
import { updateTicketRouting } from '../database/sqlite.js';

export const schema = {
  type: 'function',
  function: {
    name: 'route_ticket',
    description: "Route the ticket to the appropriate destination. Use 'escalate' to send to human support when the AI cannot resolve the ticket, or specify a department for routing.",
    parameters: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          enum: ['escalate', 'bug_team', 'account_team', 'payment_team', 'moderation'],
          description: "Where to route the ticket. Use 'escalate' for human support when AI cannot resolve."
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of why the ticket is being routed here.'
        }
      },
      required: ['destination', 'reason']
    }
  }
};

export async function handler(args, sessionContext) {
  const { destination, reason } = args || {};
  if (typeof destination !== 'string' || !destination.trim()) {
    throw new TypeError('destination must be a non-empty string');
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new TypeError('reason must be a non-empty string');
  }

  updateTicketRouting(sessionContext.ticketId, destination, reason.trim());
  return JSON.stringify({ destination, reason: reason.trim() });
}
