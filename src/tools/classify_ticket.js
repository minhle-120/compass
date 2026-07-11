import { clusterTicketIntoProblem, updateTicketClassification } from '../database/sqlite.js';

const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };

export const schema = {
  type: 'function',
  function: {
    name: 'classify_ticket',
    description: 'Assign one or more categories and a severity to the current ticket. Reuse compare_same_type_tickets.exact_match.id as existing_problem_id when it is the same exact problem and reason.',
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
        },
        problem_summary: {
          type: 'string',
          description: 'A concise, normalized statement of what happened. Use the same wording for tickets that have the same exact player-facing problem. Example: "Game crashes when starting a match".'
        },
        problem_reason: {
          type: 'string',
          description: 'The exact cause, setting, scenario, or trigger behind the problem. Use different wording when the same symptom happens for a different reason. Example: "Ultra graphics setting is enabled".'
        },
        existing_problem_id: {
          type: 'integer',
          description: 'Optional existing problem cluster id from compare_same_type_tickets.exact_match.id. Use this only when the current ticket is the exact same problem and reason.'
        }
      },
      required: ['categories', 'severity', 'rationale', 'problem_summary', 'problem_reason']
    }
  }
};

export async function handler(args, sessionContext) {
  const { ticketId } = sessionContext || {};
  const {
    categories,
    severity,
    rationale,
    problem_summary: problemSummary,
    problem_reason: problemReason,
    existing_problem_id: requestedExistingProblemId
  } = args || {};
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
  if (typeof problemSummary !== 'string' || !problemSummary.trim()) {
    throw new TypeError('problem_summary must be a non-empty string');
  }
  if (typeof problemReason !== 'string' || !problemReason.trim()) {
    throw new TypeError('problem_reason must be a non-empty string');
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

  const comparison = sessionContext?.lastSameTypeComparison;
  const primaryCategory = categories[0];
  const comparisonExactMatch = comparison?.ticket_id === ticketId
    && comparison?.category?.toLowerCase() === primaryCategory.toLowerCase()
    ? comparison.exact_match
    : null;
  const parsedExistingProblemId = Number.parseInt(requestedExistingProblemId, 10);
  const existingProblemId = Number.isInteger(parsedExistingProblemId)
    ? parsedExistingProblemId
    : comparisonExactMatch?.id;
  const effectiveProblemSummary = comparisonExactMatch && existingProblemId === comparisonExactMatch.id
    ? comparisonExactMatch.problem_summary
    : problemSummary;
  const effectiveProblemReason = comparisonExactMatch && existingProblemId === comparisonExactMatch.id
    ? comparisonExactMatch.problem_reason
    : problemReason;

  // 2. Perform deduplication clustering (using primary category categories[0])
  const clustering = clusterTicketIntoProblem(
    ticketId,
    primaryCategory,
    effectiveSeverity,
    effectiveRationale,
    effectiveProblemSummary,
    effectiveProblemReason,
    { existingProblemId }
  );

  return JSON.stringify({
    ticket_id: ticketId,
    categories,
    severity: effectiveSeverity,
    rationale: effectiveRationale,
    problem_summary: effectiveProblemSummary.trim(),
    problem_reason: effectiveProblemReason.trim(),
    problem: clustering.problem,
    problem_action: clustering.action,
    incident: clustering.incident
  });
}
