import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';

const args = process.argv.slice(2);
const dbOptionIndex = args.indexOf('--db');
let dbPath = process.env.GAME_KNOWLEDGE_DB_PATH || './data/Game Knowledge Base.sqlite';

if (dbOptionIndex !== -1) {
  if (!args[dbOptionIndex + 1]) {
    console.error('The --db option requires a database path.');
    process.exit(1);
  }
  dbPath = args[dbOptionIndex + 1];
  args.splice(dbOptionIndex, 2);
}

const sqlFiles = args;

if (sqlFiles.length === 0) {
  console.error('No SQL files provided.');
  process.exit(1);
}

const resolvedDbPath = resolve(process.cwd(), dbPath);
const dbDir = dirname(resolvedDbPath);
if (dbDir && dbDir !== '.') {
  mkdirSync(dbDir, { recursive: true });
}

const db = new Database(resolvedDbPath, { timeout: 10000 });

try {
  db.pragma('foreign_keys = ON');
  for (const sqlFile of sqlFiles) {
    const resolvedSqlPath = resolve(process.cwd(), sqlFile);
    if (!existsSync(resolvedSqlPath)) {
      throw new Error(`SQL file not found: ${resolvedSqlPath}`);
    }
    const sql = readFileSync(resolvedSqlPath, 'utf8');
    db.exec(sql);
    console.log(`Applied SQL: ${resolvedSqlPath}`);
  }
  console.log(`Database ready: ${resolvedDbPath}`);
} finally {
  db.close();
}
