// src/tools/search_knowledge_base.js
import { getDb } from '../database/sqlite.js';
import { ensureKnowledgeBaseTable, searchReferenceKnowledge } from '../../services/kb/kbService.js';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'i', 'in',
  'is', 'it', 'my', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was',
  'with', 'you', 'your'
]);

export const schema = {
  type: 'function',
  function: {
    name: 'search_knowledge_base',
    description: 'Search the game knowledge base, FAQ, terminology, and slang for entries matching the given query. Returns matching IDs and summaries.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords, player text, or slang to search for in the knowledge base.'
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
    .match(/[a-z0-9_-]+/g)
    ?.filter((term, index, values) => values.indexOf(term) === index)
    .filter((term) => !STOP_WORDS.has(term))
    .slice(0, 24) || [];

  if (terms.length === 0) {
    return {
      query,
      total_matches: 0,
      results: [],
      message: 'Query must contain searchable letters or numbers.'
    };
  }

  const whereClause = terms
    .map(() => '(lower(id) LIKE ? OR lower(title) LIKE ? OR lower(summary) LIKE ? OR lower(excerpt) LIKE ? OR lower(content) LIKE ?)')
    .join(' OR ');

  const params = [];
  for (const term of terms) {
    const param = `%${term}%`;
    params.push(param, param, param, param, param);
  }

  try {
    const database = getDb();
    ensureKnowledgeBaseTable(database);

    const articleRows = database.prepare(`
      SELECT
        id,
        title,
        summary,
        status,
        updated_at,
        CASE
          WHEN lower(id) = lower(?) THEN 100
          WHEN lower(title) = lower(?) THEN 80
          WHEN lower(title) LIKE lower(?) THEN 60
          WHEN lower(summary) LIKE lower(?) THEN 40
          ELSE 10
        END AS relevance
      FROM kb_articles
      WHERE ${whereClause}
      ORDER BY relevance DESC, updated_at DESC, title ASC
      LIMIT 10
    `).all(query, query, `%${query}%`, `%${query}%`, ...params);

    const articleResults = articleRows.map((row) => ({
      article_id: row.id,
      title: row.title,
      summary: row.summary,
      status: row.status,
      updated_at: row.updated_at,
      source: 'knowledge_base_article',
      relevance: row.relevance
    }));

    const referenceResults = searchReferenceKnowledge(database, query, terms);
    const combinedResults = [...articleResults, ...referenceResults]
      .sort((left, right) => right.relevance - left.relevance)
      .slice(0, 10)
      .map(({ relevance, ...result }) => result);

    return {
      query,
      total_matches: combinedResults.length,
      results: combinedResults
    };
  } catch (error) {
    return {
      query,
      total_matches: 0,
      results: [],
      message: `Knowledge base search failed: ${error.message}`
    };
  }
}
