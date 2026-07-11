// src/tools/get_incident_details.js
import { getIncidentDetails } from '../../services/incident/incidentService.js';

export const schema = {
  type: 'function',
  function: {
    name: 'get_incident_details',
    description: 'Get full details of a specific incident by its ID. Returns incident description, status, affected systems, and resolution notes.',
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
  return getIncidentDetails(args?.incident_id);
}
