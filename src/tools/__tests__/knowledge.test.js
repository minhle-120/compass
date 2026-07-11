import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.WIKI_DB_PATH = ':memory:';

import { clearSlangCache } from '../../../services/slang/slangService.js';
import { createWikiEntry, initWikiDb } from '../../../services/wiki/wikiService.js';
import { handler as querySlang } from '../query_slang_dictionary.js';
import { handler as searchKnowledge } from '../search_knowledge_base.js';
import { handler as getKnowledge } from '../get_knowledge_base_article.js';

describe('Knowledge tools', () => {
  beforeEach(() => {
    const db = initWikiDb();
    db.prepare('DELETE FROM wiki_entries').run();
    createWikiEntry({ term: 'Jett', explanation: 'A Duelist agent known for mobility.' });
    createWikiEntry({ term: 'Whiffing', explanation: 'Missing an easy or expected shot.' });
    clearSlangCache();
    vi.stubGlobal('fetch', vi.fn(handleDatasetRequest));
  });

  it('looks up encountered slang directly from the Hugging Face dataset', async () => {
    const result = await querySlang({ term: 'lit' }, {});

    expect(result).toContain('[Gen-Z Slang] lit: Very exciting or excellent');
    expect(result).toContain('Example: That match was lit');
  });

  it('searches the local wiki and direct slang provider together', async () => {
    const result = await searchKnowledge({ query: 'Jett lit' }, {});

    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ article_id: 'slang:7', source: 'huggingface_genz_slang' }),
      expect.objectContaining({ title: 'Jett', source: 'compass_wiki' })
    ]));
  });

  it('retrieves a complete local wiki entry by search result ID', async () => {
    const search = await searchKnowledge({ query: 'whiff' }, {});
    const articleId = search.results.find((row) => row.source === 'compass_wiki').article_id;
    const result = await getKnowledge({ article_id: articleId }, {});

    expect(result.found).toBe(true);
    expect(result.title).toBe('Whiffing');
    expect(result.source).toBe('compass_wiki');
    expect(result.content).toContain('expected shot');
    expect(result.source_url).toBeUndefined();
  });

  it('retrieves a complete slang row directly by dataset row ID', async () => {
    const result = await getKnowledge({ article_id: 'slang:7' }, {});

    expect(result.found).toBe(true);
    expect(result.title).toBe('lit');
    expect(result.source).toBe('huggingface_genz_slang');
    expect(result.content).toContain('General chat');
  });

  it('returns not found when the dataset has no exact slang match', async () => {
    const result = await querySlang({ term: 'unknown-term' }, {});
    expect(result).toBe('No slang definition found for "unknown-term".');
  });
});

async function handleDatasetRequest(input) {
  const url = new URL(String(input));
  if (url.hostname !== 'datasets-server.huggingface.co') return jsonResponse({ rows: [] });

  if (url.pathname === '/search') {
    const query = url.searchParams.get('query')?.toLowerCase();
    return jsonResponse({ rows: query === 'lit' ? [slangEntry()] : [] });
  }

  if (url.pathname === '/rows' && url.searchParams.get('offset') === '7') {
    return jsonResponse({ rows: [slangEntry()] });
  }

  return jsonResponse({ rows: [] });
}

function slangEntry() {
  return {
    row_idx: 7,
    row: {
      Slang: 'lit',
      Description: 'Very exciting or excellent',
      Example: 'That match was lit',
      Context: 'General chat'
    }
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  };
}
