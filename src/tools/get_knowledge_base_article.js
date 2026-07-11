// src/tools/get_knowledge_base_article.js
import { getKnowledgeBaseArticle } from '../database/sqlite.js';

export const schema = {
  type: 'function',
  function: {
    name: 'get_knowledge_base_article',
    description: 'Get the full content of a specific knowledge base article by its ID. Returns the complete article text.',
    parameters: {
      type: 'object',
      properties: {
        article_id: {
          type: 'string',
          description: 'The ID of the knowledge base article to retrieve.'
        }
      },
      required: ['article_id']
    }
  }
};

export async function handler(args, sessionContext) {
  const articleId = typeof args?.article_id === 'string' ? args.article_id.trim() : '';
  if (!articleId) {
    throw new TypeError('article_id must be a non-empty string');
  }

  const article = getKnowledgeBaseArticle(articleId);
  if (!article) {
    return JSON.stringify({ error: `Knowledge base article "${articleId}" not found`, article: null });
  }
  return JSON.stringify({ article });
}
