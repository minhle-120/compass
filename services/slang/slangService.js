import Database from 'better-sqlite3';
import { dirname } from 'path';
import { mkdirSync } from 'fs';

import { config } from '../../src/config.js';
import { fetchJson } from '../http/jsonClient.js';
import { logger } from '../../src/utils/logger.js';
import { resolveUnknownWord } from '../wiki/wikiService.js';

export const SLANG_CATEGORIES = ['general', 'gaming', 'chat', 'meme', 'platform', 'sensitive'];

const SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'i', 'in', 'is',
  'it', 'my', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'with',
  'you', 'your'
]);

const termCache = new Map();
const rowCache = new Map();
let db;

export function initSlangDb() {
  if (db) return db;

  const dbPath = config.slangDbPath;
  const dbDir = dirname(dbPath);
  if (dbPath !== ':memory:' && dbDir && dbDir !== '.') {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath, { timeout: 10000 });
  db.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS slang_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL COLLATE NOCASE UNIQUE,
      definition TEXT NOT NULL,
      example TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_slang_entries_term ON slang_entries(term COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_slang_entries_category ON slang_entries(category);
  `);

  logger.info(`Local slang wiki initialized at ${dbPath}`, 'Slang');
  return db;
}

export function closeSlangDb() {
  if (!db) return;
  db.close();
  db = undefined;
}

export function listLocalSlangEntries({ query = '', category = '', limit = 100, offset = 0 } = {}) {
  const database = initSlangDb();
  const normalizedQuery = normalizeTerm(query);
  const safeLimit = clampInteger(limit, 1, 500, 100);
  const safeOffset = clampInteger(offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const rows = database.prepare(`
    SELECT id, term, definition, example, category, notes, created_at, updated_at
    FROM slang_entries
    ORDER BY term COLLATE NOCASE ASC
  `).all();

  const filteredRows = SLANG_CATEGORIES.includes(category)
    ? rows.filter((entry) => entry.category === category)
    : rows;
  const ranked = normalizedQuery
    ? filteredRows
      .map((entry) => ({ entry, score: scoreLocalEntry(entry, normalizedQuery) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.entry.term.localeCompare(right.entry.term))
      .map(({ entry }) => entry)
    : filteredRows;

  return {
    query: String(query || '').trim(),
    category: SLANG_CATEGORIES.includes(category) ? category : '',
    total: ranked.length,
    entries: ranked.slice(safeOffset, safeOffset + safeLimit)
  };
}

export function searchLocalSlangEntries(query, limit = 10, category = '') {
  return listLocalSlangEntries({ query, category, limit }).entries;
}

export function getLocalSlangEntry(id) {
  const numericId = parseId(id);
  if (!numericId) return null;
  return initSlangDb().prepare(`
    SELECT id, term, definition, example, category, notes, created_at, updated_at
    FROM slang_entries
    WHERE id = ?
  `).get(numericId) || null;
}

export function createLocalSlangEntry(input) {
  const entry = validateLocalEntry(input);
  const database = initSlangDb();
  const now = new Date().toISOString();
  const result = database.prepare(`
    INSERT INTO slang_entries (term, definition, example, category, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(entry.term, entry.definition, entry.example, entry.category, entry.notes, now, now);
  resolveUnknownWord(entry.term);
  clearSlangCacheForTerm(entry.term);
  return getLocalSlangEntry(result.lastInsertRowid);
}

export function updateLocalSlangEntry(id, input) {
  const numericId = parseId(id);
  if (!numericId) return null;

  const entry = validateLocalEntry(input);
  const result = initSlangDb().prepare(`
    UPDATE slang_entries
    SET term = ?, definition = ?, example = ?, category = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(entry.term, entry.definition, entry.example, entry.category, entry.notes, new Date().toISOString(), numericId);

  clearSlangCacheForTerm(entry.term);
  if (result.changes) resolveUnknownWord(entry.term);
  return result.changes ? getLocalSlangEntry(numericId) : null;
}

export function deleteLocalSlangEntry(id) {
  const entry = getLocalSlangEntry(id);
  if (!entry) return false;
  const deleted = initSlangDb().prepare('DELETE FROM slang_entries WHERE id = ?').run(entry.id).changes > 0;
  if (deleted) clearSlangCacheForTerm(entry.term);
  return deleted;
}

export function getSlangStats() {
  const database = initSlangDb();
  const row = database.prepare(`
    SELECT COUNT(*) AS total, MAX(updated_at) AS last_updated_at
    FROM slang_entries
  `).get();
  const categoryRows = database.prepare('SELECT category, COUNT(*) AS count FROM slang_entries GROUP BY category').all();
  return {
    total: row.total || 0,
    last_updated_at: row.last_updated_at || null,
    categories: Object.fromEntries(SLANG_CATEGORIES.map((category) => [
      category,
      categoryRows.find((item) => item.category === category)?.count || 0
    ]))
  };
}

export async function lookupSlang(term, options = {}) {
  const normalizedTerm = normalizeTerm(term);
  if (!normalizedTerm) return null;

  const cached = termCache.get(normalizedTerm);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const local = getLocalSlangByTerm(normalizedTerm);
  const genz = local ? null : await safeProviderLookup(() => lookupGenzSlang(term, options));
  const urban = local || genz ? null : await safeProviderLookup(() => lookupUrbanDictionary(term, options));
  const value = local || genz || urban;

  cacheTerm(normalizedTerm, value);
  return value;
}

export async function searchSlang(query, terms, options = {}) {
  const uniqueTerms = [...new Set(terms.map(normalizeTerm).filter(Boolean))].slice(0, 12);
  const localRows = searchLocalSlangEntries(query, 10).map(mapLocalEntry);
  const remoteResults = await Promise.allSettled(uniqueTerms.flatMap((term) => [
    lookupGenzSlang(term, options),
    lookupUrbanDictionary(term, options)
  ]));
  const remoteRows = remoteResults
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);

  const seen = new Set();
  return [...localRows, ...remoteRows].filter((row) => {
    if (!row) return false;
    const key = `${normalizeTerm(row.slang)}:${row.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

export async function getSlangById(id, options = {}) {
  const cacheKey = String(id || '');
  const cached = rowCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let value = null;
  if (cacheKey.startsWith('local:')) {
    value = mapLocalEntry(getLocalSlangEntry(cacheKey.slice('local:'.length)));
  } else if (cacheKey.startsWith('genz:')) {
    value = await getGenzSlangById(cacheKey.slice('genz:'.length), options);
  } else if (cacheKey.startsWith('urban:')) {
    value = await getUrbanDictionaryById(cacheKey, options);
  } else if (/^\d+$/.test(cacheKey)) {
    value = await getGenzSlangById(cacheKey, options);
  }

  if (value) cacheRow(value);
  return value;
}

export function clearSlangCache() {
  termCache.clear();
  rowCache.clear();
}

async function safeProviderLookup(callback) {
  try {
    return await callback();
  } catch {
    return null;
  }
}

async function lookupGenzSlang(term, options = {}) {
  const normalizedTerm = normalizeTerm(term);
  const url = createDatasetUrl('search', {
    query: term,
    offset: 0,
    length: 100
  });
  const payload = await fetchJson(url, options);
  const match = (payload.rows || []).find((entry) => {
    return normalizeTerm(entry.row?.Slang) === normalizedTerm;
  });
  return match ? mapGenzDatasetRow(match) : null;
}

async function getGenzSlangById(id, options = {}) {
  const rowId = String(id || '').replace(/^genz:/, '');
  if (!/^\d+$/.test(rowId)) return null;

  const url = createDatasetUrl('rows', {
    offset: rowId,
    length: 1
  });
  const payload = await fetchJson(url, options);
  const entry = (payload.rows || []).find((candidate) => String(candidate.row_idx) === rowId);
  return entry ? mapGenzDatasetRow(entry) : null;
}

async function lookupUrbanDictionary(term, options = {}) {
  const normalizedTerm = normalizeTerm(term);
  const url = createUrbanDictionaryUrl(term);
  const payload = await fetchJson(url, options);
  const definitions = Array.isArray(payload.list) ? payload.list : [];
  const ranked = definitions
    .map(mapUrbanDefinition)
    .filter((entry) => entry.slang && entry.description)
    .map((entry) => ({
      entry,
      score: urbanScore(entry, normalizedTerm)
    }))
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.entry || null;
}

async function getUrbanDictionaryById(id, options = {}) {
  const parsed = parseUrbanId(id);
  if (!parsed) return null;

  const url = createUrbanDictionaryUrl(parsed.term);
  const payload = await fetchJson(url, options);
  const definitions = Array.isArray(payload.list) ? payload.list : [];
  return definitions.map(mapUrbanDefinition).find((entry) => String(entry.provider_id) === parsed.defid) || null;
}

function getLocalSlangByTerm(normalizedTerm) {
  const entry = initSlangDb().prepare(`
    SELECT id, term, definition, example, category, notes, created_at, updated_at
    FROM slang_entries
    WHERE term = ? COLLATE NOCASE
  `).get(normalizedTerm);
  return mapLocalEntry(entry);
}

function createDatasetUrl(endpoint, params) {
  const baseUrl = config.huggingFaceDatasetApiUrl.replace(/\/$/, '');
  const url = new URL(`${baseUrl}/${endpoint}`);
  const requestParams = {
    dataset: config.genzSlangDataset,
    config: 'default',
    split: 'train',
    ...params
  };

  for (const [key, value] of Object.entries(requestParams)) {
    url.searchParams.set(key, String(value));
  }

  return url;
}

function createUrbanDictionaryUrl(term) {
  const baseUrl = config.urbanDictionaryApiUrl.replace(/\/$/, '');
  const url = new URL(baseUrl);
  url.searchParams.set('term', term);
  return url;
}

function mapLocalEntry(entry) {
  if (!entry) return null;
  return {
    id: `local:${entry.id}`,
    slang: entry.term || '',
    description: entry.definition || '',
    example: entry.example || '',
    context: entry.notes || '',
    category: entry.category || 'general',
    source: 'local_slang',
    updated_at: entry.updated_at || null
  };
}

function mapGenzDatasetRow(entry) {
  const row = entry.row || {};
  return {
    id: `genz:${entry.row_idx}`,
    slang: row.Slang || '',
    description: row.Description || '',
    example: row.Example || '',
    context: row.Context || '',
    source: 'genz_slang',
    source_dataset: config.genzSlangDataset
  };
}

function mapUrbanDefinition(entry) {
  const word = String(entry?.word || '').trim();
  const defid = String(entry?.defid || '').trim();
  return {
    id: `urban:${defid}:${encodeURIComponent(word.toLowerCase())}`,
    provider_id: defid,
    slang: word,
    description: cleanUrbanText(entry?.definition),
    example: cleanUrbanText(entry?.example),
    context: '',
    source: 'urban_dictionary',
    source_url: entry?.permalink || null,
    thumbs_up: Number(entry?.thumbs_up || 0),
    thumbs_down: Number(entry?.thumbs_down || 0),
    written_on: entry?.written_on || null
  };
}

function cleanUrbanText(value) {
  return String(value || '').replace(/\[([^\]]+)\]/g, '$1').trim();
}

function urbanScore(entry, normalizedTerm) {
  const exact = normalizeTerm(entry.slang) === normalizedTerm ? 10000 : 0;
  return exact + (entry.thumbs_up || 0) - (entry.thumbs_down || 0);
}

function parseUrbanId(id) {
  const match = String(id || '').match(/^urban:([^:]+):(.+)$/);
  if (!match) return null;
  return {
    defid: match[1],
    term: decodeURIComponent(match[2])
  };
}

function validateLocalEntry(input) {
  const term = String(input?.term || '').trim();
  const definition = String(input?.definition || '').trim();
  const example = optionalText(input?.example, 5000);
  const notes = optionalText(input?.notes, 5000);
  const category = SLANG_CATEGORIES.includes(input?.category) ? input.category : 'general';

  if (!term) throw new SlangValidationError('Term is required.');
  if (!definition) throw new SlangValidationError('Definition is required.');
  if (term.length > 160) throw new SlangValidationError('Term must be 160 characters or fewer.');
  if (definition.length > 10000) throw new SlangValidationError('Definition must be 10,000 characters or fewer.');

  return { term, definition, example, category, notes };
}

function scoreLocalEntry(entry, query) {
  const term = normalizeTerm(entry.term);
  const definition = normalizeTerm(entry.definition);
  const example = normalizeTerm(entry.example);
  const category = normalizeTerm(entry.category);
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
    if (definition.includes(token)) score += 20;
    if (example.includes(token)) score += 15;
    if (category === token) score += 160;
  }

  return score;
}

function cacheTerm(normalizedTerm, value) {
  const cacheEntry = {
    value,
    expiresAt: Date.now() + config.remoteContentCacheTtlMs
  };
  termCache.set(normalizedTerm, cacheEntry);
  if (value) rowCache.set(String(value.id), cacheEntry);
}

function cacheRow(value) {
  const cacheEntry = {
    value,
    expiresAt: Date.now() + config.remoteContentCacheTtlMs
  };
  rowCache.set(String(value.id), cacheEntry);
  termCache.set(normalizeTerm(value.slang), cacheEntry);
}

function clearSlangCacheForTerm(term) {
  termCache.delete(normalizeTerm(term));
  for (const [key, cached] of rowCache.entries()) {
    if (normalizeTerm(cached.value?.slang) === normalizeTerm(term)) rowCache.delete(key);
  }
}

function optionalText(value, maxLength) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeTerm(value) {
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

export class SlangValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SlangValidationError';
  }
}
