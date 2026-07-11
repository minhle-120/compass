// src/tools/search_incidents.js
import { searchIncidents as searchIncidentService } from '../../services/incident/incidentService.js';

export const schema = {
  type: 'function',
  function: {
    name: 'search_incidents',
    description: 'Search known incidents for the player issue. Returns relevance-ranked matches with scores and the terms that matched. Treat a result as a perfect match only when the incident symptom, trigger/scenario, platform, region, and active/monitoring status all fit the current ticket.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords describing the player issue, such as login error or missing purchased item.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          default: 5,
          description: 'Maximum number of incident matches to return.'
        },
        platform: {
          type: 'string',
          description: 'Optional exact platform filter, such as PC, Mobile, or Android.'
        },
        region: {
          type: 'string',
          description: 'Optional exact region filter, such as Asia, Europe, Global, or Southeast Asia.'
        },
        status: {
          type: 'string',
          enum: ['active', 'monitoring', 'resolved'],
          description: 'Optional incident lifecycle status filter.'
        }
      },
      required: ['query']
    }
  }
};

export async function handler(args, sessionContext) {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) {
    throw new TypeError('query must be a non-empty string');
  }

  const limit = Math.min(Math.max(Number.parseInt(args?.limit, 10) || 5, 1), 20);
  const result = searchIncidentService(query, {
    limit,
    platform: args?.platform,
    region: args?.region,
    status: args?.status
  });
  if (sessionContext) {
    sessionContext.matchedIncident = result.incidents[0] || null;
  }
  return result;
}
