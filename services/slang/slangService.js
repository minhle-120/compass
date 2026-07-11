import { config } from '../../src/config.js';
import { fetchJson } from '../http/jsonClient.js';

const termCache = new Map();
const rowCache = new Map();

export async function lookupSlang(term, options = {}) {
  const normalizedTerm = normalizeTerm(term);
  if (!normalizedTerm) return null;

  const cached = termCache.get(normalizedTerm);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const url = createDatasetUrl('search', {
    query: term,
    offset: 0,
    length: 100
  });
  const payload = await fetchJson(url, options);
  const match = (payload.rows || []).find((entry) => {
    return normalizeTerm(entry.row?.Slang) === normalizedTerm;
  });

  const value = match ? mapDatasetRow(match) : null;
  const cacheEntry = {
    value,
    expiresAt: Date.now() + config.remoteContentCacheTtlMs
  };
  termCache.set(normalizedTerm, cacheEntry);

  if (value) {
    rowCache.set(String(value.id), cacheEntry);
  }

  return value;
}

export async function searchSlang(query, terms, options = {}) {
  const uniqueTerms = [...new Set(terms.map(normalizeTerm).filter(Boolean))].slice(0, 12);
  const rows = await Promise.all(uniqueTerms.map((term) => lookupSlang(term, options)));

  const seen = new Set();
  return rows.filter((row) => {
    if (!row || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export async function getSlangById(id, options = {}) {
  const cacheKey = String(id);
  const cached = rowCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (!/^\d+$/.test(cacheKey)) return null;

  const url = createDatasetUrl('rows', {
    offset: cacheKey,
    length: 1
  });
  const payload = await fetchJson(url, options);
  const entry = (payload.rows || []).find((candidate) => String(candidate.row_idx) === cacheKey);
  if (!entry) return null;

  const value = mapDatasetRow(entry);
  const cacheEntry = {
    value,
    expiresAt: Date.now() + config.remoteContentCacheTtlMs
  };
  rowCache.set(cacheKey, cacheEntry);
  termCache.set(normalizeTerm(value.slang), cacheEntry);
  return value;
}

export function clearSlangCache() {
  termCache.clear();
  rowCache.clear();
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

function mapDatasetRow(entry) {
  const row = entry.row || {};
  return {
    id: entry.row_idx,
    slang: row.Slang || '',
    description: row.Description || '',
    example: row.Example || '',
    context: row.Context || '',
    source: 'genz_slang',
    source_dataset: config.genzSlangDataset
  };
}

function normalizeTerm(value) {
  return String(value || '').trim().toLowerCase();
}
