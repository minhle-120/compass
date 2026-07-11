import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// Set environment variable to run database in-memory for testing
process.env.DB_PATH = ':memory:';

import { 
  initDb, 
  insertTicket, 
  getTicket, 
  updateTicketStatus, 
  failRunningTicket,
  updateTicketClassification, 
  updateTicketRouting, 
  updateTicketDraft, 
  getNextPendingTicket, 
  resetInterruptedTickets,
  getQueueStats,
  finalizeTicket,
  appendTicketMessage,
  publishDraftResponse,
  closeTicketByUser,
  migrateTicketSchema
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

  it('should skip active ticket IDs while selecting pending work', () => {
    insertTicket({ id: 'T-ACTIVE', created_at: '2026-07-11T10:00:00Z', status: 'pending' });
    insertTicket({ id: 'T-NEXT', created_at: '2026-07-11T11:00:00Z', status: 'pending' });

    expect(getNextPendingTicket(['T-ACTIVE']).id).toBe('T-NEXT');
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

  it('should calculate queue stats correctly across different statuses', () => {
    insertTicket({ id: 'T-PEND-1', status: 'pending' });
    insertTicket({ id: 'T-PEND-2', status: 'pending' });
    insertTicket({ id: 'T-RUN-1', status: 'running' });
    insertTicket({ id: 'T-COMP-1', status: 'completed' });
    insertTicket({ id: 'T-FAIL-1', status: 'failed' });

    const stats = getQueueStats();
    expect(stats.pending).toBe(2);
    expect(stats.running).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.escalated).toBe(0);
  });

  it('should preserve a pending player reply instead of overwriting it during finalization', () => {
    insertTicket({ id: 'T-REVISION', status: 'running', conversation: [] });
    appendTicketMessage('T-REVISION', 'player', 'One more detail');

    const result = finalizeTicket('T-REVISION', 'completed', 'resolved', 'Done');
    const ticket = getTicket('T-REVISION');

    expect(result).toEqual({ status: 'pending', finalized: false });
    expect(ticket.workflow_revision).toBe(1);
    expect(ticket.conversation).toHaveLength(1);
    expect(ticket.resolution_type).toBeNull();
  });

  it('stores media attachments on a player reply', () => {
    insertTicket({ id: 'T-REPLY-MEDIA', status: 'running', conversation: [] });
    const attachment = {
      name: 'follow-up.png',
      type: 'image/png',
      size: 1,
      dataUrl: 'data:image/png;base64,YQ=='
    };

    appendTicketMessage('T-REPLY-MEDIA', 'player', 'Here is the screenshot.', [attachment]);

    expect(getTicket('T-REPLY-MEDIA')).toMatchObject({
      status: 'pending',
      workflow_revision: 1,
      conversation: [
        expect.objectContaining({
          sender: 'player',
          message: 'Here is the screenshot.',
          attachments: [attachment]
        })
      ]
    });
  });

  it('should archive the previous agent response before appending a player update', () => {
    insertTicket({ id: 'T-CONVERSATION', status: 'completed', conversation: [] });
    updateTicketDraft('T-CONVERSATION', 'Previous support response');

    appendTicketMessage('T-CONVERSATION', 'player', 'I still need help');

    expect(getTicket('T-CONVERSATION')).toMatchObject({
      status: 'pending',
      draft_response: null,
      conversation: [
        expect.objectContaining({ sender: 'agent', message: 'Previous support response' }),
        expect.objectContaining({ sender: 'player', message: 'I still need help' })
      ]
    });
  });

  it('should not expose an unfinished draft when a player replies during processing', () => {
    insertTicket({ id: 'T-IN-PROGRESS', status: 'running', conversation: [] });
    updateTicketDraft('T-IN-PROGRESS', 'Unfinished internal draft');

    appendTicketMessage('T-IN-PROGRESS', 'player', 'Additional detail');

    expect(getTicket('T-IN-PROGRESS')).toMatchObject({
      status: 'pending',
      draft_response: null,
      conversation: [
        expect.objectContaining({ sender: 'player', message: 'Additional detail' })
      ]
    });
  });

  it('should finalize status and resolution atomically for a running ticket', () => {
    insertTicket({ id: 'T-FINALIZE', status: 'running' });

    expect(finalizeTicket('T-FINALIZE', 'completed', 'resolved', 'Answered')).toEqual({
      status: 'completed',
      finalized: true
    });
    expect(getTicket('T-FINALIZE')).toMatchObject({
      status: 'completed',
      resolution_type: 'resolved',
      resolution_reason: 'Answered'
    });
  });

  it('should migrate resolution_type into a legacy tickets table', () => {
    const legacyDb = new Database(':memory:');
    legacyDb.exec('CREATE TABLE tickets (id TEXT PRIMARY KEY, status TEXT)');

    migrateTicketSchema(legacyDb);

    const columns = legacyDb.prepare('PRAGMA table_info(tickets)').all().map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining([
      'resolution_type', 'resolution_reason', 'workflow_revision', 'draft_status'
    ]));
    legacyDb.close();
  });

  it('should never overwrite a completed ticket with a late worker failure', () => {
    insertTicket({ id: 'T-LATE-ERROR', status: 'running' });
    finalizeTicket('T-LATE-ERROR', 'completed', 'resolved', 'Answered');

    expect(failRunningTicket('T-LATE-ERROR', 'Late worker error')).toBe(false);
    expect(getTicket('T-LATE-ERROR')).toMatchObject({
      status: 'completed',
      error_message: null,
      resolution_type: 'resolved'
    });
  });

  it('allows a player to close an active ticket without deleting it', () => {
    insertTicket({ id: 'T-USER-CLOSE', status: 'running' });

    expect(closeTicketByUser('T-USER-CLOSE')).toBe(true);
    expect(getTicket('T-USER-CLOSE')).toMatchObject({
      status: 'completed',
      resolution_type: 'user_closed',
      resolution_reason: 'Closed manually by the player'
    });
    expect(closeTicketByUser('T-USER-CLOSE')).toBe(false);
  });

  it('lets a player close a ticket that was awaiting clarification', () => {
    insertTicket({ id: 'T-CLOSE-CLARIFY', status: 'running' });
    finalizeTicket('T-CLOSE-CLARIFY', 'completed', 'needs_clarification', 'Need logs');

    expect(closeTicketByUser('T-CLOSE-CLARIFY')).toBe(true);
    expect(getTicket('T-CLOSE-CLARIFY').resolution_type).toBe('user_closed');
  });

  it('should return null when appending a message to a missing ticket', () => {
    expect(appendTicketMessage('T-MISSING', 'player', 'Hello')).toBeNull();
  });

  it('should recover from malformed stored conversation JSON when appending', () => {
    insertTicket({ id: 'T-BAD-CONVERSATION', status: 'completed' });
    initDb().prepare('UPDATE tickets SET conversation = ? WHERE id = ?')
      .run('{bad-json', 'T-BAD-CONVERSATION');

    appendTicketMessage('T-BAD-CONVERSATION', 'player', 'Fresh message');

    expect(getTicket('T-BAD-CONVERSATION').conversation).toEqual([
      expect.objectContaining({ sender: 'player', message: 'Fresh message' })
    ]);
  });

  it('should throw when finalizing a missing ticket', () => {
    expect(() => finalizeTicket('T-MISSING', 'completed', 'resolved', 'Done'))
      .toThrow('not found during finalization');
  });

  it('should publish a finalized draft automatically in auto-response mode', () => {
    insertTicket({ id: 'T-AUTO-DRAFT', status: 'running', conversation: [] });
    updateTicketDraft('T-AUTO-DRAFT', 'Automatic answer');

    finalizeTicket('T-AUTO-DRAFT', 'completed', 'resolved', 'Answered', {
      draftResponseMode: 'auto_response'
    });

    expect(getTicket('T-AUTO-DRAFT')).toMatchObject({
      draft_response: null,
      draft_status: 'published',
      conversation: [
        expect.objectContaining({ sender: 'agent', message: 'Automatic answer' })
      ]
    });
  });

  it('should hold a finalized draft until staff approval in review mode', () => {
    insertTicket({ id: 'T-REVIEW-DRAFT', status: 'running', conversation: [] });
    updateTicketDraft('T-REVIEW-DRAFT', 'Reviewed answer');

    finalizeTicket('T-REVIEW-DRAFT', 'completed', 'resolved', 'Answered', {
      draftResponseMode: 'staff_review'
    });
    expect(getTicket('T-REVIEW-DRAFT')).toMatchObject({
      draft_response: 'Reviewed answer',
      draft_status: 'pending_review',
      conversation: []
    });

    expect(publishDraftResponse('T-REVIEW-DRAFT')).toEqual({ published: true });
    expect(getTicket('T-REVIEW-DRAFT')).toMatchObject({
      draft_response: null,
      draft_status: 'published',
      conversation: [
        expect.objectContaining({ sender: 'agent', message: 'Reviewed answer' })
      ]
    });
  });

  it('should not publish a draft more than once', () => {
    insertTicket({ id: 'T-NO-DRAFT', status: 'completed', conversation: [] });
    expect(publishDraftResponse('T-NO-DRAFT')).toEqual({
      published: false,
      reason: 'No draft is awaiting staff review.'
    });
  });

  it('should cancel rather than expose a pending-review draft when the player replies', () => {
    insertTicket({ id: 'T-REVIEW-REPLY', status: 'running', conversation: [] });
    updateTicketDraft('T-REVIEW-REPLY', 'Draft awaiting approval');
    finalizeTicket('T-REVIEW-REPLY', 'completed', 'resolved', 'Answered', {
      draftResponseMode: 'staff_review'
    });

    appendTicketMessage('T-REVIEW-REPLY', 'player', 'I have more information');

    expect(getTicket('T-REVIEW-REPLY')).toMatchObject({
      status: 'pending',
      draft_response: null,
      draft_status: null,
      conversation: [
        expect.objectContaining({ sender: 'player', message: 'I have more information' })
      ]
    });
  });

  it('should reject staff approval for a missing ticket', () => {
    expect(() => publishDraftResponse('T-MISSING')).toThrow('Ticket "T-MISSING" not found');
  });
});
