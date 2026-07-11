import { config } from '../config.js';
import { getDb } from '../database/sqlite.js';
import { ensureKnowledgeBaseTable } from '../database/knowledgeBase.js';
import { logger } from '../utils/logger.js';

const SOURCE = 'valorant_wiki';

let activeSync = null;
let syncTimer = null;

export function startValorantWikiSync() {
  const database = getDb();
  ensureKnowledgeBaseTable(database);

  if (!config.valorantWikiSyncEnabled) {
    logger.info('Valorant Wiki synchronization is disabled.', 'ValorantWiki');
    return null;
  }

  void syncValorantWiki().catch((error) => {
    logger.error('Initial Valorant Wiki synchronization failed', 'ValorantWiki', error);
  });

  if (!syncTimer) {
    syncTimer = setInterval(() => {
      void syncValorantWiki({ force: true }).catch((error) => {
        logger.error('Scheduled Valorant Wiki synchronization failed', 'ValorantWiki', error);
      });
    }, config.valorantWikiSyncIntervalMs);
    syncTimer.unref?.();
  }

  return syncTimer;
}

export function stopValorantWikiSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

export function syncValorantWiki(options = {}) {
  if (activeSync) return activeSync;

  activeSync = performSync(options).finally(() => {
    activeSync = null;
  });

  return activeSync;
}

async function performSync({ force = false, full = false, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A Fetch API implementation is required for Valorant Wiki synchronization.');
  }

  const database = getDb();
  ensureKnowledgeBaseTable(database);

  const state = database.prepare(`
    SELECT last_successful_at
    FROM kb_sync_state
    WHERE source = ?
  `).get(SOURCE);

  const lastSuccessfulAt = state?.last_successful_at || null;
  const lastSyncTime = lastSuccessfulAt ? Date.parse(lastSuccessfulAt) : Number.NaN;
  const isFresh = Number.isFinite(lastSyncTime)
    && Date.now() - lastSyncTime < config.valorantWikiSyncIntervalMs;

  if (!force && isFresh) {
    return {
      source: SOURCE,
      skipped: true,
      reason: 'The wiki cache is still fresh.',
      last_successful_at: lastSuccessfulAt
    };
  }

  const startedAt = new Date().toISOString();
  const fullSync = full || !lastSuccessfulAt;

  database.prepare(`
    INSERT INTO kb_sync_state (source, last_started_at, status, last_error)
    VALUES (?, ?, 'running', NULL)
    ON CONFLICT(source) DO UPDATE SET
      last_started_at = excluded.last_started_at,
      status = 'running',
      last_error = NULL
  `).run(SOURCE, startedAt);

  try {
    const pageIds = fullSync
      ? await fetchAllPageIds(fetchImpl)
      : await fetchRecentPageIds(fetchImpl, lastSuccessfulAt, startedAt);

    let pagesSynced = 0;
    for (const pageIdBatch of chunk(pageIds, config.valorantWikiBatchSize)) {
      const pages = await fetchPageDetails(fetchImpl, pageIdBatch);
      pagesSynced += upsertPages(database, pages, startedAt);
    }

    if (fullSync) {
      database.prepare(`
        DELETE FROM kb_articles
        WHERE source = ? AND (synced_at IS NULL OR synced_at <> ?)
      `).run(SOURCE, startedAt);
    }

    database.prepare(`
      UPDATE kb_sync_state
      SET last_successful_at = ?, status = 'success', last_error = NULL, pages_synced = ?
      WHERE source = ?
    `).run(startedAt, pagesSynced, SOURCE);

    logger.info(
      `Valorant Wiki ${fullSync ? 'full' : 'incremental'} sync completed (${pagesSynced} pages).`,
      'ValorantWiki'
    );

    return {
      source: SOURCE,
      skipped: false,
      mode: fullSync ? 'full' : 'incremental',
      pages_synced: pagesSynced,
      last_successful_at: startedAt
    };
  } catch (error) {
    database.prepare(`
      UPDATE kb_sync_state
      SET status = 'failed', last_error = ?
      WHERE source = ?
    `).run(String(error.message || error), SOURCE);
    throw error;
  }
}

async function fetchAllPageIds(fetchImpl) {
  const pageIds = [];
  let continuation = null;

  do {
    const payload = await requestWiki(fetchImpl, {
      action: 'query',
      list: 'allpages',
      apnamespace: 0,
      apfilterredir: 'nonredirects',
      aplimit: 'max',
      ...(continuation ? { apcontinue: continuation } : {})
    });

    for (const page of payload.query?.allpages || []) {
      if (page.pageid) pageIds.push(page.pageid);
    }

    continuation = payload.continue?.apcontinue || null;
  } while (continuation);

  return [...new Set(pageIds)];
}

async function fetchRecentPageIds(fetchImpl, lastSuccessfulAt, startedAt) {
  const pageIds = [];
  let continuation = null;

  do {
    const payload = await requestWiki(fetchImpl, {
      action: 'query',
      list: 'recentchanges',
      rcnamespace: 0,
      rctype: 'edit|new',
      rcprop: 'ids|title|timestamp',
      rclimit: 'max',
      rcstart: startedAt,
      rcend: lastSuccessfulAt,
      ...(continuation ? { rccontinue: continuation } : {})
    });

    for (const change of payload.query?.recentchanges || []) {
      if (change.pageid) pageIds.push(change.pageid);
    }

    continuation = payload.continue?.rccontinue || null;
  } while (continuation);

  return [...new Set(pageIds)];
}

async function fetchPageDetails(fetchImpl, pageIds) {
  if (pageIds.length === 0) return [];

  const payload = await requestWiki(fetchImpl, {
    action: 'query',
    pageids: pageIds.join('|'),
    prop: 'extracts|info|revisions',
    explaintext: 1,
    exsectionformat: 'plain',
    exlimit: 'max',
    inprop: 'url',
    rvprop: 'ids|timestamp',
    rvlimit: 1,
    redirects: 1
  });

  return (payload.query?.pages || []).filter((page) => !page.missing && page.pageid);
}

function upsertPages(database, pages, syncedAt) {
  const upsert = database.prepare(`
    INSERT INTO kb_articles (
      id, title, status, platforms, game_versions, updated_at,
      summary, excerpt, content, source, source_page_id,
      source_revision_id, source_url, source_updated_at, synced_at
    ) VALUES (
      @id, @title, 'published', '[]', '[]', @updated_at,
      @summary, @excerpt, @content, @source, @source_page_id,
      @source_revision_id, @source_url, @source_updated_at, @synced_at
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      updated_at = excluded.updated_at,
      summary = excluded.summary,
      excerpt = excluded.excerpt,
      content = excluded.content,
      source = excluded.source,
      source_page_id = excluded.source_page_id,
      source_revision_id = excluded.source_revision_id,
      source_url = excluded.source_url,
      source_updated_at = excluded.source_updated_at,
      synced_at = excluded.synced_at
  `);

  const saveBatch = database.transaction((wikiPages) => {
    let saved = 0;

    for (const page of wikiPages) {
      const content = normalizeExtract(page.extract, page.title);
      const revision = page.revisions?.[0] || {};
      const updatedAt = revision.timestamp || syncedAt;

      upsert.run({
        id: `wiki:${page.pageid}`,
        title: page.title,
        updated_at: updatedAt,
        summary: summarize(content, 500),
        excerpt: summarize(content, 1200),
        content,
        source: SOURCE,
        source_page_id: page.pageid,
        source_revision_id: revision.revid || null,
        source_url: page.fullurl || buildFallbackPageUrl(page.title),
        source_updated_at: revision.timestamp || null,
        synced_at: syncedAt
      });
      saved += 1;
    }

    return saved;
  });

  return saveBatch(pages);
}

async function requestWiki(fetchImpl, params) {
  const url = new URL(config.valorantWikiApiUrl);
  const requestParams = {
    format: 'json',
    formatversion: 2,
    maxlag: 5,
    ...params
  };

  for (const [key, value] of Object.entries(requestParams)) {
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.valorantWikiRequestTimeoutMs);

  try {
    const response = await fetchImpl(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CompassGameSupport/1.0 (Valorant Wiki knowledge cache)'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Valorant Wiki request failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (payload.error) {
      throw new Error(`Valorant Wiki API error: ${payload.error.info || payload.error.code}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function chunk(values, size) {
  const safeSize = Number.isInteger(size) && size > 0 ? size : 20;
  const chunks = [];
  for (let index = 0; index < values.length; index += safeSize) {
    chunks.push(values.slice(index, index + safeSize));
  }
  return chunks;
}

function normalizeExtract(extract, title) {
  const content = String(extract || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return content || `${title} is a VALORANT Wiki page. Open the source URL for full details.`;
}

function summarize(content, maxLength) {
  const firstParagraph = content.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (firstParagraph.length <= maxLength) return firstParagraph;
  return `${firstParagraph.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildFallbackPageUrl(title) {
  const slug = encodeURIComponent(String(title).replace(/ /g, '_'));
  return `https://wiki.playvalorant.com/en-us/${slug}`;
}
