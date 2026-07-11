import 'dotenv/config';
import Database from 'better-sqlite3';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

const DATASET = process.env.SLANG_DATASET || 'MLBtrio/genz-slang-dataset';
const CONFIG = process.env.SLANG_CONFIG || 'default';
const SPLIT = process.env.SLANG_SPLIT || 'train';
const DB_PATH = process.env.SLANG_DB_PATH || './data/slang.sqlite';
const PAGE_SIZE = Number.parseInt(process.env.SLANG_PAGE_SIZE || '100', 10);

const resolvedDbPath = resolve(process.cwd(), DB_PATH);
const dbDir = dirname(resolvedDbPath);
if (dbDir && dbDir !== '.') {
  mkdirSync(dbDir, { recursive: true });
}

function buildUrl(path, params) {
  const url = new URL(`https://datasets-server.huggingface.co/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}) ${url}\n${body}`);
  }
  return response.json();
}

async function main() {
  const sizeUrl = buildUrl('size', { dataset: DATASET });
  const sizePayload = await fetchJson(sizeUrl);
  const splitInfo = sizePayload?.size?.splits?.find(
    (item) => item.config === CONFIG && item.split === SPLIT
  );

  if (!splitInfo || typeof splitInfo.num_rows !== 'number') {
    throw new Error(`Could not determine row count for ${DATASET}/${CONFIG}/${SPLIT}`);
  }

  const totalRows = splitInfo.num_rows;
  const database = new Database(resolvedDbPath, { timeout: 10000 });

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS slang (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_row_idx INTEGER NOT NULL,
        slang TEXT NOT NULL,
        description TEXT,
        example TEXT,
        context TEXT,
        source_dataset TEXT NOT NULL,
        source_config TEXT NOT NULL,
        source_split TEXT NOT NULL,
        UNIQUE(source_dataset, source_config, source_split, source_row_idx)
      );
    `);

    const clearExisting = database.prepare(`
      DELETE FROM slang
      WHERE source_dataset = ? AND source_config = ? AND source_split = ?
    `);
    clearExisting.run(DATASET, CONFIG, SPLIT);

    const insert = database.prepare(`
      INSERT INTO slang (
        source_row_idx, slang, description, example, context,
        source_dataset, source_config, source_split
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBatch = database.transaction((rows) => {
      for (const entry of rows) {
        const row = entry.row || {};
        insert.run(
          entry.row_idx,
          row.Slang ?? '',
          row.Description ?? null,
          row.Example ?? null,
          row.Context ?? null,
          DATASET,
          CONFIG,
          SPLIT
        );
      }
    });

    let imported = 0;
    for (let offset = 0; offset < totalRows; offset += PAGE_SIZE) {
      const length = Math.min(PAGE_SIZE, totalRows - offset);
      const rowsUrl = buildUrl('rows', {
        dataset: DATASET,
        config: CONFIG,
        split: SPLIT,
        offset,
        length
      });
      const payload = await fetchJson(rowsUrl);
      const rows = payload.rows || [];
      insertBatch(rows);
      imported += rows.length;
      console.log(`Imported ${imported}/${totalRows}`);
    }

    console.log(`Completed import into ${resolvedDbPath}`);
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
