// src/tools/search_knowledge_base.js
import { searchKnowledgeBase } from '../database/sqlite.js';

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
  return JSON.stringify({ articles: searchKnowledgeBase(query) });
}
