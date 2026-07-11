// src/tools/report_unknown_slang.js

export const schema = {
  type: 'function',
  function: {
    name: 'report_unknown_slang',
    description: 'Report slang or terms that the agent does not understand. These terms will be flagged for manual review and added to the slang dictionary by staff.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              term: {
                type: 'string',
                description: 'The unknown slang term.'
              },
              context: {
                type: 'string',
                description: 'The surrounding player-authored text in which the term appeared.'
              }
            },
            required: ['term', 'context']
          },
          description: 'Unknown slang terms and the contexts in which they appeared.'
        }
      },
      required: ['items']
    }
  }
};

export async function handler(args, sessionContext) {
  return 'Report unknown slang stub';
}
