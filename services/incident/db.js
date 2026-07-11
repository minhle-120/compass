import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
let db;

export function getIncidentDb() {
  if (db) return db;

  const dbPath = process.env.INCIDENT_DB_PATH || './data/incidents.sqlite';
  const dbDir = dirname(dbPath);
  if (dbPath !== ':memory:' && dbDir && dbDir !== '.') {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath, { timeout: 10000 });
  db.pragma('foreign_keys = ON');

  const migrationPath = join(__dirname, 'resources', '001_initial.sql');
  if (!existsSync(migrationPath)) {
    throw new Error(`Incident database migration not found: ${migrationPath}`);
  }
  db.exec(readFileSync(migrationPath, 'utf8'));

  return db;
}
