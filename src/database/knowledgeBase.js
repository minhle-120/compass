import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { resolve } from 'path';

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

export function searchReferenceKnowledge(database, query, terms) {
  const results = [];

  if (tableExists(database, 'slang_terms')) {
    const placeholders = terms.map(() => '?').join(', ');
    const rows = database.prepare(`
      SELECT term, canonical_form, meaning, interpretation_notes
      FROM slang_terms
      WHERE lower(term) IN (${placeholders})
         OR lower(canonical_form) IN (${placeholders})
      LIMIT 10
    `).all(...terms, ...terms);

    for (const row of rows) {
      results.push({
        article_id: `local-slang:${encodeURIComponent(row.term)}`,
        title: row.term,
        summary: row.meaning,
        status: 'reference',
        updated_at: null,
        source: 'local_slang',
        relevance: 100
      });
    }
  }

  const terminologyRows = withExternalDatabase(
    process.env.GAME_KNOWLEDGE_DB_PATH || './data/Game Knowledge Base.sqlite',
    (externalDb) => {
      const clauses = [];
      const params = [];

      for (const term of terms) {
        clauses.push(`(
          lower(term) = ?
          OR lower(term) LIKE ?
          OR lower(term) LIKE ?
          OR (? >= 3 AND lower(term) LIKE ?)
        )`);
        params.push(term, `${term} (%`, `${term} %`, term.length, `${term}%`);
      }

      return externalDb.prepare(`
        SELECT id, term, explanation
        FROM terminology
        WHERE ${clauses.join(' OR ')}
        ORDER BY length(term) ASC
        LIMIT 10
      `).all(...params);
    }
  ) || [];

  for (const row of terminologyRows) {
    results.push({
      article_id: `terminology:${row.id}`,
      title: row.term,
      summary: row.explanation,
      status: 'reference',
      updated_at: null,
      source: 'game_terminology',
      relevance: 90
    });
  }

  const slangRows = withExternalDatabase(
    process.env.SLANG_DB_PATH || './data/slang.sqlite',
    (externalDb) => {
      const placeholders = terms.map(() => '?').join(', ');
      return externalDb.prepare(`
        SELECT id, slang, description
        FROM slang
        WHERE lower(slang) IN (${placeholders})
           OR (length(slang) >= 3 AND instr(lower(?), lower(slang)) > 0)
        ORDER BY
          CASE WHEN lower(slang) IN (${placeholders}) THEN 0 ELSE 1 END,
          length(slang) DESC
        LIMIT 10
      `).all(...terms, query.toLowerCase(), ...terms);
    }
  ) || [];

  for (const row of slangRows) {
    results.push({
      article_id: `slang:${row.id}`,
      title: row.slang,
      summary: row.description || '',
      status: 'reference',
      updated_at: null,
      source: 'slang_dataset',
      relevance: 80
    });
  }

  return results;
}

export function getReferenceKnowledge(database, articleId) {
  if (articleId.startsWith('local-slang:')) {
    if (!tableExists(database, 'slang_terms')) return null;

    const encodedTerm = articleId.slice('local-slang:'.length);
    let term;
    try {
      term = decodeURIComponent(encodedTerm);
    } catch {
      return null;
    }

    const row = database.prepare(`
      SELECT term, canonical_form, language, meaning, common_uses,
             interpretation_notes, related_terms
      FROM slang_terms
      WHERE lower(term) = lower(?)
      LIMIT 1
    `).get(term);

    if (!row) return null;

    return {
      found: true,
      article_id: articleId,
      source: 'local_slang',
      title: row.term,
      status: 'reference',
      summary: row.meaning,
      excerpt: row.interpretation_notes || '',
      content: formatSlangContent(row.meaning, null, row.interpretation_notes),
      canonical_form: row.canonical_form,
      language: row.language,
      common_uses: parseJsonArray(row.common_uses),
      related_terms: parseJsonArray(row.related_terms)
    };
  }

  if (articleId.startsWith('terminology:')) {
    const id = articleId.slice('terminology:'.length);
    const row = withExternalDatabase(
      process.env.GAME_KNOWLEDGE_DB_PATH || './data/Game Knowledge Base.sqlite',
      (externalDb) => externalDb.prepare(`
        SELECT id, term, explanation
        FROM terminology
        WHERE id = ?
        LIMIT 1
      `).get(id)
    );

    if (!row) return null;

    return {
      found: true,
      article_id: articleId,
      source: 'game_terminology',
      title: row.term,
      status: 'reference',
      summary: row.explanation,
      excerpt: row.explanation,
      content: row.explanation
    };
  }

  if (articleId.startsWith('slang:')) {
    const id = articleId.slice('slang:'.length);
    const row = withExternalDatabase(
      process.env.SLANG_DB_PATH || './data/slang.sqlite',
      (externalDb) => externalDb.prepare(`
        SELECT id, slang, description, example, context, source_dataset
        FROM slang
        WHERE id = ?
        LIMIT 1
      `).get(id)
    );

    if (!row) return null;

    return {
      found: true,
      article_id: articleId,
      source: 'slang_dataset',
      source_dataset: row.source_dataset,
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

function tableExists(database, tableName) {
  return Boolean(database.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName));
}

function withExternalDatabase(dbPath, callback) {
  const resolvedPath = resolve(process.cwd(), dbPath);
  if (!existsSync(resolvedPath)) return null;

  const database = new Database(resolvedPath, { readonly: true });
  try {
    return callback(database);
  } finally {
    database.close();
  }
}

function formatSlangContent(description, example, context) {
  return [
    description,
    example ? `Example: ${example}` : null,
    context ? `Context: ${context}` : null
  ].filter(Boolean).join('\n\n');
}
