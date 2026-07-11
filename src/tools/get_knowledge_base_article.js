// src/tools/get_knowledge_base_article.js

export const schema = {
  type: 'function',
  function: {
    name: 'get_knowledge_base_article',
    description: 'Get the full content of a specific knowledge base article by its ID. Returns the complete article text.',
    parameters: {
      type: 'object',
      properties: {
        article_id: {
          type: 'string',
          description: 'The ID of the knowledge base article to retrieve.'
        }
      },
      required: ['article_id']
    }
  }
};

export async function handler(args, sessionContext) {
  return 'Get knowledge base article stub';
}
