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
