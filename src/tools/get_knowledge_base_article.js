// src/tools/get_knowledge_base_article.js
import { getDb } from '../database/sqlite.js';
import {
  ensureKnowledgeBaseTable,
  getReferenceKnowledge,
  parseJsonArray
} from '../database/knowledgeBase.js';

export const schema = {
  type: 'function',
  function: {
    name: 'get_knowledge_base_article',
    description: 'Get the full content of a knowledge base article, terminology entry, or slang definition by its search result ID.',
    parameters: {
      type: 'object',
      properties: {
        article_id: {
          type: 'string',
          description: 'The article_id returned by search_knowledge_base.'
        }
      },
      required: ['article_id']
    }
  }
};

export async function handler(args, sessionContext) {
  const articleId = String(args?.article_id || '').trim();
  if (!articleId) {
    return {
      found: false,
      article_id: '',
      message: 'article_id is required.'
    };
  }

  try {
    const database = getDb();
    ensureKnowledgeBaseTable(database);

    const reference = getReferenceKnowledge(database, articleId);
    if (reference) {
      return reference;
    }

    const article = database.prepare(`
      SELECT
        id,
        title,
        status,
        platforms,
        game_versions,
        updated_at,
        summary,
        excerpt,
        content
      FROM kb_articles
      WHERE lower(id) = lower(?)
      LIMIT 1
    `).get(articleId);

    if (!article) {
      return {
        found: false,
        article_id: articleId,
        message: `Knowledge base article "${articleId}" was not found.`
      };
    }

    return {
      found: true,
      article_id: article.id,
      title: article.title,
      status: article.status,
      platforms: parseJsonArray(article.platforms),
      game_versions: parseJsonArray(article.game_versions),
      updated_at: article.updated_at,
      summary: article.summary,
      excerpt: article.excerpt,
      content: article.content
    };
  } catch (error) {
    return {
      found: false,
      article_id: articleId,
      message: `Knowledge base lookup failed: ${error.message}`
    };
  }
}
