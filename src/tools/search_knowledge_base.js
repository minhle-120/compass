import { searchWikiEntries } from '../../services/wiki/wikiService.js';
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
    description: 'Search the editable local Compass game wiki plus local and remote slang sources. Returns IDs and summaries that can be passed to get_knowledge_base_article.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Player text or keywords to search for in the local game wiki and slang dictionaries.'
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
    Promise.resolve(searchWikiEntries(query, 10)),
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
        source: row.source,
        source_dataset: row.source_dataset,
        source_url: row.source_url,
        relevance: 100
      });
    }
  } else {
    errors.push(`Slang lookup failed: ${slangResult.reason?.message || slangResult.reason}`);
  }

  if (wikiResult.status === 'fulfilled') {
    wikiResult.value.forEach((row, index) => {
      results.push({
        article_id: `wiki:${row.id}`,
        title: row.term,
        summary: row.explanation,
        category: row.category,
        status: 'published',
        updated_at: row.updated_at,
        source: 'compass_wiki',
        relevance: 80 - index
      });
    });
  } else {
    errors.push(`Local wiki search failed: ${wikiResult.reason?.message || wikiResult.reason}`);
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
