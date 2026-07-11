import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearValorantWikiCache } from '../../../services/kb/kbService.js';
import { clearSlangCache } from '../../../services/slang/slangService.js';
import { handler as querySlang } from '../query_slang_dictionary.js';
import { handler as searchKnowledge } from '../search_knowledge_base.js';
import { handler as getKnowledge } from '../get_knowledge_base_article.js';

describe('Remote knowledge tools', () => {
  beforeEach(() => {
    clearValorantWikiCache();
    clearSlangCache();
    vi.stubGlobal('fetch', vi.fn(handleRemoteRequest));
  });

  it('looks up encountered slang directly from the Hugging Face dataset', async () => {
    const result = await querySlang({ term: 'lit' }, {});

    expect(result).toContain('[Gen-Z Slang] lit: Very exciting or excellent');
    expect(result).toContain('Example: That match was lit');
  });

  it('searches both remote providers without a local knowledge database', async () => {
    const result = await searchKnowledge({ query: 'Jett lit' }, {});

    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ article_id: 'slang:7', source: 'huggingface_genz_slang' }),
      expect.objectContaining({ article_id: 'wiki:101', source: 'valorant_wiki' })
    ]));
  });

  it('retrieves a complete Valorant Wiki page by search result ID', async () => {
    const result = await getKnowledge({ article_id: 'wiki:101' }, {});

    expect(result.found).toBe(true);
    expect(result.title).toBe('Jett');
    expect(result.source_revision_id).toBe(9001);
    expect(result.content).toContain('Duelist agent');
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

async function handleRemoteRequest(input) {
  const url = new URL(String(input));

  if (url.hostname === 'datasets-server.huggingface.co') {
    if (url.pathname === '/search') {
      const query = url.searchParams.get('query')?.toLowerCase();
      const rows = query === 'lit' ? [slangEntry()] : [];
      return jsonResponse({ rows });
    }

    if (url.pathname === '/rows' && url.searchParams.get('offset') === '7') {
      return jsonResponse({ rows: [slangEntry()] });
    }
  }

  if (url.hostname === 'wiki.playvalorant.com') {
    if (url.searchParams.get('list') === 'search') {
      return jsonResponse({
        query: {
          search: [{
            pageid: 101,
            title: 'Jett',
            snippet: 'Jett is a <span class="searchmatch">Duelist</span> agent.',
            timestamp: '2026-07-11T00:00:00Z'
          }]
        }
      });
    }

    if (url.searchParams.get('pageids') === '101') {
      return jsonResponse({
        query: {
          pages: [{
            pageid: 101,
            title: 'Jett',
            fullurl: 'https://wiki.playvalorant.com/en-us/Jett',
            extract: 'Jett is a Duelist agent known for mobility.',
            revisions: [{ revid: 9001, timestamp: '2026-07-11T00:00:00Z' }]
          }]
        }
      });
    }
  }

  return jsonResponse({ rows: [], query: { search: [], pages: [] } });
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
