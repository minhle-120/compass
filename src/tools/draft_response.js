// src/tools/draft_response.js
import { updateTicketDraft } from '../database/sqlite.js';

export const schema = {
  type: 'function',
  function: {
    name: 'draft_response',
    description: 'Draft a contextual response to the ticket based on the game knowledge base, incident information, and ticket classification. Generates a reply that addresses the player\'s issue.',
    parameters: {
      type: 'object',
      properties: {
        response: {
          type: 'string',
          description: 'The drafted response text to send back to the player.'
        }
      },
      required: ['response']
    }
  }
};

export async function handler(args, sessionContext) {
  const response = typeof args?.response === 'string' ? args.response.trim() : '';
  if (!response) {
    throw new TypeError('response must be a non-empty string');
  }

  updateTicketDraft(sessionContext.ticketId, response);
  return JSON.stringify({ response });
}
