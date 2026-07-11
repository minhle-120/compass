// src/tools/query_slang_dictionary.js
import { lookupSlang } from '../../services/slang/slangService.js';

export const schema = {
  type: 'function',
  function: {
    name: 'query_slang_dictionary',
    description: 'Look up a slang term in the local Compass slang wiki, the Gen-Z slang dataset, and Urban Dictionary.',
    parameters: {
      type: 'object',
      properties: {
        term: {
          type: 'string',
          description: 'The slang term encountered in the player message.'
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

  try {
    const row = await lookupSlang(term);

    if (row) {
      const exampleStr = row.example ? `\nExample: ${row.example}` : '';
      const contextStr = row.context ? `\nContext: ${row.context}` : '';
      return `[${formatSource(row)}] ${row.slang}: ${row.description}${exampleStr}${contextStr}`;
    }

    return `No slang definition found for "${term}".`;
  } catch (error) {
    return `Slang lookup failed: ${error.message}`;
  }
}

function formatSource(row) {
  if (row.source === 'local_slang') return 'Compass Slang';
  if (row.source === 'urban_dictionary') return 'Urban Dictionary';
  return 'Gen-Z Slang';
}
