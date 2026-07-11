import { beforeEach, describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';

import { getDb, getTicket, initDb, insertTicket } from '../../database/sqlite.js';
import { handler as classifyTicket } from '../classify_ticket.js';

describe('classify_ticket problem clustering', () => {
  beforeEach(() => {
    const db = initDb();
    db.prepare('DELETE FROM problem_tickets').run();
    db.prepare('DELETE FROM problems').run();
    db.prepare('DELETE FROM tickets').run();
  });

  it('creates an open problem and adds same-type matching reports to its pile', async () => {
    insertTicket({ id: 'T-ONE', description: 'Game crashes when I start a match.', status: 'pending' });
    insertTicket({ id: 'T-TWO', description: 'GAME crashes when I start a match!!!', status: 'pending' });

    const first = JSON.parse(await classifyTicket({
      categories: ['bug'], severity: 'high', rationale: 'Match-start crash.'
    }, { ticketId: 'T-ONE' }));
    const second = JSON.parse(await classifyTicket({
      categories: ['bug'], severity: 'high', rationale: 'Same crash report.'
    }, { ticketId: 'T-TWO' }));

    expect(first.problem_action).toBe('created_problem');
    expect(second.problem_action).toBe('added_to_pile');
    expect(second.problem.id).toBe(first.problem.id);
    expect(getTicket('T-TWO').categories).toEqual(['bug']);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM problem_tickets').get().count).toBe(2);
  });

  it('does not add a ticket to the same problem twice', async () => {
    insertTicket({ id: 'T-ONE', description: 'Login fails after update.', status: 'pending' });
    const args = { categories: ['account'], severity: 'medium', rationale: 'Login issue.' };

    await classifyTicket(args, { ticketId: 'T-ONE' });
    const repeated = JSON.parse(await classifyTicket(args, { ticketId: 'T-ONE' }));

    expect(repeated.problem_action).toBe('already_linked');
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM problem_tickets').get().count).toBe(1);
  });
});
