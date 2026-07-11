import { describe, it, expect, beforeEach } from 'vitest';

// Set environment variable to run database in-memory for testing
process.env.DB_PATH = ':memory:';

import { initDb, insertTicket } from '../../database/sqlite.js';
import { handler, schema } from '../read_ticket.js';

describe('Read Ticket Tool', () => {
  beforeEach(() => {
    const db = initDb();
    // Clear tickets table
    db.prepare('DELETE FROM tickets').run();
  });

  it('should define the correct OpenAI tool schema', () => {
    expect(schema.type).toBe('function');
    expect(schema.function.name).toBe('read_ticket');
  });

  it('should read ticket details from database', async () => {
    const mockTicket = {
      id: 'T-READ-TEST',
      subject: 'Network lag',
      description: 'The game is lagging.',
      status: 'pending',
      account_id: 'internal-account',
      platform: 'PC',
      region: 'Asia',
      conversation: [{ sender: 'player', message: 'It happens every match.' }]
    };
    insertTicket(mockTicket);

    const sessionContext = { ticketId: 'T-READ-TEST' };
    const result = await handler({}, sessionContext);
    
    expect(result).toEqual({
      id: 'T-READ-TEST',
      subject: 'Network lag',
      description: 'The game is lagging.',
      platform: 'PC',
      region: 'Asia',
      conversation: [{ sender: 'player', message: 'It happens every match.' }]
    });
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('account_id');
    expect(result).not.toHaveProperty('draft_response');
  });

  it('returns an empty conversation when the ticket has no updates', async () => {
    insertTicket({ id: 'T-NO-UPDATES', subject: 'Question', description: 'How?' });
    await expect(handler({}, { ticketId: 'T-NO-UPDATES' })).resolves.toMatchObject({
      conversation: []
    });
  });

  it('should throw error if ticket is not found in database', async () => {
    const sessionContext = { ticketId: 'T-NONEXIST' };
    await expect(handler({}, sessionContext)).rejects.toThrow('Ticket "T-NONEXIST" not found in database.');
  });
});
