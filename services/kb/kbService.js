import { searchSlang, getSlangById } from '../slang/slangService.js';

// Ensures the primary database has the kb_articles table for FAQs
export function ensureKnowledgeBaseTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS kb_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      platforms TEXT,
      game_versions TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      summary TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kb_articles_updated_at
      ON kb_articles(updated_at);
  `);
}

export function parseJsonArray(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Searches the merged slang/terminology database via the slangService
export function searchReferenceKnowledge(database, query, terms) {
  const results = [];
  const rows = searchSlang(query, terms) || [];

  for (const row of rows) {
    results.push({
      article_id: `slang:${row.id}`,
      title: row.slang,
      summary: row.description || '',
      status: 'reference',
      updated_at: null,
      source: row.source === 'game' ? 'game_terminology' : 'genz_slang',
      relevance: row.source === 'game' ? 95 : 80
    });
  }

  return results;
}

// Retrieves details for a specific reference knowledge article via the slangService
export function getReferenceKnowledge(database, articleId) {
  if (articleId.startsWith('slang:')) {
    const id = articleId.slice('slang:'.length);
    const row = getSlangById(id);

    if (!row) return null;

    return {
      found: true,
      article_id: articleId,
      source: row.source === 'game' ? 'game_terminology' : 'genz_slang',
      title: row.slang,
      status: 'reference',
      summary: row.description || '',
      excerpt: row.example || '',
      content: formatSlangContent(row.description, row.example, row.context),
      example: row.example,
      context: row.context
    };
  }

  return null;
}

function formatSlangContent(description, example, context) {
  return [
    description,
    example ? `Example: ${example}` : null,
    context ? `Context: ${context}` : null
  ].filter(Boolean).join('\n\n');
}
