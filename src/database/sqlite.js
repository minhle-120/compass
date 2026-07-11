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
      workflow_revision INTEGER NOT NULL DEFAULT 0,
      resolution_type TEXT,
      resolution_reason TEXT,
      draft_status TEXT
    );

    CREATE TABLE IF NOT EXISTS incident (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      keywords TEXT,
      region TEXT,
      platform TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_incident_category ON incident(category);
    CREATE INDEX IF NOT EXISTS idx_incident_severity ON incident(severity);
    CREATE INDEX IF NOT EXISTS idx_incident_region ON incident(region);
    CREATE INDEX IF NOT EXISTS idx_incident_platform ON incident(platform);

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
  `);

  // Keep existing databases compatible when new workflow columns are added.
  const ticketColumns = new Set(
    db.prepare('PRAGMA table_info(tickets)').all().map((column) => column.name)
  );
  const missingTicketColumns = [
    ['workflow_revision', 'INTEGER NOT NULL DEFAULT 0'],
    ['resolution_type', 'TEXT'],
    ['resolution_reason', 'TEXT'],
    ['draft_status', 'TEXT']
  ];
  for (const [name, definition] of missingTicketColumns) {
    if (!ticketColumns.has(name)) {
      db.exec(`ALTER TABLE tickets ADD COLUMN ${name} ${definition}`);
    }
  }

  const incidentCount = db
    .prepare('SELECT COUNT(*) AS count FROM incident')
    .get().count;

  if (incidentCount === 0) {
    const insertIncident = db.prepare(`
      INSERT INTO incident (
        id, title, summary, category, severity, keywords, region, platform
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const incidents = [
      [
        'INC-001',
        'Players Unable to Log In',
        'Players receive an authentication error when attempting to log in during peak hours.',
        'Authentication',
        'critical',
        'login, authentication, error, account access',
        'Southeast Asia',
        'PC'
      ],
      [
        'INC-002',
        'Missing Purchased Items',
        'Some players completed purchases but the purchased items did not appear in their inventory.',
        'Payment',
        'high',
        'purchase, payment, missing item, inventory',
        'Global',
        'Mobile'
      ],
      [
        'INC-003',
        'High Matchmaking Latency',
        'Players experience long matchmaking times and increased latency when joining ranked matches.',
        'Performance',
        'medium',
        'matchmaking, latency, lag, ranked match',
        'Asia',
        'PC'
      ],
      [
        'INC-004',
        'Game Crashes After Latest Update',
        'The game crashes on startup for some Android devices after installing the latest update.',
        'Crash',
        'high',
        'crash, startup, update, android',
        'Global',
        'Android'
      ],
      [
        'INC-005',
        'Incorrect Ranked Rewards',
        'Some players received rewards for the wrong rank after the competitive season ended.',
        'Rewards',
        'medium',
        'ranked, rewards, season, incorrect reward',
        'Europe',
        'PC'
      ]
    ];

    const insertMany = db.transaction((rows) => {
      for (const incident of rows) {
        insertIncident.run(...incident);
      }
    });

    insertMany(incidents);
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
  const validExcludedIds = Array.isArray(excludedIds) ? excludedIds.filter(Boolean) : [];
  const exclusion = validExcludedIds.length
    ? `AND id NOT IN (${validExcludedIds.map(() => '?').join(', ')})`
    : '';
  const stmt = database.prepare(`
    SELECT * FROM tickets
    WHERE status = 'pending'
    ${exclusion}
    ORDER BY created_at ASC
    LIMIT 1
  `);
  return stmt.get(...validExcludedIds);
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

export function searchIncidents(query) {
  const database = getDb();
  const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const incidents = database.prepare(`
    SELECT id, title, summary, category, severity, keywords, region, platform
    FROM incident
  `).all();

  return incidents
    .map((incident) => {
      const searchableText = [
        incident.title,
        incident.summary,
        incident.category,
        incident.severity,
        incident.keywords,
        incident.region,
        incident.platform
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const score = terms.reduce(
        (total, term) => total + (searchableText.includes(term) ? 1 : 0),
        0
      );

      return { ...incident, score };
    })
    .filter((incident) => incident.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 5);
}

export function getIncident(id) {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM incident WHERE lower(id) = lower(?)`);
  return stmt.get(id);
}

export function searchKnowledgeBase(query) {
  const database = getDb();
  const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const articles = database.prepare(`
    SELECT id, title, status, platforms, game_versions, updated_at, summary, excerpt
    FROM kb_articles
  `).all();

  return articles
    .map((article) => {
      const searchableText = [
        article.title,
        article.summary,
        article.excerpt,
        article.platforms,
        article.game_versions
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const score = terms.reduce(
        (total, term) => total + (searchableText.includes(term) ? 1 : 0),
        0
      );
      return { ...article, score };
    })
    .filter((article) => article.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 5);
}

export function getKnowledgeBaseArticle(id) {
  const database = getDb();
  return database.prepare(`
    SELECT * FROM kb_articles WHERE lower(id) = lower(?)
  `).get(id);
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
    SET draft_response = ?, updated_at = ?
    WHERE id = ?
  `);
  const now = new Date().toISOString();
  stmt.run(draftResponse, now, id);
}

export function getQueueStats() {
  const database = getDb();
  const stats = {
    pending: 0,
    running: 0,
    completed: 0,
    escalated: 0,
    failed: 0
  };
  const rows = database.prepare(`
    SELECT status, COUNT(*) AS count FROM tickets GROUP BY status
  `).all();
  for (const row of rows) {
    if (row.status in stats) stats[row.status] = row.count;
  }
  return stats;
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

function parseConversation(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendTicketMessage(id, sender, message) {
  const database = getDb();
  return database.transaction(() => {
    const ticket = database.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!ticket) return null;

    const conversation = parseConversation(ticket.conversation);
    const timestamp = new Date().toISOString();
    if (ticket.status !== 'running' && ticket.draft_response && ticket.draft_status !== 'pending_review') {
      conversation.push({ sender: 'agent', timestamp, message: ticket.draft_response });
    }
    conversation.push({ sender, timestamp, message });

    database.prepare(`
      UPDATE tickets
      SET conversation = ?, status = 'pending', workflow_revision = workflow_revision + 1,
          categories = NULL, severity = NULL, rationale = NULL,
          routing_destination = NULL, routing_reason = NULL,
          draft_response = NULL, draft_status = NULL,
          resolution_type = NULL, resolution_reason = NULL,
          error_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(conversation), timestamp, id);
    return getTicket(id);
  })();
}

export function finalizeTicket(
  id,
  status,
  resolutionType = null,
  resolutionReason = null,
  { draftResponseMode = 'staff_review' } = {}
) {
  const database = getDb();
  return database.transaction(() => {
    const ticket = database.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!ticket) throw new Error(`Ticket "${id}" not found during finalization`);

    // A player reply changes the ticket back to pending. Do not let an older
    // worker overwrite that newer revision when it finishes.
    if (ticket.status !== 'running') {
      return { status: ticket.status, finalized: false };
    }

    const now = new Date().toISOString();
    let conversation = parseConversation(ticket.conversation);
    let draftResponse = ticket.draft_response;
    let draftStatus = null;
    if (draftResponse && draftResponseMode === 'auto_response') {
      conversation.push({ sender: 'agent', timestamp: now, message: draftResponse });
      draftResponse = null;
      draftStatus = 'published';
    } else if (draftResponse) {
      draftStatus = 'pending_review';
    }

    database.prepare(`
      UPDATE tickets
      SET status = ?, resolution_type = ?, resolution_reason = ?,
          conversation = ?, draft_response = ?, draft_status = ?,
          error_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      status,
      resolutionType,
      resolutionReason,
      JSON.stringify(conversation),
      draftResponse,
      draftStatus,
      now,
      id
    );
    return { status, finalized: true };
  })();
}

export function publishDraftResponse(id) {
  const database = getDb();
  return database.transaction(() => {
    const ticket = database.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!ticket) throw new Error(`Ticket "${id}" not found`);
    if (!ticket.draft_response || ticket.draft_status !== 'pending_review') {
      return { published: false, reason: 'No draft is awaiting staff review.' };
    }

    const now = new Date().toISOString();
    const conversation = parseConversation(ticket.conversation);
    conversation.push({ sender: 'agent', timestamp: now, message: ticket.draft_response });
    database.prepare(`
      UPDATE tickets
      SET conversation = ?, draft_response = NULL, draft_status = 'published', updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(conversation), now, id);
    return { published: true };
  })();
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
