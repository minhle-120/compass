// src/tools/search_incidents.js
import { searchIncidents } from '../database/sqlite.js';

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

  const incidents = searchIncidents(query);
  if (sessionContext) {
    sessionContext.matchedIncident = incidents[0] || null;
  }
  return JSON.stringify({ incidents });
}
