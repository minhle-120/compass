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
      error_message TEXT,
      resolution_type TEXT
    );

    CREATE TABLE IF NOT EXISTS problems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'closed')),
      source TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      description_signature TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS problem_tickets (
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      ticket_id TEXT NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL,
      PRIMARY KEY (problem_id, ticket_id)
    );

    CREATE INDEX IF NOT EXISTS idx_problems_open_category_signature
      ON problems(status, category, description_signature);

    CREATE TABLE IF NOT EXISTS kb_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      platforms TEXT,
      game_versions TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      summary TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kb_articles_updated_at ON kb_articles(updated_at);

    CREATE TABLE IF NOT EXISTS slang (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slang TEXT NOT NULL,
      description TEXT NOT NULL,
      example TEXT,
      context TEXT,
      source TEXT NOT NULL, /* 'genz' or 'game' */
      UNIQUE(slang, source)
    );
  `);

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

export function getNextPendingTicket() {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM tickets
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
  `);
  return stmt.get();
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

export function clusterTicketIntoProblem(ticketId, category, severity, reason) {
  const database = getDb();
  const ticket = getTicket(ticketId);
  if (!ticket) {
    throw new Error(`Ticket "${ticketId}" not found.`);
  }

  // Ignore casing, punctuation, and repeated whitespace when comparing reports.
  const descriptionSignature = String(ticket.description || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!descriptionSignature) {
    throw new Error(`Ticket "${ticketId}" has no description to compare.`);
  }

  const existingLink = database.prepare(`
    SELECT p.id, p.category, p.severity, p.reason, p.status, p.source
    FROM problem_tickets pt
    JOIN problems p ON p.id = pt.problem_id
    WHERE pt.ticket_id = ?
  `).get(ticketId);
  if (existingLink) {
    return { problem: existingLink, action: 'already_linked' };
  }

  const matchingProblem = database.prepare(`
    SELECT id, category, severity, reason, status, source
    FROM problems
    WHERE status = 'open' AND category = ? AND description_signature = ?
    LIMIT 1
  `).get(category, descriptionSignature);

  const now = new Date().toISOString();
  if (matchingProblem) {
    database.prepare(`
      INSERT INTO problem_tickets (problem_id, ticket_id, linked_at)
      VALUES (?, ?, ?)
    `).run(matchingProblem.id, ticketId, now);
    return { problem: matchingProblem, action: 'added_to_pile' };
  }

  const result = database.prepare(`
    INSERT INTO problems (
      category, severity, reason, status, source, description_signature, created_at, updated_at
    ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?)
  `).run(category, severity, reason, ticketId, descriptionSignature, now, now);

  const problem = {
    id: Number(result.lastInsertRowid),
    category,
    severity,
    reason,
    status: 'open',
    source: ticketId
  };
  database.prepare(`
    INSERT INTO problem_tickets (problem_id, ticket_id, linked_at)
    VALUES (?, ?, ?)
  `).run(problem.id, ticketId, now);
  return { problem, action: 'created_problem' };
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
    SET draft_response = ?, updated_at = ?
    WHERE id = ?
  `);
  const now = new Date().toISOString();
  stmt.run(draftResponse, now, id);
}

export function updateTicketResolution(id, resolutionType, resolutionReason) {
  const database = getDb();
  const stmt = database.prepare(`
    UPDATE tickets
    SET resolution_type = ?, rationale = ?, updated_at = ?
    WHERE id = ?
  `);
  const now = new Date().toISOString();
  stmt.run(resolutionType, resolutionReason, now, id);
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

