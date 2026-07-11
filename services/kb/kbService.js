import { config } from '../../src/config.js';
import { fetchJson } from '../http/jsonClient.js';

const articleCache = new Map();

export async function searchValorantWiki(query, options = {}) {
  const url = createWikiUrl({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: 0,
    srlimit: 10,
    srprop: 'snippet|timestamp|wordcount'
  });

  const payload = await fetchJson(url, options);
  return (payload.query?.search || []).map((result) => ({
    article_id: `wiki:${result.pageid}`,
    title: result.title,
    summary: cleanSnippet(result.snippet) || `Valorant Wiki page for ${result.title}.`,
    status: 'published',
    updated_at: result.timestamp || null,
    source: 'valorant_wiki',
    source_url: buildPageUrl(result.title)
  }));
}

export async function getValorantWikiArticle(articleId, options = {}) {
  if (!articleId.startsWith('wiki:')) return null;

  const cached = articleCache.get(articleId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const pageId = articleId.slice('wiki:'.length);
  if (!/^\d+$/.test(pageId)) return null;

  const url = createWikiUrl({
    action: 'query',
    pageids: pageId,
    prop: 'extracts|info|revisions',
    explaintext: 1,
    exsectionformat: 'plain',
    inprop: 'url',
    rvprop: 'ids|timestamp',
    rvlimit: 1,
    redirects: 1
  });

  const payload = await fetchJson(url, options);
  const page = payload.query?.pages?.find((candidate) => !candidate.missing);
  if (!page) return null;

  const revision = page.revisions?.[0] || {};
  const content = normalizeExtract(page.extract, page.title);
  const article = {
    found: true,
    article_id: `wiki:${page.pageid}`,
    title: page.title,
    status: 'published',
    summary: summarize(content, 500),
    excerpt: summarize(content, 1200),
    content,
    source: 'valorant_wiki',
    source_page_id: page.pageid,
    source_revision_id: revision.revid || null,
    source_url: page.fullurl || buildPageUrl(page.title),
    source_updated_at: revision.timestamp || null
  };

  articleCache.set(article.article_id, {
    value: article,
    expiresAt: Date.now() + config.remoteContentCacheTtlMs
  });

  return article;
}

export function clearValorantWikiCache() {
  articleCache.clear();
}

function createWikiUrl(params) {
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

  return url;
}

function buildPageUrl(title) {
  const slug = encodeURIComponent(String(title).replace(/ /g, '_'));
  return `https://wiki.playvalorant.com/en-us/${slug}`;
}

function cleanSnippet(snippet) {
  return decodeEntities(String(snippet || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizeExtract(extract, title) {
  const content = String(extract || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return content || `${title} is a Valorant Wiki page. Open the source URL for complete details.`;
}

function summarize(content, maxLength) {
  const firstParagraph = content.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (firstParagraph.length <= maxLength) return firstParagraph;
  return `${firstParagraph.slice(0, maxLength - 1).trimEnd()}...`;
}
