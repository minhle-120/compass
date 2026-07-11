import { config } from '../../src/config.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import { fetchJson, fetchText } from '../http/jsonClient.js';
import { importWikiEntries } from './wikiService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(__dirname, 'resources', 'valorant-terminology.json');

export async function downloadValorantTerminology(options = {}) {
  const failures = [];
  const pageUrl = createWikiPageUrl(config.valorantWikiTerminologyPage);

  try {
    const html = await fetchText(pageUrl, {
      ...options,
      headers: {
        Referer: new URL('/en-us/', pageUrl).toString(),
        ...options.headers
      }
    });
    const entries = validateParsedEntries(parseTerminologyHtml(html), 'rendered page');
    return { entries, revisionId: null, method: 'rendered_page' };
  } catch (error) {
    failures.push(`rendered page: ${error.message}`);
  }

  const url = new URL(config.valorantWikiApiUrl);
  const params = {
    action: 'parse',
    page: config.valorantWikiTerminologyPage,
    prop: 'text|revid',
    format: 'json',
    formatversion: '2',
    redirects: '1'
  };

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const payload = await fetchJson(url, {
      ...options,
      headers: {
        Referer: pageUrl.toString(),
        ...options.headers
      }
    });
    const html = payload.parse?.text;
    if (!html) throw new Error('the response contained no page content');
    const entries = validateParsedEntries(parseTerminologyHtml(html), 'Action API');

    return {
      entries,
      revisionId: payload.parse?.revid || null,
      method: 'action_api'
    };
  } catch (error) {
    failures.push(`Action API: ${error.message}`);
  }

  throw new Error(`all public Valorant Wiki import methods failed (${failures.join('; ')}).`);
}

export async function refreshWikiFromValorant(options = {}) {
  const downloaded = await downloadValorantTerminology(options);
  return {
    ...importWikiEntries(downloaded.entries),
    downloaded: downloaded.entries.length,
    revision_id: downloaded.revisionId,
    import_method: downloaded.method
  };
}

export async function refreshWikiSnapshotFromValorant(options = {}) {
  const downloaded = await downloadValorantTerminology(options);
  const snapshot = {
    schema_version: 1,
    source: createWikiPageUrl(config.valorantWikiTerminologyPage).toString(),
    retrieved_at: new Date().toISOString(),
    revision_id: downloaded.revisionId,
    entry_count: downloaded.entries.length,
    entries: downloaded.entries
  };
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  return {
    ...importWikiEntries(downloaded.entries),
    downloaded: downloaded.entries.length,
    revision_id: downloaded.revisionId,
    import_method: downloaded.method,
    snapshot_path: snapshotPath
  };
}

export function parseTerminologyHtml(html) {
  const entries = [];

  for (const rowMatch of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((match) => cleanHtml(match[1]));
    if (cells.length >= 2) addEntry(entries, cells[0], cells[1]);
  }

  for (const match of String(html).matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    addEntry(entries, cleanHtml(match[1]), cleanHtml(match[2]));
  }

  for (const match of String(html).matchAll(/<li\b[^>]*>\s*<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>\s*(?:[-:–—]\s*)?([\s\S]*?)<\/li>/gi)) {
    addEntry(entries, cleanHtml(match[1]), cleanHtml(match[2]));
  }

  const deduplicated = new Map();
  for (const entry of entries) {
    const key = entry.term.toLowerCase();
    if (!deduplicated.has(key) || entry.explanation.length > deduplicated.get(key).explanation.length) {
      deduplicated.set(key, entry);
    }
  }
  return [...deduplicated.values()];
}

function addEntry(entries, rawTerm, rawExplanation) {
  const term = rawTerm.replace(/\[edit\]$/i, '').trim();
  const explanation = rawExplanation.trim();
  const header = /^(term|terminology|name|callout)$/i.test(term);
  if (!header && term && explanation && term.length <= 160 && explanation.length <= 10000) {
    entries.push({ term, explanation });
  }
}

function cleanHtml(value) {
  return decodeEntities(String(value || '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function decodeEntities(value) {
  const named = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—'
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const radix = code[1].toLowerCase() === 'x' ? 16 : 10;
      const number = Number.parseInt(code.slice(radix === 16 ? 2 : 1), radix);
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

function createWikiPageUrl(title) {
  const url = new URL(config.valorantWikiApiUrl);
  const basePath = url.pathname.replace(/api\.php\/?$/i, '');
  url.pathname = `${basePath}${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
  url.search = '';
  return url;
}

function validateParsedEntries(entries, method) {
  if (entries.length < 20) {
    throw new Error(`${method} produced only ${entries.length} terms; refusing an incomplete import`);
  }
  return entries;
}
