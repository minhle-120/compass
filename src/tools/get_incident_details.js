// src/tools/get_incident_details.js
import { getIncident } from '../database/sqlite.js';

export const schema = {
  type: 'function',
  function: {
    name: 'get_incident_details',
    description: 'Get full details of a specific incident by its ID, including its summary, category, severity, keywords, region, and platform.',
    parameters: {
      type: 'object',
      properties: {
        incident_id: {
          type: 'string',
          description: 'The ID of the incident to retrieve details for.'
        }
      },
      required: ['incident_id']
    }
  }
};

export async function handler(args, sessionContext) {
  const incidentId = typeof args?.incident_id === 'string' ? args.incident_id.trim() : '';
  if (!incidentId) {
    throw new TypeError('incident_id must be a non-empty string');
  }

  const incident = getIncident(incidentId);
  if (!incident) {
    return JSON.stringify({ error: `Incident "${incidentId}" not found`, incident: null });
  }

  return JSON.stringify({ incident });
}
