import { beforeEach, describe, expect, it } from 'vitest';

process.env.INCIDENT_DB_PATH = ':memory:';

const { getIncidentDb } = await import('../db.js');
const {
  getIncidentDetails,
  listUnresolvedIncidents,
  searchIncidents,
  upsertIncident
} = await import('../incidentService.js');
const { handler: searchIncidentTool } = await import('../../../src/tools/search_incidents.js');
const { handler: getIncidentDetailsTool } = await import('../../../src/tools/get_incident_details.js');

const loginIncident = {
  id: 'INC-001',
  title: 'Login outage',
  status: 'active',
  severity: 'critical',
  started_at: '2026-07-11T08:00:00.000Z',
  updated_at: '2026-07-11T09:00:00.000Z',
  platforms: ['PC', 'Console'],
  regions: ['NA'],
  services: ['authentication'],
  symptoms: 'Players cannot sign in',
  summary: 'Authentication requests are failing in North America.',
  category: 'authentication',
  keywords: ['login', 'sign-in'],
  impact: 'Players cannot access the game.',
  guidance: 'Ask players not to reset their passwords.',
  workaround: null,
  resolution: null,
  approved_message: 'We are investigating login failures.'
};

const storeIncident = {
  id: 'INC-002',
  title: 'Store delivery delays',
  status: 'resolved',
  severity: 'medium',
  started_at: '2026-07-10T08:00:00.000Z',
  updated_at: '2026-07-10T10:00:00.000Z',
  platforms: ['Mobile'],
  regions: ['EU'],
  services: ['store'],
  symptoms: 'Purchases arrive late',
  summary: 'Delayed item delivery after purchases.',
  category: 'payment',
  keywords: ['purchase', 'store']
};

describe('incident service', () => {
  beforeEach(() => {
    getIncidentDb().prepare('DELETE FROM incidents').run();
    upsertIncident(loginIncident);
    upsertIncident(storeIncident);
  });

  it('searches case-insensitively across incident fields', () => {
    const result = searchIncidents('SIGN-IN');

    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0]).toMatchObject({
      id: 'INC-001',
      severity: 'critical',
      matched_terms: ['sign-in'],
      source: 'incident_service'
    });
    expect(result.incidents[0].score).toBeGreaterThan(0);
  });

  it('ranks stronger field matches first and respects the result limit', () => {
    upsertIncident({
      ...storeIncident,
      id: 'INC-003',
      title: 'Background service issue',
      keywords: ['login'],
      updated_at: '2026-07-11T10:00:00.000Z'
    });

    const result = searchIncidents('login', { limit: 1 });
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].id).toBe('INC-001');
  });

  it('filters by platform, region, and status case-insensitively', () => {
    expect(searchIncidents('purchase store', {
      platform: 'mobile',
      region: 'eu',
      status: 'RESOLVED'
    }).incidents.map((incident) => incident.id)).toEqual(['INC-002']);

    expect(searchIncidents('purchase store', { platform: 'PC' }).incidents).toEqual([]);
  });

  it('validates malformed optional filters', () => {
    expect(() => searchIncidents('login', { platform: [] }))
      .toThrow('platform must be a non-empty string when provided');
  });

  it('matches multiple terms across different fields', () => {
    const result = searchIncidents('login PC NA');

    expect(result.incidents.map((incident) => incident.id)).toEqual(['INC-001']);
  });

  it('returns structured arrays and full incident guidance', () => {
    const result = getIncidentDetails('inc-001');

    expect(result.incident).toMatchObject({
      id: 'INC-001',
      platforms: ['PC', 'Console'],
      regions: ['NA'],
      guidance: 'Ask players not to reset their passwords.',
      approved_message: 'We are investigating login failures.'
    });
  });

  it('lists unresolved incidents sorted by severity before recency', () => {
    upsertIncident({
      ...storeIncident,
      id: 'INC-003',
      status: 'monitoring',
      severity: 'high',
      updated_at: '2026-07-11T11:00:00.000Z'
    });

    expect(listUnresolvedIncidents().map((incident) => incident.id)).toEqual(['INC-001', 'INC-003']);
  });

  it('returns an explicit not-found result', () => {
    expect(getIncidentDetails('INC-999')).toEqual({
      error: 'Incident "INC-999" not found',
      incident: null
    });
  });

  it('validates missing search queries and incident IDs', () => {
    expect(() => searchIncidents('  ')).toThrow('query must be a non-empty string');
    expect(() => getIncidentDetails()).toThrow('incident_id must be a non-empty string');
  });

  it('exposes the service through thin tool adapters', async () => {
    const searchResult = await searchIncidentTool({
      query: 'purchase store',
      platform: 'Mobile',
      region: 'EU',
      status: 'resolved'
    }, {});
    const detailResult = await getIncidentDetailsTool({ incident_id: 'INC-002' }, {});

    expect(searchResult.incidents.map((incident) => incident.id)).toEqual(['INC-002']);
    expect(detailResult.incident).toMatchObject({ id: 'INC-002', status: 'resolved' });
  });
});
