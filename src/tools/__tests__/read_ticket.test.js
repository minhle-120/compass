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
    const mockTicket = { id: 'T-READ-TEST', subject: 'Network lag', status: 'pending' };
    insertTicket(mockTicket);

    const sessionContext = { ticketId: 'T-READ-TEST' };
    const result = await handler({}, sessionContext);
    
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe('T-READ-TEST');
    expect(parsed.subject).toBe('Network lag');
  });

  it('should throw error if ticket is not found in database', async () => {
    const sessionContext = { ticketId: 'T-NONEXIST' };
    await expect(handler({}, sessionContext)).rejects.toThrow('Ticket "T-NONEXIST" not found in database.');
  });
});
