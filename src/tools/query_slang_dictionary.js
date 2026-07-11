// src/tools/query_slang_dictionary.js

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
  return 'Query slang dictionary stub';
}
