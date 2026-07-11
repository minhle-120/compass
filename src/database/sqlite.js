// src/database/sqlite.js
import Database from 'better-sqlite3';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let db;

export function initDb() {
  if (db) return db;

  const dbPath = config.dbPath;
  const dbDir = dirname(dbPath);
  if (dbDir && dbDir !== '.') {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath, { timeout: 10000 });
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      subject TEXT,
      status TEXT CHECK(status IN ('pending', 'running', 'completed', 'escalated', 'failed')) DEFAULT 'pending',
      requester_id TEXT,
      account_id TEXT,
      locale TEXT,
      region TEXT,
      platform TEXT,
      game_version TEXT,
      device TEXT,
      description TEXT,
      created_at TEXT,
      updated_at TEXT,
      transaction_id TEXT,
      product TEXT,
      amount TEXT,
      attachments TEXT, /* JSON array of attachment objects */
      conversation TEXT, /* JSON array of message objects */
      categories TEXT, /* JSON array of category strings */
      severity TEXT,
      rationale TEXT,
      routing_destination TEXT,
      routing_reason TEXT,
      draft_response TEXT,
      draft_status TEXT,
      error_message TEXT,
      resolution_type TEXT,
      resolution_reason TEXT,
      workflow_revision INTEGER NOT NULL DEFAULT 0
    );
  `);

  const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all();
  if (!ticketColumns.some((column) => column.name === 'resolution_reason')) {
    db.exec('ALTER TABLE tickets ADD COLUMN resolution_reason TEXT');
  }
  if (!ticketColumns.some((column) => column.name === 'workflow_revision')) {
    db.exec('ALTER TABLE tickets ADD COLUMN workflow_revision INTEGER NOT NULL DEFAULT 0');
  }
  if (!ticketColumns.some((column) => column.name === 'draft_status')) {
    db.exec('ALTER TABLE tickets ADD COLUMN draft_status TEXT');
  }

  logger.info(`SQLite database initialized at ${dbPath}`);
  return db;
}

export function getDb() {
  if (!db) {
    return initDb();
  }
  return db;
}

export function resetInterruptedTickets() {
  const database = getDb();
  const stmt = database.prepare(`
    UPDATE tickets
    SET status = 'pending', error_message = NULL
    WHERE status = 'running'
  `);
  const info = stmt.run();
  if (info.changes > 0) {
    logger.info(`Reset ${info.changes} interrupted ('running') tickets to 'pending'.`);
  }
  return info.changes;
}

export function getNextPendingTicket(excludedIds = []) {
  const database = getDb();
  const exclusions = excludedIds.length
    ? `AND id NOT IN (${excludedIds.map(() => '?').join(', ')})`
    : '';
  const stmt = database.prepare(`
    SELECT * FROM tickets
    WHERE status = 'pending'
    ${exclusions}
    ORDER BY created_at ASC
    LIMIT 1
  `);
  return stmt.get(...excludedIds);
}

export function getTicket(id) {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM tickets WHERE id = ?`);
  const ticket = stmt.get(id);
  if (ticket) {
    // Parse JSON fields
    if (ticket.attachments) ticket.attachments = JSON.parse(ticket.attachments);
    if (ticket.conversation) ticket.conversation = JSON.parse(ticket.conversation);
    if (ticket.categories) ticket.categories = JSON.parse(ticket.categories);
  }
  return ticket;
}

export function updateTicketStatus(id, status, errorMessage = null) {
  const database = getDb();
  const stmt = database.prepare(`
    UPDATE tickets
    SET status = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `);
  const now = new Date().toISOString();
  stmt.run(status, errorMessage, now, id);
}

export function updateTicketClassification(id, categories, severity, rationale) {
  const database = getDb();
  const stmt = database.prepare(`
    UPDATE tickets
    SET categories = ?, severity = ?, rationale = ?, updated_at = ?
    WHERE id = ?
  `);
  const now = new Date().toISOString();
  stmt.run(JSON.stringify(categories), severity, rationale, now, id);
}

export function updateTicketRouting(id, destination, reason) {
  const database = getDb();
  const stmt = database.prepare(`
    UPDATE tickets
    SET routing_destination = ?, routing_reason = ?, updated_at = ?
    WHERE id = ?
  `);
  const now = new Date().toISOString();
  stmt.run(destination, reason, now, id);
}

export function updateTicketDraft(id, draftResponse) {
  const database = getDb();
  const stmt = database.prepare(`
    UPDATE tickets
    SET draft_response = ?, draft_status = 'drafted', updated_at = ?
    WHERE id = ?
  `);
  const now = new Date().toISOString();
  stmt.run(draftResponse, now, id);
}

export function finalizeTicket(id, status, resolutionType, resolutionReason, { draftResponseMode = 'staff_review' } = {}) {
  const database = getDb();
  const finalize = database.transaction(() => {
    const now = new Date().toISOString();
    const ticket = database.prepare(`
      SELECT status, conversation, draft_response
      FROM tickets
      WHERE id = ?
    `).get(id);
    if (!ticket) throw new Error(`Ticket "${id}" not found during finalization.`);
    if (ticket.status !== 'running') return { status: ticket.status, finalized: false };

    let conversation = null;
    let draftResponse = ticket.draft_response;
    let draftStatus = draftResponse ? 'pending_review' : null;
    if (draftResponseMode === 'auto_response' && draftResponse) {
      try { conversation = ticket.conversation ? JSON.parse(ticket.conversation) : []; } catch { conversation = []; }
      conversation.push({ sender: 'agent', timestamp: now, message: draftResponse });
      draftResponse = null;
      draftStatus = 'published';
    }

    const info = database.prepare(`
      UPDATE tickets
      SET status = ?, resolution_type = ?, resolution_reason = ?,
          conversation = COALESCE(?, conversation), draft_response = ?, draft_status = ?,
          error_message = NULL, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(
      status,
      resolutionType,
      resolutionReason,
      conversation ? JSON.stringify(conversation) : null,
      draftResponse,
      draftStatus,
      now,
      id
    );

    if (info.changes === 1) return { status, finalized: true };
    return { status: database.prepare('SELECT status FROM tickets WHERE id = ?').get(id).status, finalized: false };
  });

  return finalize();
}

export function publishDraftResponse(id) {
  const database = getDb();
  const publish = database.transaction(() => {
    const ticket = database.prepare(`
      SELECT conversation, draft_response, draft_status
      FROM tickets
      WHERE id = ?
    `).get(id);
    if (!ticket) throw new Error(`Ticket "${id}" not found.`);
    if (!ticket.draft_response || ticket.draft_status !== 'pending_review') {
      return { published: false, reason: 'No draft is awaiting staff review.' };
    }

    let conversation = [];
    try { conversation = ticket.conversation ? JSON.parse(ticket.conversation) : []; } catch { conversation = []; }
    const now = new Date().toISOString();
    conversation.push({ sender: 'agent', timestamp: now, message: ticket.draft_response });
    database.prepare(`
      UPDATE tickets
      SET conversation = ?, draft_response = NULL, draft_status = 'published', updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(conversation), now, id);

    return { published: true };
  });
  return publish();
}

export function appendTicketMessage(id, sender, message) {
  const database = getDb();
  const append = database.transaction(() => {
    const ticket = database.prepare(`
      SELECT status, conversation, draft_response, draft_status, updated_at
      FROM tickets
      WHERE id = ?
    `).get(id);
    if (!ticket) return null;

    let conversation = [];
    if (ticket.conversation) {
      try { conversation = JSON.parse(ticket.conversation); } catch { conversation = []; }
    }
    const draftWasVisible = ticket.status !== 'pending'
      && ticket.status !== 'running'
      && ticket.draft_status !== 'pending_review';
    if (sender === 'player' && draftWasVisible && ticket.draft_response) {
      conversation.push({
        sender: 'agent',
        timestamp: ticket.updated_at || new Date().toISOString(),
        message: ticket.draft_response
      });
    }
    conversation.push({ sender, timestamp: new Date().toISOString(), message });

    const now = new Date().toISOString();
    database.prepare(`
      UPDATE tickets
      SET conversation = ?, status = 'pending', workflow_revision = workflow_revision + 1,
          draft_response = NULL, draft_status = NULL,
          resolution_type = NULL, resolution_reason = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(conversation), now, id);

    return database.prepare('SELECT workflow_revision FROM tickets WHERE id = ?').get(id);
  });
  return append();
}

export function insertTicket(ticket) {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO tickets (
      id, subject, status, requester_id, account_id, locale, region,
      platform, game_version, device, description, created_at, updated_at,
      transaction_id, product, amount, attachments, conversation
    ) VALUES (
      @id, @subject, @status, @requester_id, @account_id, @locale, @region,
      @platform, @game_version, @device, @description, @created_at, @updated_at,
      @transaction_id, @product, @amount, @attachments, @conversation
    )
    ON CONFLICT(id) DO UPDATE SET
      subject = excluded.subject,
      status = excluded.status,
      description = excluded.description,
      conversation = excluded.conversation,
      updated_at = excluded.updated_at
  `);
  
  stmt.run({
    id: ticket.id,
    subject: ticket.subject || null,
    status: ticket.status || 'pending',
    requester_id: ticket.requester_id || null,
    account_id: ticket.account_id || null,
    locale: ticket.locale || null,
    region: ticket.region || null,
    platform: ticket.platform || null,
    game_version: ticket.game_version || null,
    device: ticket.device || null,
    description: ticket.description || null,
    created_at: ticket.created_at || new Date().toISOString(),
    updated_at: ticket.updated_at || new Date().toISOString(),
    transaction_id: ticket.transaction_id || null,
    product: ticket.product || null,
    amount: ticket.amount || null,
    attachments: ticket.attachments ? JSON.stringify(ticket.attachments) : null,
    conversation: ticket.conversation ? JSON.stringify(ticket.conversation) : null
  });
}

export function getQueueStats() {
  const database = getDb();
  const stmt = database.prepare('SELECT status, COUNT(*) as count FROM tickets GROUP BY status');
  const rows = stmt.all();
  const stats = { pending: 0, running: 0, completed: 0, escalated: 0, failed: 0 };
  for (const row of rows) {
    stats[row.status] = row.count;
  }
  return stats;
}
