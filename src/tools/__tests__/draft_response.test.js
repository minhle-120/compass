import { beforeEach, describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getDb, getTicket, insertTicket } = await import('../../database/sqlite.js');
const { handler } = await import('../draft_response.js');

describe('draft_response tool', () => {
  beforeEach(() => {
    getDb().prepare('DELETE FROM tickets').run();
    insertTicket({ id: 'T-DRAFT', subject: 'Help', description: 'Question' });
  });

  it('persists a normalized response', async () => {
    const result = await handler({ response: '  Hello player  ' }, { ticketId: 'T-DRAFT' });

    expect(result).toContain('saved successfully');
    expect(getTicket('T-DRAFT').draft_response).toBe('Hello player');
  });

  it('throws for an empty response so the workflow flag remains incomplete', async () => {
    await expect(handler({ response: '   ' }, { ticketId: 'T-DRAFT' }))
      .rejects.toThrow('A drafted response is required');
  });
});
