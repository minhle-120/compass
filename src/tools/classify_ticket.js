import { clusterTicketIntoProblem, updateTicketClassification } from '../database/sqlite.js';

const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };

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
  const { ticketId } = sessionContext || {};
  const { categories, severity, rationale } = args || {};
  if (!ticketId) {
    throw new Error('No ticket ID is available for classification.');
  }

  // Input validations
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new TypeError('categories must be a non-empty array');
  }
  if (!(severity in severityRank)) {
    throw new TypeError('severity must be low, medium, high, or critical');
  }
  if (typeof rationale !== 'string' || !rationale.trim()) {
    throw new TypeError('rationale must be a non-empty string');
  }

  // Severity boosting from matched incident
  const incidentSeverity = sessionContext?.matchedIncident?.severity?.toLowerCase();
  const effectiveSeverity = incidentSeverity in severityRank && severityRank[incidentSeverity] > severityRank[severity]
    ? incidentSeverity
    : severity;
  const effectiveRationale = effectiveSeverity !== severity
    ? `${rationale.trim()} Severity raised to ${effectiveSeverity} to match known incident ${sessionContext.matchedIncident.id}.`
    : rationale.trim();

  // 1. Persist the classification to the ticket record
  updateTicketClassification(ticketId, categories, effectiveSeverity, effectiveRationale);

  // 2. Perform deduplication clustering (using primary category categories[0])
  const clustering = clusterTicketIntoProblem(ticketId, categories[0], effectiveSeverity, effectiveRationale);

  return JSON.stringify({
    ticket_id: ticketId,
    categories,
    severity: effectiveSeverity,
    rationale: effectiveRationale,
    problem: clustering.problem,
    problem_action: clustering.action
  });
}
