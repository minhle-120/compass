// src/tools/search_incidents.js
import { searchIncidents as searchPrimaryIncidents } from '../database/sqlite.js';
import { searchIncidents as searchIncidentService } from '../../services/incident/incidentService.js';

export const schema = {
  type: 'function',
  function: {
    name: 'search_incidents',
    description: 'Search the known incident database for incidents matching the player issue. Returns matching incident IDs and summaries ranked by relevance.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords describing the player issue, such as login error or missing purchased item.'
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

  let result = searchIncidentService(query);
  if (result.incidents.length === 0) {
    result = { incidents: searchPrimaryIncidents(query) };
  }
  if (sessionContext) {
    sessionContext.matchedIncident = result.incidents[0] || null;
  }
  return result;
}
