// src/tools/search_incidents.js
import { searchIncidents } from '../../services/incident/incidentService.js';

export const schema = {
  type: 'function',
  function: {
    name: 'search_incidents',
    description: 'Search the live incident log for known incidents matching the given keywords. Returns a list of matching incident IDs and summaries.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search for in the incident database.'
        }
      },
      required: ['query']
    }
  }
};

export async function handler(args, sessionContext) {
  return searchIncidents(args?.query);
}
