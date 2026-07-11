import { getSlangDb } from './db.js';

export function lookupSlang(term) {
  const db = getSlangDb();
  return db.prepare(`
    SELECT slang, description, example, context, source
    FROM slang
    WHERE lower(slang) = lower(?)
    LIMIT 1
  `).get(term);
}

export function searchSlang(query, terms) {
  const db = getSlangDb();
  const placeholders = terms.map(() => '?').join(', ');
  return db.prepare(`
    SELECT id, slang, description, source
    FROM slang
    WHERE lower(slang) IN (${placeholders})
       OR (length(slang) >= 3 AND instr(lower(?), lower(slang)) > 0)
    ORDER BY
      CASE WHEN lower(slang) IN (${placeholders}) THEN 0 ELSE 1 END,
      length(slang) DESC
    LIMIT 15
  `).all(...terms, query.toLowerCase(), ...terms);
}

export function getSlangById(id) {
  const db = getSlangDb();
  return db.prepare(`
    SELECT id, slang, description, example, context, source
    FROM slang
    WHERE id = ?
    LIMIT 1
  `).get(id);
}
