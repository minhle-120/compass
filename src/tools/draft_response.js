// src/tools/draft_response.js

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
  return 'Ticket draft response stub';
}
