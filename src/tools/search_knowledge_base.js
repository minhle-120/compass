// src/tools/search_knowledge_base.js
import { getDb } from '../database/sqlite.js';
import { searchReferenceKnowledge } from '../../services/kb/kbService.js';

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
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) {
    throw new TypeError('query must be a non-empty string');
  }
  const database = getDb();
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])];
  const results = searchReferenceKnowledge(database, query, terms);
  const faqRows = database.prepare(`
    SELECT id, title, status, updated_at, summary, excerpt
    FROM kb_articles
  `).all();

  for (const article of faqRows) {
    const searchable = [article.title, article.summary, article.excerpt].filter(Boolean).join(' ').toLowerCase();
    const relevance = terms.reduce((score, term) => score + (searchable.includes(term) ? 1 : 0), 0);
    if (relevance > 0) {
      results.push({
        article_id: article.id,
        title: article.title,
        summary: article.summary,
        status: article.status,
        updated_at: article.updated_at,
        source: 'knowledge_base_article',
        relevance
      });
    }
  }

  results.sort((a, b) => b.relevance - a.relevance || a.title.localeCompare(b.title));
  return { query, total_matches: results.length, results: results.slice(0, 10) };
}
