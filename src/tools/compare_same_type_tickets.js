import { compareSameTypeTicketProblems } from '../database/sqlite.js';

export const schema = {
  type: 'function',
  function: {
    name: 'compare_same_type_tickets',
    description: 'Compare the current ticket with open ticket clusters of the same category/type to determine whether the exact same problem and reason already exists.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['bug', 'account', 'payment', 'toxicity', 'feature_request', 'other'],
          description: 'The ticket category/type to compare against.'
        },
        problem_summary: {
          type: 'string',
          description: 'The concise statement of what happened in the current ticket.'
        },
        problem_reason: {
          type: 'string',
          description: 'The exact cause, setting, scenario, or trigger in the current ticket.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 25,
          default: 8,
          description: 'Maximum number of same-type clusters to return.'
        }
      },
      required: ['category', 'problem_summary', 'problem_reason']
    }
  }
};

export async function handler(args, sessionContext) {
  if (!sessionContext?.ticketId) {
    throw new Error('No ticket ID is available for same-type ticket comparison.');
  }

  return compareSameTypeTicketProblems(
    sessionContext.ticketId,
    args?.category,
    args?.problem_summary,
    args?.problem_reason,
    { limit: args?.limit }
  );
}
