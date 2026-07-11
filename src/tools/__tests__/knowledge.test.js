import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.WIKI_DB_PATH = ':memory:';
process.env.SLANG_DB_PATH = ':memory:';

import { clearSlangCache, createLocalSlangEntry, initSlangDb } from '../../../services/slang/slangService.js';
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
    const slangDb = initSlangDb();
    slangDb.prepare('DELETE FROM slang_entries').run();
    clearSlangCache();
    vi.stubGlobal('fetch', vi.fn(handleDatasetRequest));
  });

  it('looks up encountered slang from the Gen-Z dataset', async () => {
    const result = await querySlang({ term: 'lit' }, {});

    expect(result).toContain('[Gen-Z Slang] lit: Very exciting or excellent');
    expect(result).toContain('Example: That match was lit');
  });

  it('prefers local slang entries before remote providers', async () => {
    createLocalSlangEntry({
      term: 'diff',
      definition: 'A noticeable skill gap between two players in the same role.',
      example: 'Their Jett was the diff.',
      category: 'gaming',
      notes: 'Usually competitive shorthand.'
    });

    const result = await querySlang({ term: 'diff' }, {});

    expect(result).toContain('[Compass Slang] diff: A noticeable skill gap');
    expect(result).toContain('Context: Usually competitive shorthand.');
  });

  it('falls back to Urban Dictionary when the Gen-Z dataset has no exact match', async () => {
    const result = await querySlang({ term: 'nerfed' }, {});

    expect(result).toContain('[Urban Dictionary] nerfed: Made weaker by a game balance change.');
    expect(result).toContain('Example: The weapon got nerfed after the patch.');
  });

  it('searches the local wiki and slang providers together', async () => {
    const result = await searchKnowledge({ query: 'Jett lit' }, {});

    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ article_id: 'slang:genz:7', source: 'genz_slang' }),
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

  it('retrieves a complete slang row directly by provider row ID', async () => {
    const result = await getKnowledge({ article_id: 'slang:genz:7' }, {});

    expect(result.found).toBe(true);
    expect(result.title).toBe('lit');
    expect(result.source).toBe('genz_slang');
    expect(result.content).toContain('General chat');
  });

  it('returns not found when the dataset has no exact slang match', async () => {
    const result = await querySlang({ term: 'unknown-term' }, {});
    expect(result).toBe('No slang definition found for "unknown-term".');
  });
});

async function handleDatasetRequest(input) {
  const url = new URL(String(input));
  if (url.hostname === 'api.urbandictionary.com') {
    const term = url.searchParams.get('term')?.toLowerCase();
    return jsonResponse({ list: term === 'nerfed' ? [urbanEntry()] : [] });
  }
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

function urbanEntry() {
  return {
    defid: 42,
    word: 'nerfed',
    definition: 'Made weaker by a [game] balance change.',
    example: 'The weapon got [nerfed] after the patch.',
    permalink: 'https://www.urbandictionary.com/define.php?term=nerfed',
    thumbs_up: 100,
    thumbs_down: 5
  };
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
