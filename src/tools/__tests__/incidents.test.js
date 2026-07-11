import { beforeEach, describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';

const { initDb } = await import('../../database/sqlite.js');
const { handler: searchIncidents } = await import('../search_incidents.js');
const { handler: getIncidentDetails } = await import('../get_incident_details.js');

describe('incident tools', () => {
  beforeEach(() => {
    const db = initDb();
    db.prepare('DELETE FROM incident').run();
    db.prepare(`
      INSERT INTO incident (id, title, summary, category, severity, keywords, region, platform)
      VALUES
        ('INC-001', 'Login outage', 'Players cannot sign in', 'authentication', 'critical', 'login, sign-in', 'NA', 'PC'),
        ('INC-002', 'Store delay', 'Purchases arrive late', 'payment', 'medium', 'store, purchase', 'EU', 'Mobile')
    `).run();
  });

  it('searches all incident fields case-insensitively', async () => {
    const bySummary = JSON.parse(await searchIncidents({ query: 'SIGN IN' }, {}));
    const byPlatform = JSON.parse(await searchIncidents({ query: 'mobile' }, {}));

    expect(bySummary.incidents).toEqual([
      expect.objectContaining({ id: 'INC-001', summary: 'Players cannot sign in' })
    ]);
    expect(byPlatform.incidents).toEqual([
      expect.objectContaining({ id: 'INC-002', platform: 'Mobile' })
    ]);
  });

  it('returns an empty list when no incidents match', async () => {
    const result = JSON.parse(await searchIncidents({ query: 'matchmaking' }, {}));
    expect(result).toEqual({ incidents: [] });
  });

  it('gets full incident details by ID', async () => {
    const result = JSON.parse(await getIncidentDetails({ incident_id: 'INC-001' }, {}));
    expect(result.incident).toEqual({
      id: 'INC-001',
      title: 'Login outage',
      summary: 'Players cannot sign in',
      category: 'authentication',
      severity: 'critical',
      keywords: 'login, sign-in',
      region: 'NA',
      platform: 'PC'
    });
  });

  it('returns an explicit result when the incident does not exist', async () => {
    const result = JSON.parse(await getIncidentDetails({ incident_id: 'INC-999' }, {}));
    expect(result).toEqual({ error: 'Incident "INC-999" not found', incident: null });
  });

  it('rejects missing search and incident identifiers', async () => {
    await expect(searchIncidents({ query: '  ' }, {})).rejects.toThrow('query must be a non-empty string');
    await expect(getIncidentDetails({}, {})).rejects.toThrow('incident_id must be a non-empty string');
  });
});
