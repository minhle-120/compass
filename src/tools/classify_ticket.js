// src/tools/classify_ticket.js

export const schema = {
  type: 'function',
  function: {
    name: 'classify_ticket',
    description: 'Assign one or more categories and a severity to the current ticket.',
    parameters: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['bug', 'account', 'payment', 'toxicity', 'feature_request', 'other']
          },
          minItems: 1,
          uniqueItems: true,
          description: 'The categories represented in the ticket.'
        },
        severity: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'The severity level of the ticket.'
        },
        rationale: {
          type: 'string',
          description: 'Brief explanation for the selected categories and severity.'
        }
      },
      required: ['categories', 'severity', 'rationale']
    }
  }
};

export async function handler(args, sessionContext) {
  return 'Ticket classification stub';
}
