import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync } from 'fs';

import { config } from '../../src/config.js';
import { logger } from '../../src/utils/logger.js';
import { normalizeUnknownWord } from '../../src/utils/unknownWord.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPaths = [
  join(__dirname, 'resources', 'valorant-terminology.json'),
  join(__dirname, 'resources', 'valorant-catalog.json')
];
export const WIKI_CATEGORIES = ['agent', 'ability', 'ultimate', 'map', 'weapon', 'cosmetic', 'mechanic'];
const SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'i', 'in', 'is',
  'it', 'my', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'with',
  'you', 'your'
]);

let db;

export function initWikiDb() {
  if (db) return db;

  const dbPath = config.wikiDbPath;
  const dbDir = dirname(dbPath);
  if (dbPath !== ':memory:' && dbDir && dbDir !== '.') {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath, { timeout: 10000 });
  db.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL COLLATE NOCASE UNIQUE,
      explanation TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'mechanic',
      origin TEXT NOT NULL CHECK(origin IN ('valorant_wiki', 'manual')) DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS unknown_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      normalized_word TEXT NOT NULL UNIQUE,
      context TEXT,
      reason TEXT,
      latest_ticket_id TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK(status IN ('open', 'resolved', 'ignored')) DEFAULT 'open',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved_at TEXT
    );

  `);

  const columns = db.prepare('PRAGMA table_info(wiki_entries)').all();
  if (!columns.some((column) => column.name === 'category')) {
    db.exec("ALTER TABLE wiki_entries ADD COLUMN category TEXT NOT NULL DEFAULT 'mechanic'");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_wiki_entries_term ON wiki_entries(term COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_wiki_entries_category ON wiki_entries(category);
    CREATE INDEX IF NOT EXISTS idx_unknown_words_status ON unknown_words(status, last_seen_at DESC);
  `);

  seedWikiIfEmpty(db);
  logger.info(`Local wiki initialized at ${dbPath}`, 'Wiki');
  return db;
}

export function closeWikiDb() {
  if (!db) return;
  db.close();
  db = undefined;
}

export function listWikiEntries({ query = '', category = '', limit = 100, offset = 0 } = {}) {
  const database = initWikiDb();
  const normalizedQuery = normalizeText(query);
  const safeLimit = clampInteger(limit, 1, 500, 100);
  const safeOffset = clampInteger(offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const rows = database.prepare(`
    SELECT id, term, explanation, category, origin, created_at, updated_at
    FROM wiki_entries
    ORDER BY term COLLATE NOCASE ASC
  `).all();

  const filteredRows = WIKI_CATEGORIES.includes(category) ? rows.filter((entry) => entry.category === category) : rows;
  const ranked = normalizedQuery
    ? filteredRows
      .map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.entry.term.localeCompare(right.entry.term))
      .map(({ entry }) => entry)
    : filteredRows;

  return {
    query: String(query || '').trim(),
    category: WIKI_CATEGORIES.includes(category) ? category : '',
    total: ranked.length,
    entries: ranked.slice(safeOffset, safeOffset + safeLimit)
  };
}

export function searchWikiEntries(query, limit = 10, category = '') {
  return listWikiEntries({ query, category, limit }).entries;
}

export function getWikiEntry(id) {
  const numericId = parseId(id);
  if (!numericId) return null;
  return initWikiDb().prepare(`
    SELECT id, term, explanation, category, origin, created_at, updated_at
    FROM wiki_entries
    WHERE id = ?
  `).get(numericId) || null;
}

export function createWikiEntry(input) {
  const entry = validateEntry(input);
  const database = initWikiDb();
  const now = new Date().toISOString();
  const result = database.prepare(`
    INSERT INTO wiki_entries (term, explanation, category, origin, created_at, updated_at)
    VALUES (?, ?, ?, 'manual', ?, ?)
  `).run(entry.term, entry.explanation, entry.category, now, now);

  resolveUnknownWordByTerm(database, entry.term, now);

  return getWikiEntry(result.lastInsertRowid);
}

export function updateWikiEntry(id, input) {
  const numericId = parseId(id);
  if (!numericId) return null;

  const entry = validateEntry(input);
  const result = initWikiDb().prepare(`
    UPDATE wiki_entries
    SET term = ?, explanation = ?, category = ?, origin = 'manual', updated_at = ?
    WHERE id = ?
  `).run(entry.term, entry.explanation, entry.category, new Date().toISOString(), numericId);

  if (result.changes) resolveUnknownWordByTerm(initWikiDb(), entry.term, new Date().toISOString());

  return result.changes ? getWikiEntry(numericId) : null;
}

export function deleteWikiEntry(id) {
  const numericId = parseId(id);
  if (!numericId) return false;
  return initWikiDb().prepare('DELETE FROM wiki_entries WHERE id = ?').run(numericId).changes > 0;
}

export function flagUnknownWord(input) {
  const word = String(input?.word || '').trim();
  const normalizedWord = normalizeUnknownWord(word);
  const context = optionalText(input?.context, 1000);
  const reason = optionalText(input?.reason, 500);
  const ticketId = optionalText(input?.ticketId, 160);
  if (!normalizedWord) throw new WikiValidationError('Unknown word is required.');
  if (word.length > 160) throw new WikiValidationError('Unknown word must be 160 characters or fewer.');
  if (!context) throw new WikiValidationError('Context is required.');

  const database = initWikiDb();
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO unknown_words (
      word, normalized_word, context, reason, latest_ticket_id,
      occurrence_count, status, first_seen_at, last_seen_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, 1, 'open', ?, ?, NULL)
    ON CONFLICT(normalized_word) DO UPDATE SET
      context = COALESCE(excluded.context, unknown_words.context),
      reason = COALESCE(excluded.reason, unknown_words.reason),
      latest_ticket_id = COALESCE(excluded.latest_ticket_id, unknown_words.latest_ticket_id),
      occurrence_count = unknown_words.occurrence_count + 1,
      status = CASE WHEN unknown_words.status = 'resolved' THEN 'open' ELSE unknown_words.status END,
      last_seen_at = excluded.last_seen_at,
      resolved_at = CASE WHEN unknown_words.status = 'resolved' THEN NULL ELSE unknown_words.resolved_at END
  `).run(word, normalizedWord, context, reason, ticketId, now, now);

  return database.prepare('SELECT * FROM unknown_words WHERE normalized_word = ?').get(normalizedWord);
}

export function listUnknownWords({ query = '', status = 'open', limit = 100, offset = 0 } = {}) {
  const database = initWikiDb();
  const normalizedQuery = normalizeUnknownWord(query);
  const safeStatus = ['open', 'resolved', 'ignored', 'all'].includes(status) ? status : 'open';
  const safeLimit = clampInteger(limit, 1, 500, 100);
  const safeOffset = clampInteger(offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const clauses = [];
  const params = {};

  if (safeStatus !== 'all') {
    clauses.push('status = @status');
    params.status = safeStatus;
  }
  if (normalizedQuery) {
    clauses.push('(normalized_word LIKE @query OR context LIKE @query OR latest_ticket_id LIKE @query)');
    params.query = `%${normalizedQuery}%`;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const countStatement = database.prepare(`SELECT COUNT(*) AS count FROM unknown_words ${where}`);
  const total = (Object.keys(params).length ? countStatement.get(params) : countStatement.get()).count;
  const entries = database.prepare(`
    SELECT * FROM unknown_words
    ${where}
    ORDER BY last_seen_at DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: safeLimit, offset: safeOffset });

  return { query: String(query || '').trim(), status: safeStatus, total, entries };
}

export function updateUnknownWordStatus(id, status) {
  const numericId = parseId(id);
  if (!numericId) return null;
  if (!['open', 'resolved', 'ignored'].includes(status)) {
    throw new WikiValidationError('Status must be open, resolved, or ignored.');
  }

  const now = new Date().toISOString();
  const result = initWikiDb().prepare(`
    UPDATE unknown_words
    SET status = ?, resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END
    WHERE id = ?
  `).run(status, status, now, numericId);
  return result.changes ? getUnknownWord(numericId) : null;
}

export function deleteUnknownWord(id) {
  const numericId = parseId(id);
  if (!numericId) return false;
  return initWikiDb().prepare('DELETE FROM unknown_words WHERE id = ?').run(numericId).changes > 0;
}

export function resolveUnknownWord(term) {
  resolveUnknownWordByTerm(initWikiDb(), term, new Date().toISOString());
}

export function getUnknownWord(id) {
  const numericId = parseId(id);
  if (!numericId) return null;
  return initWikiDb().prepare('SELECT * FROM unknown_words WHERE id = ?').get(numericId) || null;
}

export function importWikiEntries(entries) {
  const database = initWikiDb();
  const find = database.prepare('SELECT id, explanation, category, origin FROM wiki_entries WHERE term = ? COLLATE NOCASE');
  const insert = database.prepare(`
    INSERT INTO wiki_entries (term, explanation, category, origin, created_at, updated_at)
    VALUES (?, ?, ?, 'valorant_wiki', ?, ?)
  `);
  const update = database.prepare(`
    UPDATE wiki_entries
    SET explanation = ?, category = ?, updated_at = ?
    WHERE id = ? AND origin = 'valorant_wiki'
  `);

  const importAll = database.transaction((sourceEntries) => {
    const result = { added: 0, updated: 0, preserved: 0, invalid: 0 };

    for (const sourceEntry of sourceEntries) {
      let entry;
      try {
        entry = validateEntry(sourceEntry);
      } catch {
        result.invalid += 1;
        continue;
      }

      const existing = find.get(entry.term);
      const now = new Date().toISOString();
      if (!existing) {
        insert.run(entry.term, entry.explanation, entry.category, now, now);
        resolveUnknownWordByTerm(database, entry.term, now);
        result.added += 1;
      } else if (existing.origin === 'manual') {
        result.preserved += 1;
      } else if (existing.explanation !== entry.explanation || existing.category !== entry.category) {
        update.run(entry.explanation, entry.category, now, existing.id);
        resolveUnknownWordByTerm(database, entry.term, now);
        result.updated += 1;
      } else {
        result.preserved += 1;
      }
    }

    return result;
  });

  return importAll(Array.isArray(entries) ? entries : []);
}

export function readBundledWikiSnapshot() {
  const snapshots = snapshotPaths.filter(existsSync).map((path) => {
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    const entries = Array.isArray(payload) ? payload : payload.entries;
    if (!Array.isArray(entries)) {
      throw new Error(`The bundled wiki snapshot at ${path} does not contain an entries array.`);
    }
    return { path, metadata: Array.isArray(payload) ? {} : payload, entries };
  });
  if (!snapshots.length) {
    throw new Error('No bundled wiki snapshots were found.');
  }

  return {
    metadata: {
      sources: snapshots.map((snapshot) => snapshot.metadata.source).filter(Boolean),
      retrieved_at: snapshots.map((snapshot) => snapshot.metadata.retrieved_at).filter(Boolean).sort().at(-1) || null
    },
    entries: deduplicateEntries(snapshots.flatMap((snapshot) => snapshot.entries))
  };
}

export function importBundledWikiSnapshot() {
  const snapshot = readBundledWikiSnapshot();
  return {
    ...importWikiEntries(snapshot.entries),
    imported: snapshot.entries.length,
    import_method: 'local_snapshot',
    source_retrieved_at: snapshot.metadata.retrieved_at || null
  };
}

export function getWikiStats() {
  const database = initWikiDb();
  const row = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN origin = 'manual' THEN 1 ELSE 0 END) AS manual,
      SUM(CASE WHEN origin = 'valorant_wiki' THEN 1 ELSE 0 END) AS imported,
      MAX(updated_at) AS last_updated_at
    FROM wiki_entries
  `).get();

  const categoryRows = database.prepare('SELECT category, COUNT(*) AS count FROM wiki_entries GROUP BY category').all();
  const unknownRows = database.prepare('SELECT status, COUNT(*) AS count FROM unknown_words GROUP BY status').all();
  return {
    total: row.total || 0,
    manual: row.manual || 0,
    imported: row.imported || 0,
    last_updated_at: row.last_updated_at || null,
    categories: Object.fromEntries(WIKI_CATEGORIES.map((category) => [
      category,
      categoryRows.find((item) => item.category === category)?.count || 0
    ])),
    unknown_words: Object.fromEntries(['open', 'resolved', 'ignored'].map((status) => [
      status,
      unknownRows.find((item) => item.status === status)?.count || 0
    ]))
  };
}

function seedWikiIfEmpty(database) {
  const count = database.prepare('SELECT COUNT(*) AS count FROM wiki_entries').get().count;
  if (count > 0) return;

  const entries = readBundledWikiSnapshot().entries;
  const insert = database.prepare(`
    INSERT INTO wiki_entries (term, explanation, category, origin, created_at, updated_at)
    VALUES (?, ?, ?, 'valorant_wiki', ?, ?)
  `);
  const now = new Date().toISOString();
  database.transaction(() => {
    for (const entry of entries) {
      const validated = validateEntry(entry);
      insert.run(validated.term, validated.explanation, validated.category, now, now);
    }
  })();
}

function validateEntry(input) {
  const term = String(input?.term || '').trim();
  const explanation = String(input?.explanation || '').trim();
  const category = WIKI_CATEGORIES.includes(input?.category) ? input.category : 'mechanic';

  if (!term) throw new WikiValidationError('Term is required.');
  if (!explanation) throw new WikiValidationError('Explanation is required.');
  if (term.length > 160) throw new WikiValidationError('Term must be 160 characters or fewer.');
  if (explanation.length > 10000) throw new WikiValidationError('Explanation must be 10,000 characters or fewer.');

  return { term, explanation, category };
}

function resolveUnknownWordByTerm(database, term, now) {
  database.prepare(`
    UPDATE unknown_words
    SET status = 'resolved', resolved_at = ?
    WHERE normalized_word = ? AND status != 'resolved'
  `).run(now, normalizeUnknownWord(term));
}

function optionalText(value, maxLength) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function deduplicateEntries(entries) {
  const unique = new Map();
  for (const entry of entries) {
    const key = String(entry?.term || '').trim().toLowerCase();
    if (!key) continue;

    const existing = unique.get(key);
    if (!existing || preferEntry(entry, existing)) unique.set(key, entry);
  }
  return [...unique.values()];
}

function preferEntry(candidate, existing) {
  const candidateCategory = WIKI_CATEGORIES.includes(candidate?.category) ? candidate.category : 'mechanic';
  const existingCategory = WIKI_CATEGORIES.includes(existing?.category) ? existing.category : 'mechanic';
  if (candidateCategory !== 'mechanic' && existingCategory === 'mechanic') return true;
  return String(candidate?.explanation || '').length > String(existing?.explanation || '').length;
}

function scoreEntry(entry, query) {
  const term = normalizeText(entry.term);
  const explanation = normalizeText(entry.explanation);
  const category = normalizeText(entry.category);
  const termTokens = term.match(/[a-z0-9_+-]+/g) || [];
  const rawTokens = query.match(/[a-z0-9_+-]+/g) || [];
  const tokens = rawTokens.filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
  let score = 0;

  if (term === query) score += 1000;
  else if (term.startsWith(query)) score += 600;
  else if (term.includes(query)) score += 400;

  for (const token of tokens) {
    if (term === token || termTokens.includes(token)) score += 220;
    else if (termTokens.some((termToken) => termToken.startsWith(token))) score += 140;
    else if (term.includes(token)) score += 70;
    if (explanation.includes(token)) score += 20;
    if (category === token) score += 160;
  }

  return score;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function parseId(value) {
  const id = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export class WikiValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WikiValidationError';
  }
}
