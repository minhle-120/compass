import { describe, it, expect, beforeEach } from 'vitest';

// Set environment variable to run database in-memory for testing
process.env.DB_PATH = ':memory:';

import { 
  initDb, 
  insertTicket, 
  getTicket, 
  updateTicketStatus, 
  updateTicketClassification, 
  updateTicketRouting, 
  updateTicketDraft, 
  getNextPendingTicket, 
  resetInterruptedTickets 
} from '../sqlite.js';

describe('SQLite Database Queue Layer', () => {
  beforeEach(() => {
    const db = initDb();
    // Clear tickets table before each test to ensure test isolation
    db.prepare('DELETE FROM tickets').run();
  });

  it('should seed the five default incidents when the incident table is empty', () => {
    const db = initDb();
    const incidents = db.prepare('SELECT id FROM incident ORDER BY id').all();

    expect(incidents).toEqual([
      { id: 'INC-001' },
      { id: 'INC-002' },
      { id: 'INC-003' },
      { id: 'INC-004' },
      { id: 'INC-005' }
    ]);
  });

  it('should insert and retrieve a ticket with JSON fields parsed correctly', () => {
    const mockTicket = {
      id: 'T-1001',
      subject: 'Login failed',
      status: 'pending',
      requester_id: 'player_123',
      account_id: 'acc_456',
      locale: 'en-US',
      region: 'NA',
      platform: 'Android',
      game_version: '1.0.0',
      device: 'Pixel 8',
      description: 'App crashes on start',
      attachments: [{ filename: 'screenshot.png', url: 'https://test/screenshot.png' }],
      conversation: [{ sender: 'player', timestamp: '2026-07-11T11:00:00Z', message: 'Hi' }]
    };

    insertTicket(mockTicket);
    const fetched = getTicket('T-1001');

    expect(fetched).toBeDefined();
    expect(fetched.id).toBe('T-1001');
    expect(fetched.subject).toBe('Login failed');
    expect(fetched.status).toBe('pending');
    expect(fetched.attachments).toEqual(mockTicket.attachments);
    expect(fetched.conversation).toEqual(mockTicket.conversation);
  });

  it('should update ticket status and record error messages', () => {
    const mockTicket = { id: 'T-1002', subject: 'Billing issue', status: 'pending' };
    insertTicket(mockTicket);

    updateTicketStatus('T-1002', 'running');
    let fetched = getTicket('T-1002');
    expect(fetched.status).toBe('running');

    updateTicketStatus('T-1002', 'failed', 'Timeout error from OpenAI');
    fetched = getTicket('T-1002');
    expect(fetched.status).toBe('failed');
    expect(fetched.error_message).toBe('Timeout error from OpenAI');
  });

  it('should update ticket classification details', () => {
    const mockTicket = { id: 'T-1003', subject: 'Billing issue', status: 'pending' };
    insertTicket(mockTicket);

    updateTicketClassification('T-1003', ['payment'], 'high', 'Duplicate charges detected');
    const fetched = getTicket('T-1003');

    expect(fetched.categories).toEqual(['payment']);
    expect(fetched.severity).toBe('high');
    expect(fetched.rationale).toBe('Duplicate charges detected');
  });

  it('should update ticket routing destination and reason', () => {
    const mockTicket = { id: 'T-1004', subject: 'Bug report', status: 'pending' };
    insertTicket(mockTicket);

    updateTicketRouting('T-1004', 'bug_team', 'Report matches known game crashing bug');
    const fetched = getTicket('T-1004');

    expect(fetched.routing_destination).toBe('bug_team');
    expect(fetched.routing_reason).toBe('Report matches known game crashing bug');
  });

  it('should update ticket draft response', () => {
    const mockTicket = { id: 'T-1005', subject: 'General help', status: 'pending' };
    insertTicket(mockTicket);

    updateTicketDraft('T-1005', 'Hello! We are looking into your request.');
    const fetched = getTicket('T-1005');

    expect(fetched.draft_response).toBe('Hello! We are looking into your request.');
  });

  it('should retrieve pending tickets in FIFO order', () => {
    const ticket1 = { id: 'T-EARLY', created_at: '2026-07-11T10:00:00Z', status: 'pending' };
    const ticket2 = { id: 'T-LATE', created_at: '2026-07-11T11:00:00Z', status: 'pending' };
    const ticket3 = { id: 'T-RUNNING', created_at: '2026-07-11T09:00:00Z', status: 'running' };

    insertTicket(ticket1);
    insertTicket(ticket2);
    insertTicket(ticket3);

    const nextPending = getNextPendingTicket();
    expect(nextPending).toBeDefined();
    expect(nextPending.id).toBe('T-EARLY'); // Should get oldest pending ticket
  });

  it('should reset running tickets back to pending on crash recovery', () => {
    const ticket1 = { id: 'T-RUN-1', status: 'running' };
    const ticket2 = { id: 'T-RUN-2', status: 'running', error_message: 'Some error' };
    const ticket3 = { id: 'T-COMP', status: 'completed' };

    insertTicket(ticket1);
    insertTicket(ticket2);
    insertTicket(ticket3);

    const resetCount = resetInterruptedTickets();
    expect(resetCount).toBe(2);

    expect(getTicket('T-RUN-1').status).toBe('pending');
    expect(getTicket('T-RUN-2').status).toBe('pending');
    expect(getTicket('T-RUN-2').error_message).toBeNull();
    expect(getTicket('T-COMP').status).toBe('completed');
  });
});
