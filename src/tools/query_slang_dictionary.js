// src/tools/query_slang_dictionary.js
import { lookupSlang } from '../../services/slang/slangService.js';

export const schema = {
  type: 'function',
  function: {
    name: 'query_slang_dictionary',
    description: 'Look up a slang term directly in the current MLBtrio/genz-slang-dataset on Hugging Face.',
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
      return `[Gen-Z Slang] ${row.slang}: ${row.description}${exampleStr}${contextStr}`;
    }

    return `No slang definition found for "${term}".`;
  } catch (error) {
    return `Slang lookup failed: ${error.message}`;
  }
}
