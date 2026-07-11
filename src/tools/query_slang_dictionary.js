// src/tools/query_slang_dictionary.js
import { lookupSlang } from '../../services/slang/slangService.js';

export const schema = {
  type: 'function',
  function: {
    name: 'query_slang_dictionary',
    description: 'Look up gaming slang, gaming terms, or unknown words in the slang dictionary. Returns the meaning/definition of gaming-specific and Gen-Z terminology.',
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

  try {
    const row = lookupSlang(term);

    if (row) {
      const type = row.source === 'game' ? 'Gaming Term' : 'Gen-Z Slang';
      const exampleStr = row.example ? `\nExample: ${row.example}` : '';
      const contextStr = row.context ? `\nContext: ${row.context}` : '';
      return `[${type}] ${row.slang}: ${row.description}${exampleStr}${contextStr}`;
    }

    return `No slang definition found for "${term}".`;
  } catch (error) {
    return `Slang lookup failed: ${error.message}`;
  }
}
