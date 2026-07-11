import { beforeEach, describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getDb, getTicket, insertTicket } = await import('../../database/sqlite.js');
const { handler, schema } = await import('../delete_resolved_ticket.js');

describe('Delete resolved ticket tool', () => {
  beforeEach(() => {
    getDb().prepare('DELETE FROM tickets').run();
  });

  it('defines the AI tool schema', () => {
    expect(schema.function.name).toBe('delete_resolved_ticket');
    expect(schema.function.parameters.required).toEqual(['ticket_id']);
  });

  it('deletes a completed ticket with a resolved outcome', async () => {
    insertTicket({ id: 'T-DELETE-RESOLVED', status: 'completed' });
    getDb().prepare('UPDATE tickets SET resolution_type = ? WHERE id = ?')
      .run('resolved', 'T-DELETE-RESOLVED');

    const result = await handler({ ticket_id: 'T-DELETE-RESOLVED' });

    expect(result).toMatchObject({ deleted: true, ticket_id: 'T-DELETE-RESOLVED' });
    expect(getTicket('T-DELETE-RESOLVED')).toBeUndefined();
  });

  it('defers deletion of the currently running ticket until resolved finalization', async () => {
    insertTicket({ id: 'T-DEFER-DELETE', status: 'running' });
    const sessionContext = { ticketId: 'T-DEFER-DELETE' };

    const result = await handler({ ticket_id: 'T-DEFER-DELETE' }, sessionContext);

    expect(result).toMatchObject({
      deleted: false,
      deferred: true,
      ticket_id: 'T-DEFER-DELETE'
    });
    expect(sessionContext.deleteAfterResolution).toBe(true);
    expect(getTicket('T-DEFER-DELETE')).toBeDefined();
  });

  it.each([
    ['pending', null],
    ['running', null],
    ['failed', null],
    ['completed', 'rejected'],
    ['completed', 'needs_clarification']
  ])('refuses to delete status %s with outcome %s', async (status, resolutionType) => {
    insertTicket({ id: 'T-KEEP', status });
    getDb().prepare('UPDATE tickets SET resolution_type = ? WHERE id = ?')
      .run(resolutionType, 'T-KEEP');

    await expect(handler({ ticket_id: 'T-KEEP' })).rejects.toMatchObject({
      code: 'TICKET_NOT_RESOLVED'
    });
    expect(getTicket('T-KEEP')).toBeDefined();
  });

  it('returns a not-found error for an unknown ticket', async () => {
    await expect(handler({ ticket_id: 'T-MISSING' })).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND'
    });
  });
});
