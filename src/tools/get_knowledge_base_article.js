import { getWikiEntry } from '../../services/wiki/wikiService.js';
import { getSlangById } from '../../services/slang/slangService.js';

export const schema = {
  type: 'function',
  function: {
    name: 'get_knowledge_base_article',
    description: 'Retrieve a complete entry from the editable local Compass Wiki or the current Gen-Z slang dataset using an ID returned by search_knowledge_base.',
    parameters: {
      type: 'object',
      properties: {
        article_id: {
          type: 'string',
          description: 'The wiki: or slang: ID returned by search_knowledge_base.'
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
    if (articleId.startsWith('wiki:')) {
      const row = getWikiEntry(articleId.slice('wiki:'.length));
      if (!row) return notFound(articleId);

      return {
        found: true,
        article_id: articleId,
        title: row.term,
        status: 'published',
        summary: row.explanation,
        excerpt: row.explanation,
        content: row.explanation,
        category: row.category,
        source: 'compass_wiki',
        origin: row.origin,
        updated_at: row.updated_at
      };
    }

    if (articleId.startsWith('slang:')) {
      const row = await getSlangById(articleId.slice('slang:'.length));
      if (!row) return notFound(articleId);

      return {
        found: true,
        article_id: articleId,
        title: row.slang,
        status: 'reference',
        summary: row.description,
        excerpt: row.example,
        content: formatSlangContent(row),
        source: 'huggingface_genz_slang',
        source_dataset: row.source_dataset,
        example: row.example,
        context: row.context
      };
    }

    return {
      found: false,
      article_id: articleId,
      message: 'Unsupported article ID. Use an ID returned by search_knowledge_base.'
    };
  } catch (error) {
    return {
      found: false,
      article_id: articleId,
      message: `Knowledge lookup failed: ${error.message}`
    };
  }
}

function notFound(articleId) {
  return {
    found: false,
    article_id: articleId,
    message: `Knowledge entry "${articleId}" was not found.`
  };
}

function formatSlangContent(row) {
  return [
    row.description,
    row.example ? `Example: ${row.example}` : null,
    row.context ? `Context: ${row.context}` : null
  ].filter(Boolean).join('\n\n');
}
