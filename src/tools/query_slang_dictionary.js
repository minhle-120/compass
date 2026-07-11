// src/tools/query_slang_dictionary.js
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { getDb } from '../database/sqlite.js';

export const schema = {
  type: 'function',
  function: {
    name: 'query_slang_dictionary',
    description: 'Look up gaming slang or unknown terms in the slang dictionary. Returns the meaning/definition of gaming-specific terminology.',
    parameters: {
      type: 'object',
      properties: {
        term: {
          type: 'string',
          description: 'The slang term or unknown word to look up.'
        }
      },
      required: ['term']
    }
  }
};

export async function handler(args, sessionContext) {
  const term = String(args?.term || '').trim();
  if (!term) {
    return 'A slang term is required.';
  }

  const primaryDb = getDb();
  const slangRow = primaryDb.prepare(`
    SELECT term, canonical_form, meaning, interpretation_notes
    FROM slang_terms
    WHERE lower(term) = lower(?) OR lower(canonical_form) = lower(?)
    ORDER BY CASE WHEN lower(term) = lower(?) THEN 0 ELSE 1 END
    LIMIT 1
  `).get(term, term, term);

  if (slangRow) {
    const canonical = slangRow.canonical_form && slangRow.canonical_form.toLowerCase() !== slangRow.term.toLowerCase()
      ? ` (${slangRow.canonical_form})`
      : '';
    const notes = slangRow.interpretation_notes ? ` ${slangRow.interpretation_notes}` : '';
    return `${slangRow.term}${canonical}: ${slangRow.meaning}${notes}`;
  }

  const terminologyResult = lookupExternalDatabase(
    process.env.GAME_KNOWLEDGE_DB_PATH || './data/Game Knowledge Base.sqlite',
    (database) => database.prepare(`
      SELECT term, explanation
      FROM terminology
      WHERE lower(term) = lower(?)
        OR lower(term) LIKE lower(?)
        OR lower(term) LIKE lower(?)
        OR lower(term) LIKE lower(?)
        OR (length(?) >= 3 AND lower(term) LIKE lower(?))
      ORDER BY
        CASE
          WHEN lower(term) = lower(?) THEN 0
          WHEN lower(term) LIKE lower(?) OR lower(term) LIKE lower(?) THEN 1
          ELSE 2
        END,
        length(term) ASC
      LIMIT 1
    `).get(
      term,
      `${term} %`,
      `${term} (%`,
      `${term}/%`,
      term,
      `${term}%`,
      term,
      `${term} %`,
      `${term} (%`
    ),
    (row) => `${row.term}: ${row.explanation}`
  );

  if (terminologyResult) {
    return terminologyResult;
  }

  const datasetResult = lookupExternalDatabase(
    process.env.SLANG_DB_PATH || './data/slang.sqlite',
    (database) => database.prepare(`
      SELECT slang, description, example, context
      FROM slang
      WHERE lower(slang) = lower(?)
      ORDER BY source_row_idx ASC
      LIMIT 1
    `).get(term),
    (row) => {
      const example = row.example ? ` Example: ${row.example}` : '';
      const context = row.context ? ` Context: ${row.context}` : '';
      return `${row.slang}: ${row.description}${example}${context}`;
    }
  );

  return datasetResult || `No slang definition found for "${term}".`;
}

function lookupExternalDatabase(dbPath, query, format) {
  const resolvedPath = resolve(process.cwd(), dbPath);
  if (!existsSync(resolvedPath)) {
    return null;
  }

  const database = new Database(resolvedPath, { readonly: true });
  try {
    const row = query(database);
    return row ? format(row) : null;
  } finally {
    database.close();
  }
}
