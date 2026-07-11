import { beforeEach, describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';

const { initDb } = await import('../../database/sqlite.js');
const { handler: searchIncidents } = await import('../search_incidents.js');
const { handler: getIncidentDetails } = await import('../get_incident_details.js');

describe('incident tools', () => {
  beforeEach(() => {
    const db = initDb();
    db.prepare('DELETE FROM incident').run();
    const insert = db.prepare(`
      INSERT INTO incident (id, title, summary, category, severity, keywords, region, platform)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const incidents = [
      ['INC-001', 'Players Unable to Log In', 'Players receive an authentication error when attempting to log in during peak hours.', 'Authentication', 'critical', 'login, authentication, error, account access', 'Southeast Asia', 'PC'],
      ['INC-002', 'Missing Purchased Items', 'Some players completed purchases but the purchased items did not appear in their inventory.', 'Payment', 'high', 'purchase, payment, missing item, inventory', 'Global', 'Mobile'],
      ['INC-003', 'High Matchmaking Latency', 'Players experience long matchmaking times and increased latency when joining ranked matches.', 'Performance', 'medium', 'matchmaking, latency, lag, ranked match', 'Asia', 'PC'],
      ['INC-004', 'Game Crashes After Latest Update', 'The game crashes on startup for some Android devices after installing the latest update.', 'Crash', 'high', 'crash, startup, update, android', 'Global', 'Android'],
      ['INC-005', 'Incorrect Ranked Rewards', 'Some players received rewards for the wrong rank after the competitive season ended.', 'Rewards', 'medium', 'ranked, rewards, season, incorrect reward', 'Europe', 'PC']
    ];

    const insertMany = db.transaction((rows) => {
      for (const incident of rows) insert.run(...incident);
    });
    insertMany(incidents);
  });

  it.each([
    ['login authentication error', 'INC-001'],
    ['payment missing inventory', 'INC-002'],
    ['matchmaking lag', 'INC-003'],
    ['android crash update', 'INC-004'],
    ['wrong ranked rewards', 'INC-005']
  ])('ranks the relevant incident first for "%s"', async (query, expectedId) => {
    const result = JSON.parse(await searchIncidents({ query }, {}));
    expect(result.incidents[0].id).toBe(expectedId);
  });

  it('returns an empty list when no incidents match', async () => {
    const result = JSON.parse(await searchIncidents({ query: 'voice chat' }, {}));
    expect(result).toEqual({ incidents: [] });
  });

  it('gets full incident details by ID', async () => {
    const result = JSON.parse(await getIncidentDetails({ incident_id: 'inc-001' }, {}));
    expect(result.incident).toEqual({
      id: 'INC-001',
      title: 'Players Unable to Log In',
      summary: 'Players receive an authentication error when attempting to log in during peak hours.',
      category: 'Authentication',
      severity: 'critical',
      keywords: 'login, authentication, error, account access',
      region: 'Southeast Asia',
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
