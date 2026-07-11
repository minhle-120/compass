import { describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';
process.env.INCIDENT_DB_PATH = ':memory:';

const { handler: searchIncidents } = await import('../search_incidents.js');
const { handler: getIncidentDetails } = await import('../get_incident_details.js');

describe('incident tools', () => {
  it.each([
    ['login authentication error', 'INC-001'],
    ['payment missing inventory', 'INC-002'],
    ['matchmaking lag', 'INC-003'],
    ['android crash update', 'INC-004'],
    ['wrong ranked rewards', 'INC-005']
  ])('ranks the relevant incident first for "%s"', async (query, expectedId) => {
    const result = await searchIncidents({ query }, {});
    expect(result.incidents[0].id).toBe(expectedId);
  });

  it('returns an empty list when no incidents match', async () => {
    const result = await searchIncidents({ query: 'voice chat' }, {});
    expect(result).toEqual({ incidents: [] });
  });

  it('gets full incident details by ID', async () => {
    const result = await getIncidentDetails({ incident_id: 'inc-001' }, {});
    expect(result.incident).toMatchObject({
      id: 'INC-001',
      title: 'Players Unable to Log In',
      category: 'Authentication',
      severity: 'critical',
      keywords: ['login', 'authentication', 'error', 'account access'],
      regions: ['Southeast Asia'],
      platforms: ['PC']
    });
  });

  it('returns an explicit result when the incident does not exist', async () => {
    const result = await getIncidentDetails({ incident_id: 'INC-999' }, {});
    expect(result).toEqual({ error: 'Incident "INC-999" not found', incident: null });
  });

  it('rejects missing search and incident identifiers', async () => {
    await expect(searchIncidents({ query: '  ' }, {})).rejects.toThrow('query must be a non-empty string');
    await expect(getIncidentDetails({}, {})).rejects.toThrow('incident_id must be a non-empty string');
  });
});
