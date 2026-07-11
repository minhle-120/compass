// src/tools/search_knowledge_base.js
import { getDb } from '../database/sqlite.js';

export const schema = {
  type: 'function',
  function: {
    name: 'search_knowledge_base',
    description: 'Search the game knowledge base and FAQ for articles matching the given query. Returns a list of matching article IDs and summaries.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search for in the knowledge base.'
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

  const database = getDb();
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 8);
  const likeParams = terms.map((term) => `%${term}%`);

  const whereClause = terms
    .map(() => '(id LIKE ? OR title LIKE ? OR summary LIKE ? OR excerpt LIKE ? OR content LIKE ?)')
    .join(' OR ');

  const params = [];
  for (const param of likeParams) {
    params.push(param, param, param, param, param);
  }

  let rows = [];
  try {
    const stmt = database.prepare(`
      SELECT id, title, summary, status, updated_at
      FROM kb_articles
      WHERE ${whereClause}
      ORDER BY updated_at DESC
      LIMIT 10
    `);
    rows = stmt.all(...params);
  } catch (err) {
    return {
      query,
      total_matches: 0,
      results: [],
      message: `Knowledge base lookup failed: ${err.message}`
    };
  }

  return {
    query,
    total_matches: rows.length,
    results: rows.map((row) => ({
      article_id: row.id,
      title: row.title,
      summary: row.summary,
      status: row.status,
      updated_at: row.updated_at
    }))
  };
}
