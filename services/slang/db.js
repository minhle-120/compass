import { getDb } from '../../src/database/sqlite.js';

export function getSlangDb() {
  return getDb();
}

export function initSlangSchema(db) {
  // Already initialized in primary sqlite.js, so this is a no-op
}
