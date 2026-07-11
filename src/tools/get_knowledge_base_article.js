// src/tools/get_knowledge_base_article.js
import { getDb, getKnowledgeBaseArticle } from '../database/sqlite.js';
import { getReferenceKnowledge } from '../../services/kb/kbService.js';

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

  const database = getDb();
  const reference = getReferenceKnowledge(database, articleId);
  if (reference) return reference;

  const article = getKnowledgeBaseArticle(articleId);
  if (!article) return { found: false, article_id: articleId };
  return {
    found: true,
    article_id: article.id,
    source: 'knowledge_base_article',
    ...article
  };
}
