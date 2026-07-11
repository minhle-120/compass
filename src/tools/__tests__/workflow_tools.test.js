import { beforeEach, describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getTicket, initDb, insertTicket } = await import('../../database/sqlite.js');
const { handler: readTicket } = await import('../read_ticket.js');
const { handler: searchIncidents } = await import('../search_incidents.js');
const { handler: classifyTicket } = await import('../classify_ticket.js');
const { handler: routeTicket } = await import('../route_ticket.js');
const { handler: draftResponse } = await import('../draft_response.js');
const { handler: searchKnowledgeBase } = await import('../search_knowledge_base.js');
const { handler: getKnowledgeBaseArticle } = await import('../get_knowledge_base_article.js');

describe('support workflow tools', () => {
  let context;

  beforeEach(() => {
    const db = initDb();
    db.prepare('DELETE FROM tickets').run();
    db.prepare('DELETE FROM kb_articles').run();
    insertTicket({
      id: 'T-ANDROID',
      subject: 'Crash after update',
      description: 'The game crashes on startup on Android after the latest update.',
      platform: 'Android',
      region: 'Global'
    });
    db.prepare(`
      INSERT INTO kb_articles (
        id, title, status, platforms, game_versions, updated_at, summary, excerpt, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'KB-001',
      'Android startup troubleshooting',
      'published',
      'Android',
      'latest',
      '2026-07-11T00:00:00Z',
      'Steps for Android startup crashes.',
      'Restart the device and check for updates.',
      'Restart the device, clear the cache, and install the newest game update.'
    );
    context = { ticketId: 'T-ANDROID' };
  });

  it('reads the actual assigned ticket instead of returning a stub', async () => {
    const result = await readTicket({}, context);
    expect(result).toEqual(expect.objectContaining({
      id: 'T-ANDROID',
      description: expect.stringContaining('crashes on startup')
    }));
  });

  it('uses an incident match to prevent severity under-classification', async () => {
    const search = await searchIncidents({ query: 'android crash startup update' }, context);
    expect(search.incidents[0].id).toBe('INC-004');

    const classification = JSON.parse(await classifyTicket({
      categories: ['bug'],
      severity: 'medium',
      rationale: 'The game crashes after an update.'
    }, context));

    expect(classification.severity).toBe('high');
    expect(getTicket('T-ANDROID')).toEqual(expect.objectContaining({
      categories: ['bug'],
      severity: 'high',
      rationale: expect.stringContaining('INC-004')
    }));
  });

  it('persists routing and the drafted player response', async () => {
    await routeTicket({ destination: 'bug_team', reason: 'Matches INC-004.' }, context);
    await draftResponse({ response: 'We are investigating the Android startup crash.' }, context);

    expect(getTicket('T-ANDROID')).toEqual(expect.objectContaining({
      routing_destination: 'bug_team',
      routing_reason: 'Matches INC-004.',
      draft_response: 'We are investigating the Android startup crash.'
    }));
  });

  it('searches and retrieves real knowledge-base records', async () => {
    const search = await searchKnowledgeBase({ query: 'Android startup crash' }, context);
    expect(search.results[0].article_id).toBe('KB-001');

    const details = await getKnowledgeBaseArticle({ article_id: 'kb-001' }, context);
    expect(details.content).toContain('clear the cache');
  });
});
