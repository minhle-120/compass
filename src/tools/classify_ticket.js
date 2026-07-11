import { clusterTicketIntoProblem, updateTicketClassification } from '../database/sqlite.js';

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
  const { ticketId } = sessionContext;
  const { categories, severity, rationale } = args;
  if (!ticketId) {
    throw new Error('No ticket ID is available for classification.');
  }

  updateTicketClassification(ticketId, categories, severity, rationale);
  // The first classification category is the ticket type used for grouping.
  const clustering = clusterTicketIntoProblem(ticketId, categories[0], severity, rationale);

  return JSON.stringify({
    ticket_id: ticketId,
    categories,
    severity,
    rationale,
    problem: clustering.problem,
    problem_action: clustering.action
  });
}
