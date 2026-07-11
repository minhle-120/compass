import { searchValorantWiki } from '../../services/kb/kbService.js';
import { searchSlang } from '../../services/slang/slangService.js';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'i', 'in',
  'is', 'it', 'my', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was',
  'with', 'you', 'your'
]);

export const schema = {
  type: 'function',
  function: {
    name: 'search_knowledge_base',
    description: 'Search the live Valorant Wiki and the current Gen-Z slang dataset. Returns IDs and summaries that can be passed to get_knowledge_base_article.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Player text or keywords to search for in the live knowledge sources.'
        }
      },
      required: ['query']
    }
  }
};

export async function handler(args, sessionContext) {
  const query = String(args?.query || '').trim();
  if (!query) {
    return {
      query: '',
      total_matches: 0,
      results: [],
      message: 'Query is required.'
    };
  }

  const terms = query
    .toLowerCase()
    .match(/[a-z0-9_+-]+/g)
    ?.filter((term, index, values) => values.indexOf(term) === index)
    .filter((term) => !STOP_WORDS.has(term))
    .slice(0, 12) || [];

  if (terms.length === 0) {
    return {
      query,
      total_matches: 0,
      results: [],
      message: 'Query must contain searchable letters or numbers.'
    };
  }

  const [wikiResult, slangResult] = await Promise.allSettled([
    searchValorantWiki(query),
    searchSlang(query, terms)
  ]);

  const results = [];
  const errors = [];

  if (slangResult.status === 'fulfilled') {
    for (const row of slangResult.value) {
      results.push({
        article_id: `slang:${row.id}`,
        title: row.slang,
        summary: row.description,
        status: 'reference',
        updated_at: null,
        source: 'huggingface_genz_slang',
        source_dataset: row.source_dataset,
        relevance: 100
      });
    }
  } else {
    errors.push(`Gen-Z slang lookup failed: ${slangResult.reason?.message || slangResult.reason}`);
  }

  if (wikiResult.status === 'fulfilled') {
    for (const row of wikiResult.value) {
      results.push({ ...row, relevance: 50 });
    }
  } else {
    errors.push(`Valorant Wiki search failed: ${wikiResult.reason?.message || wikiResult.reason}`);
  }

  const rankedResults = results
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, 10)
    .map(({ relevance, ...result }) => result);

  return {
    query,
    total_matches: rankedResults.length,
    results: rankedResults,
    ...(errors.length ? { warnings: errors } : {})
  };
}
