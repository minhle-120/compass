import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { getSlangDb } from './db.js';

const DATASET = process.env.SLANG_DATASET || 'MLBtrio/genz-slang-dataset';
const CONFIG = process.env.SLANG_CONFIG || 'default';
const SPLIT = process.env.SLANG_SPLIT || 'train';
const PAGE_SIZE = Number.parseInt(process.env.SLANG_PAGE_SIZE || '100', 10);

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

export async function runSlangImport() {
  console.log('Fetching HuggingFace dataset size...');
  const sizeUrl = buildUrl('size', { dataset: DATASET });
  const sizePayload = await fetchJson(sizeUrl);
  const splitInfo = sizePayload?.size?.splits?.find(
    (item) => item.config === CONFIG && item.split === SPLIT
  );

  if (!splitInfo || typeof splitInfo.num_rows !== 'number') {
    throw new Error(`Could not determine row count for ${DATASET}/${CONFIG}/${SPLIT}`);
  }

  const totalRows = splitInfo.num_rows;
  const db = getSlangDb();

  try {
    db.exec("DELETE FROM slang");

    const insert = db.prepare(`
      INSERT OR REPLACE INTO slang (
        slang, description, example, context, source
      ) VALUES (?, ?, ?, ?, ?)
    `);

    // 1. Import Gen-Z slang
    console.log(`Importing ${totalRows} Gen-Z slang terms from Hugging Face...`);
    const insertBatch = db.transaction((rows) => {
      for (const entry of rows) {
        const row = entry.row || {};
        const term = (row.Slang ?? '').trim();
        const desc = (row.Description ?? '').trim();
        if (term && desc) {
          insert.run(
            term,
            desc,
            row.Example ?? null,
            row.Context ?? null,
            'genz'
          );
        }
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
      console.log(`Imported Gen-Z slang: ${imported}/${totalRows}`);
    }

    // 2. Import Game/Valorant terminology from SQL seed file
    console.log('Importing game terminology from SQL seed file...');
    const sqlPath = resolve(process.cwd(), 'services/slang/resources/seed_valorant_terminology.sql');
    if (existsSync(sqlPath)) {
      const sqlContent = readFileSync(sqlPath, 'utf8');
      db.exec(sqlContent);
      console.log('Successfully seeded game terms into slang table from SQL file.');
    } else {
      console.warn(`SQL seed file not found at ${sqlPath}`);
    }

    const total = db.prepare('SELECT COUNT(*) as count FROM slang').get();
    console.log(`Database initialization complete. Total slang/game records: ${total.count}`);
  } finally {
    // Note: getSlangDb returns the primary database singleton, so we do not close it here
  }
}
