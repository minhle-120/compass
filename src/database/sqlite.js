// src/database/sqlite.js
import Database from 'better-sqlite3';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { upsertIncident } from '../../services/incident/incidentService.js';

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
      problem_summary TEXT,
      problem_reason TEXT,
      problem_signature TEXT,
      incident_id TEXT,
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

  migrateTicketSchema(db);
  migrateProblemSchema(db);
  promoteEligibleProblemClusters();

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

export function migrateTicketSchema(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(tickets)').all().map((column) => column.name));
  const migrations = [
    ['resolution_type', 'TEXT'],
    ['resolution_reason', 'TEXT'],
    ['workflow_revision', 'INTEGER NOT NULL DEFAULT 0'],
    ['draft_status', 'TEXT']
  ];

  for (const [name, definition] of migrations) {
    if (!columns.has(name)) database.exec(`ALTER TABLE tickets ADD COLUMN ${name} ${definition}`);
  }
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

export function deleteResolvedTicketRecord(id) {
  const result = getDb().prepare(`
    DELETE FROM tickets
    WHERE id = ? AND status = 'completed' AND resolution_type = 'resolved'
  `).run(id);
  return result.changes === 1;
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

export function failRunningTicket(id, errorMessage) {
  const info = getDb().prepare(`
    UPDATE tickets
    SET status = 'failed', error_message = ?, updated_at = ?
    WHERE id = ? AND status = 'running'
  `).run(errorMessage, new Date().toISOString(), id);
  return info.changes === 1;
}

export function migrateProblemSchema(database) {
  const tables = new Set(database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => row.name));
  if (!tables.has('problems')) return;

  const columns = new Set(database.prepare('PRAGMA table_info(problems)').all().map((column) => column.name));
  const migrations = [
    ['problem_summary', 'TEXT'],
    ['problem_reason', 'TEXT'],
    ['problem_signature', 'TEXT'],
    ['incident_id', 'TEXT']
  ];

  for (const [name, definition] of migrations) {
    if (!columns.has(name)) database.exec(`ALTER TABLE problems ADD COLUMN ${name} ${definition}`);
  }

  const rowsNeedingSignature = database.prepare(`
    SELECT id, category, reason, description_signature, problem_summary, problem_reason
    FROM problems
    WHERE problem_signature IS NULL OR trim(problem_signature) = ''
  `).all();

  const updateProblemSignature = database.prepare(`
    UPDATE problems
    SET problem_summary = ?, problem_reason = ?, problem_signature = ?
    WHERE id = ?
  `);

  for (const row of rowsNeedingSignature) {
    const summary = compactProblemText(row.problem_summary || row.description_signature || row.reason);
    const reason = compactProblemText(row.problem_reason || row.reason);
    updateProblemSignature.run(
      summary,
      reason,
      buildProblemSignature(row.category, summary, reason),
      row.id
    );
  }

  reconcileOpenProblemClusters(database);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_problems_open_problem_signature
      ON problems(status, category, problem_signature);

    CREATE INDEX IF NOT EXISTS idx_problems_incident_id
      ON problems(incident_id);
  `);
}

function severityValue(severity) {
  return { low: 0, medium: 1, high: 2, critical: 3 }[severity] ?? 0;
}

function reconcileOpenProblemClusters(database) {
  const tables = new Set(database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => row.name));
  if (!tables.has('problem_tickets')) return;

  const rows = database.prepare(`
    SELECT id, category, severity, reason, description_signature, problem_summary,
           problem_reason, problem_signature, incident_id, created_at, updated_at
    FROM problems
    WHERE status = 'open'
    ORDER BY created_at ASC, id ASC
  `).all();

  const updateProblem = database.prepare(`
    UPDATE problems
    SET problem_summary = ?, problem_reason = ?, problem_signature = ?
    WHERE id = ?
  `);

  for (const row of rows) {
    const summary = compactProblemText(row.problem_summary || row.description_signature || row.reason);
    const reason = compactProblemText(row.problem_reason || row.reason);
    const signature = buildProblemSignature(row.category, summary, reason);
    const originalSignature = row.problem_signature;
    row.problem_summary = summary;
    row.problem_reason = reason;
    row.problem_signature = signature;
    if (signature !== originalSignature) {
      updateProblem.run(summary, reason, signature, row.id);
    }
  }

  repairUnlinkedClassifiedTickets(database);

  const groups = rows.reduce((acc, row) => {
    const key = `${row.category.toLowerCase()}|${row.problem_signature}`;
    acc[key] ||= [];
    acc[key].push(row);
    return acc;
  }, {});

  const moveTickets = database.prepare('UPDATE problem_tickets SET problem_id = ? WHERE problem_id = ?');
  const deleteProblem = database.prepare('DELETE FROM problems WHERE id = ?');
  const updatePrimary = database.prepare(`
    UPDATE problems
    SET severity = ?, incident_id = COALESCE(incident_id, ?), updated_at = ?
    WHERE id = ?
  `);

  for (const group of Object.values(groups)) {
    if (group.length < 2) continue;
    const primary = group[0];
    const strongestSeverity = group.reduce((best, row) => (
      severityValue(row.severity) > severityValue(best) ? row.severity : best
    ), primary.severity);
    const incidentId = group.find((row) => row.incident_id)?.incident_id || null;
    const updatedAt = group.map((row) => row.updated_at).sort().at(-1) || new Date().toISOString();

    for (const duplicate of group.slice(1)) {
      moveTickets.run(primary.id, duplicate.id);
      deleteProblem.run(duplicate.id);
    }
    updatePrimary.run(strongestSeverity, incidentId, updatedAt, primary.id);
  }
}

function parseStoredCategories(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function repairUnlinkedClassifiedTickets(database) {
  const rows = database.prepare(`
    SELECT t.id, t.categories, t.severity, t.rationale, t.description, t.created_at
    FROM tickets t
    LEFT JOIN problem_tickets pt ON pt.ticket_id = t.id
    WHERE pt.ticket_id IS NULL
      AND t.categories IS NOT NULL
      AND ${openTicketStatusWhere}
    ORDER BY t.created_at ASC, t.id ASC
  `).all();
  if (rows.length === 0) return;

  const findProblem = database.prepare(`
    SELECT id, severity
    FROM problems
    WHERE status = 'open' AND lower(category) = lower(?) AND problem_signature = ?
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `);
  const insertProblem = database.prepare(`
    INSERT INTO problems (
      category, severity, reason, status, source, description_signature,
      problem_summary, problem_reason, problem_signature, created_at, updated_at
    ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
  `);
  const linkTicket = database.prepare(`
    INSERT OR IGNORE INTO problem_tickets (problem_id, ticket_id, linked_at)
    VALUES (?, ?, ?)
  `);
  const updateSeverity = database.prepare(`
    UPDATE problems
    SET severity = ?, updated_at = ?
    WHERE id = ?
  `);

  for (const row of rows) {
    const category = parseStoredCategories(row.categories)[0];
    if (!category) continue;
    const summary = compactProblemText(row.description);
    const reason = compactProblemText(row.rationale || row.description);
    if (!summary || !reason) continue;

    const signature = buildProblemSignature(category, summary, reason);
    const existing = findProblem.get(category, signature);
    const now = new Date().toISOString();
    let problemId = existing?.id;
    if (!problemId) {
      const result = insertProblem.run(
        category,
        row.severity || 'medium',
        reason,
        row.id,
        normalizeProblemPart(row.description),
        summary,
        reason,
        signature,
        row.created_at || now,
        now
      );
      problemId = Number(result.lastInsertRowid);
    } else if (severityValue(row.severity) > severityValue(existing.severity)) {
      updateSeverity.run(row.severity, now, problemId);
    }
    linkTicket.run(problemId, row.id, now);
  }
}

export function closeTicketByUser(id) {
  const now = new Date().toISOString();
  const info = getDb().prepare(`
    UPDATE tickets
    SET status = 'completed', resolution_type = 'user_closed',
        resolution_reason = 'Closed manually by the player',
        draft_response = NULL, draft_status = NULL,
        error_message = NULL, updated_at = ?
    WHERE id = ? AND (
      status IN ('pending', 'running', 'escalated')
      OR (status = 'completed' AND (
        resolution_type = 'needs_clarification'
        OR draft_status = 'pending_review'
      ))
    )
  `).run(now, id);
  return info.changes === 1;
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

const severityIncidentThresholds = {
  critical: 3,
  high: 5,
  medium: 10,
  low: 15
};

const staleIncidentWindowMs = 48 * 60 * 60 * 1000;

const openTicketStatusWhere = `
  (
    t.status IN ('pending', 'running', 'escalated', 'failed')
    OR (
      t.status = 'completed'
      AND (
        t.resolution_type = 'needs_clarification'
        OR t.draft_status = 'pending_review'
      )
    )
  )
`;

function normalizeProblemPart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bcosmic\s+divide\b/g, ' ultimate ')
    .replace(/\bastral\s+form\b/g, ' ultimate ')
    .replace(/\bults?\b/g, ' ultimate ')
    .replace(/\bultimates?\b/g, ' ultimate ')
    .replace(/\bcrashes?\b/g, ' crash ')
    .replace(/\b(can'?t|cannot|could\s+not|unable\s+to)\s+move\b/g, ' movement_lock ')
    .replace(/\b(ummoveable|unmoveable|immovable|stuck|stuck\s+in\s+place)\b/g, ' movement_lock ')
    .replace(/\bmovement\s+(is|becomes|became)?\s*(blocked|unavailable|locked)\b/g, ' movement_lock ')
    .replace(/\b(blocked|locked)\b/g, ' movement_lock ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactProblemText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

const problemSignatureStopWords = new Set([
  'a', 'an', 'and', 'after', 'all', 'also', 'as', 'be', 'because', 'before',
  'being', 'but', 'by', 'can', 'causes', 'causing', 'character', 'clarified',
  'core', 'details', 'does', 'during', 'enabled', 'entering', 'enters', 'exact', 'exiting',
  'for', 'from', 'game', 'gameplay', 'happens', 'has', 'have', 'her', 'his',
  'i', 'in', 'intended', 'is', 'it', 'latest', 'lacks', 'live', 'map', 'maps',
  'match', 'mechanic', 'mode', 'newest', 'no', 'not', 'of', 'on', 'or', 'player',
  'platform', 'provided', 'reproduction', 'reports', 'scenario', 'setting', 'she', 'specific',
  'state', 'steps', 'that', 'the', 'this', 'ticket', 'to', 'update', 'using',
  'when', 'whenever', 'whether', 'with',
  'ability', 'account', 'activating', 'affects', 'are', 'become', 'becomes',
  'becoming', 'bug', 'context', 'described', 'device', 'directly', 'disrupt',
  'exists', 'experience', 'fixed', 'form', 'high', 'impact', 'impacts',
  'incident', 'interrupt', 'investigation', 'issue', 'matching', 'may', 'media',
  'medium', 'needed', 'needs', 'nor', 'occurs', 'persists', 'place', 'rated',
  'region', 'seems', 'severity', 'significantly', 'specify', 'startup',
  'im', 'press', 'stationary', 'though', 'triggered', 'use', 'used', 'user', 'version',
  'was', 'where', 'wide', 'you'
]);

function tokenizeProblemPart(part) {
  return normalizeProblemPart(part).split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token) => !problemSignatureStopWords.has(token));
}

function canonicalProblemTokens(problemSummary, problemReason) {
  const summaryTokens = tokenizeProblemPart(problemSummary);
  const reasonTokens = tokenizeProblemPart(problemReason);
  const tokens = reasonTokens.length > 8 && summaryTokens.length >= 2
    ? summaryTokens
    : [...summaryTokens, ...reasonTokens];
  return [...new Set(tokens)].sort();
}

function buildProblemSignature(category, problemSummary, problemReason) {
  return [
    normalizeProblemPart(category),
    canonicalProblemTokens(problemSummary, problemReason).join(' ')
  ].join('|');
}

function incidentThresholdFor(category, severity) {
  const base = severityIncidentThresholds[severity] || severityIncidentThresholds.medium;
  if (String(category).toLowerCase() === 'payment') return Math.max(base, 10);
  return base;
}

function titleFromSummary(summary) {
  const normalized = normalizeProblemPart(summary);
  if (normalized.includes('astra') && normalized.includes('ultimate') && normalized.includes('movement') && normalized.includes('lock')) {
    return 'Astra Ultimate Movement Lock';
  }
  if (normalized.includes('ultimate') && normalized.includes('crash')) {
    return 'Ultimate Activation Crash';
  }
  const words = compactProblemText(summary).split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length === 0) return 'Repeated Player Issue';
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function cleanIncidentReason(problemSummary, problemReason) {
  const summary = compactProblemText(problemSummary);
  const reason = compactProblemText(problemReason);
  const normalized = normalizeProblemPart(`${summary} ${reason}`);
  if (normalized.includes('astra') && normalized.includes('ultimate') && normalized.includes('movement') && normalized.includes('lock')) {
    return 'Astra ultimate activation causes the player to become unable to move.';
  }
  if (normalized.includes('ultimate') && normalized.includes('crash')) {
    return 'Ultimate activation triggers a game crash.';
  }
  if (tokenizeProblemPart(reason).length > 8 && summary) {
    return summary;
  }
  return reason;
}

function trimSentenceEnd(value) {
  return compactProblemText(value).replace(/[.!?]+$/g, '');
}

function collectProblemTickets(problemId) {
  return getDb().prepare(`
    SELECT t.id, t.created_at, t.region, t.platform, t.status, t.resolution_type,
           t.draft_status, p.category, p.severity, p.problem_summary, p.problem_reason,
           p.reason, p.incident_id
    FROM problem_tickets pt
    JOIN tickets t ON t.id = pt.ticket_id
    JOIN problems p ON p.id = pt.problem_id
    WHERE pt.problem_id = ? AND ${openTicketStatusWhere}
    ORDER BY t.created_at ASC
  `).all(problemId);
}

function countValues(rows, field) {
  return rows.reduce((acc, row) => {
    const value = compactProblemText(row[field]);
    if (!value) return acc;
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function rankedValues(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}

function summarizeIncidentMetadata(rows) {
  const platformCounts = rankedValues(countValues(rows, 'platform'));
  const regionCounts = rankedValues(countValues(rows, 'region'));
  const total = rows.length;
  const metadataCoverage = rows.filter((row) => row.platform || row.region).length;
  const platformLeader = platformCounts[0] || null;
  const regionLeader = regionCounts[0] || null;
  const metadataParts = [];

  if (platformLeader) {
    const label = platformLeader.count === total ? 'all reports' : `${platformLeader.count}/${total} reports`;
    metadataParts.push(`${label} on ${platformLeader.value}`);
  }
  if (regionLeader) {
    const label = regionLeader.count === total ? 'all reports' : `${regionLeader.count}/${total} reports`;
    metadataParts.push(`${label} in ${regionLeader.value}`);
  }

  return {
    platform_counts: platformCounts,
    region_counts: regionCounts,
    metadata_coverage: metadataCoverage,
    metadata_note: metadataParts.length
      ? `Metadata: ${metadataParts.join('; ')}.`
      : 'Metadata: no platform or region metadata was provided by the matching tickets.'
  };
}

function promoteProblemToIncident(problemId) {
  const database = getDb();
  const rows = collectProblemTickets(problemId);
  if (rows.length === 0) return { promoted: false, reason: 'no_open_tickets' };

  const problem = rows[0];
  const threshold = incidentThresholdFor(problem.category, problem.severity);
  if (rows.length < threshold) {
    return {
      promoted: false,
      reason: 'below_threshold',
      ticket_count: rows.length,
      required_ticket_count: threshold
    };
  }

  const firstCreated = new Date(rows[0].created_at).getTime();
  const lastCreated = new Date(rows[rows.length - 1].created_at).getTime();
  const metadata = summarizeIncidentMetadata(rows);
  if (!Number.isFinite(firstCreated) || !Number.isFinite(lastCreated) || lastCreated - firstCreated > staleIncidentWindowMs) {
    return {
      promoted: false,
      reason: 'stale_ticket_cluster',
      ticket_count: rows.length,
      required_ticket_count: threshold,
      metadata,
      stale_after_hours: Math.round(staleIncidentWindowMs / 36e5)
    };
  }

  const incidentId = problem.incident_id || `INC-AUTO-${String(problemId).padStart(4, '0')}`;
  const platforms = [...new Set(rows.map((row) => row.platform).filter(Boolean))];
  const regions = [...new Set(rows.map((row) => row.region).filter(Boolean))];
  const whatHappened = compactProblemText(problem.problem_summary || problem.reason);
  const reason = cleanIncidentReason(whatHappened, problem.problem_reason || problem.reason);
  const summary = `${trimSentenceEnd(whatHappened)}. Reason/scenario: ${trimSentenceEnd(reason)}. ${rows.length} open tickets match this exact problem and reason. ${metadata.metadata_note}`;
  const now = new Date().toISOString();

  const incident = upsertIncident({
    id: incidentId,
    title: titleFromSummary(whatHappened),
    status: 'active',
    severity: problem.severity,
    started_at: rows[0].created_at,
    updated_at: now,
    platforms,
    regions,
    services: [problem.category],
    symptoms: whatHappened,
    summary,
    category: problem.category,
    keywords: [
      ...new Set([
        problem.category,
        ...normalizeProblemPart(whatHappened).split(' '),
        ...normalizeProblemPart(reason).split(' ')
      ].filter((word) => word.length > 2))
    ].slice(0, 12),
    impact: `${rows.length} open player tickets are reporting this same issue. ${metadata.metadata_note}`,
    understanding: `Created automatically from matching ticket reports. What happened: ${trimSentenceEnd(whatHappened)}. Reason/scenario: ${trimSentenceEnd(reason)}. ${metadata.metadata_note}`,
    guidance: 'Review linked tickets before publishing any external player-facing update.',
    approved_message: `We are investigating reports where ${whatHappened}.`
  });

  database.prepare(`
    UPDATE problems
    SET incident_id = ?, updated_at = ?
    WHERE id = ?
  `).run(incidentId, now, problemId);

  return {
    promoted: true,
    incident,
    incident_id: incidentId,
    ticket_count: rows.length,
    required_ticket_count: threshold,
    metadata,
    stale_after_hours: Math.round(staleIncidentWindowMs / 36e5),
    ticket_ids: rows.map((row) => row.id)
  };
}

function promoteEligibleProblemClusters() {
  const rows = getDb().prepare(`
    SELECT id FROM problems
    WHERE status = 'open'
    ORDER BY created_at ASC, id ASC
  `).all();

  for (const row of rows) {
    try {
      promoteProblemToIncident(row.id);
    } catch (error) {
      logger.warn(`Could not evaluate problem ${row.id} for incident promotion: ${error.message}`, 'SQLite');
    }
  }
}

export function clusterTicketIntoProblem(ticketId, category, severity, reason, problemSummary, problemReason) {
  const database = getDb();
  const ticket = getTicket(ticketId);
  if (!ticket) {
    throw new Error(`Ticket "${ticketId}" not found.`);
  }

  const normalizedSummary = compactProblemText(problemSummary || ticket.description);
  const normalizedReason = compactProblemText(problemReason || reason);
  if (!normalizedSummary) {
    throw new Error(`Ticket "${ticketId}" needs a problem summary to compare.`);
  }
  if (!normalizedReason) {
    throw new Error(`Ticket "${ticketId}" needs a problem reason to compare.`);
  }

  // Legacy signature is retained for old records and tests that inspect it.
  const descriptionSignature = String(ticket.description || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const problemSignature = buildProblemSignature(category, normalizedSummary, normalizedReason);

  const existingLink = database.prepare(`
    SELECT p.id, p.category, p.severity, p.reason, p.status, p.source,
           p.problem_summary, p.problem_reason, p.incident_id
    FROM problem_tickets pt
    JOIN problems p ON p.id = pt.problem_id
    WHERE pt.ticket_id = ?
  `).get(ticketId);
  if (existingLink) {
    return {
      problem: existingLink,
      action: 'already_linked',
      incident: existingLink.incident_id ? promoteProblemToIncident(existingLink.id) : null
    };
  }

  const matchingProblem = database.prepare(`
    SELECT id, category, severity, reason, status, source,
           problem_summary, problem_reason, incident_id
    FROM problems
    WHERE status = 'open' AND category = ? AND problem_signature = ?
    LIMIT 1
  `).get(category, problemSignature);

  const now = new Date().toISOString();
  if (matchingProblem) {
    database.prepare(`
      INSERT INTO problem_tickets (problem_id, ticket_id, linked_at)
      VALUES (?, ?, ?)
    `).run(matchingProblem.id, ticketId, now);
    const incident = promoteProblemToIncident(matchingProblem.id);
    return { problem: matchingProblem, action: 'added_to_pile', incident };
  }

  const result = database.prepare(`
    INSERT INTO problems (
      category, severity, reason, status, source, description_signature,
      problem_summary, problem_reason, problem_signature, created_at, updated_at
    ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    category,
    severity,
    reason,
    ticketId,
    descriptionSignature,
    normalizedSummary,
    normalizedReason,
    problemSignature,
    now,
    now
  );

  const problem = {
    id: Number(result.lastInsertRowid),
    category,
    severity,
    reason,
    status: 'open',
    source: ticketId,
    problem_summary: normalizedSummary,
    problem_reason: normalizedReason,
    incident_id: null
  };
  database.prepare(`
    INSERT INTO problem_tickets (problem_id, ticket_id, linked_at)
    VALUES (?, ?, ?)
  `).run(problem.id, ticketId, now);
  const incident = promoteProblemToIncident(problem.id);
  return { problem, action: 'created_problem', incident };
}

export function getIncidentTicketSummary(incidentIds = []) {
  const ids = Array.isArray(incidentIds) ? incidentIds.filter(Boolean) : [];
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(', ');
  const rows = getDb().prepare(`
    SELECT p.incident_id, pt.ticket_id, t.created_at, t.status
    FROM problems p
    JOIN problem_tickets pt ON pt.problem_id = p.id
    JOIN tickets t ON t.id = pt.ticket_id
    WHERE p.incident_id IN (${placeholders})
    ORDER BY t.created_at ASC
  `).all(...ids);

  return rows.reduce((acc, row) => {
    if (!acc[row.incident_id]) {
      acc[row.incident_id] = { ticket_count: 0, ticket_ids: [], latest_created_at: null };
    }
    acc[row.incident_id].ticket_count += 1;
    acc[row.incident_id].ticket_ids.push(row.ticket_id);
    acc[row.incident_id].latest_created_at = row.created_at;
    return acc;
  }, {});
}

export function compareSameTypeTicketProblems(ticketId, category, problemSummary, problemReason, { limit = 8 } = {}) {
  const database = getDb();
  const ticket = getTicket(ticketId);
  if (!ticket) throw new Error(`Ticket "${ticketId}" not found.`);

  const normalizedCategory = compactProblemText(category).toLowerCase();
  const normalizedSummary = compactProblemText(problemSummary);
  const normalizedReason = compactProblemText(problemReason);
  if (!normalizedCategory) throw new TypeError('category must be a non-empty string');
  if (!normalizedSummary) throw new TypeError('problem_summary must be a non-empty string');
  if (!normalizedReason) throw new TypeError('problem_reason must be a non-empty string');

  const problemSignature = buildProblemSignature(normalizedCategory, normalizedSummary, normalizedReason);
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 8, 1), 25);
  const rows = database.prepare(`
    SELECT p.id, p.category, p.severity, p.reason, p.problem_summary,
           p.problem_reason, p.problem_signature, p.incident_id,
           COUNT(pt.ticket_id) AS ticket_count,
           MIN(t.created_at) AS first_seen_at,
           MAX(t.created_at) AS last_seen_at
    FROM problems p
    JOIN problem_tickets pt ON pt.problem_id = p.id
    JOIN tickets t ON t.id = pt.ticket_id
    WHERE p.status = 'open'
      AND lower(p.category) = lower(?)
      AND pt.ticket_id <> ?
      AND ${openTicketStatusWhere}
    GROUP BY p.id
    ORDER BY
      CASE WHEN p.problem_signature = ? THEN 0 ELSE 1 END,
      ticket_count DESC,
      last_seen_at DESC
    LIMIT ?
  `).all(normalizedCategory, ticketId, problemSignature, safeLimit);

  const ticketRows = rows.length
    ? database.prepare(`
      SELECT pt.problem_id, pt.ticket_id, t.subject, t.created_at, t.severity
      FROM problem_tickets pt
      JOIN tickets t ON t.id = pt.ticket_id
      WHERE pt.problem_id IN (${rows.map(() => '?').join(', ')})
      ORDER BY t.created_at ASC
    `).all(...rows.map((row) => row.id))
    : [];

  const ticketsByProblem = ticketRows.reduce((acc, row) => {
    acc[row.problem_id] ||= [];
    acc[row.problem_id].push({
      id: row.ticket_id,
      subject: row.subject,
      created_at: row.created_at,
      severity: row.severity
    });
    return acc;
  }, {});

  const clusters = rows.map((row) => ({
    id: row.id,
    category: row.category,
    severity: row.severity,
    problem_summary: row.problem_summary || row.reason,
    problem_reason: row.problem_reason || row.reason,
    incident_id: row.incident_id || null,
    exact_match: row.problem_signature === problemSignature,
    ticket_count: row.ticket_count,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    tickets: ticketsByProblem[row.id] || []
  }));

  return {
    ticket_id: ticketId,
    category: normalizedCategory,
    problem_summary: normalizedSummary,
    problem_reason: normalizedReason,
    exact_match: clusters.find((cluster) => cluster.exact_match) || null,
    clusters
  };
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

export function appendTicketMessage(id, sender, message, attachments = []) {
  const database = getDb();
  return database.transaction(() => {
    const ticket = database.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!ticket) return null;

    const conversation = parseConversation(ticket.conversation);
    const timestamp = new Date().toISOString();
    if (ticket.status !== 'running' && ticket.draft_response && ticket.draft_status !== 'pending_review') {
      conversation.push({ sender: 'agent', timestamp, message: ticket.draft_response });
    }
    conversation.push({
      sender,
      timestamp,
      message,
      ...(Array.isArray(attachments) && attachments.length ? { attachments } : {})
    });

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
