import { flagUnknownWord } from '../../services/wiki/wikiService.js';

export const schema = {
  type: 'function',
  function: {
    name: 'flag_unknown_word',
    description: 'Flag an unfamiliar word for developer review. Call only after query_slang_dictionary and search_knowledge_base both return no result for the exact word.',
    parameters: {
      type: 'object',
      properties: {
        word: {
          type: 'string',
          description: 'The exact unfamiliar word or short phrase.'
        },
        context: {
          type: 'string',
          description: 'The original player sentence containing the word.'
        },
        reason: {
          type: 'string',
          description: 'Why the word appears relevant but could not be interpreted.'
        }
      },
      required: ['word', 'context']
    }
  }
};

export async function handler(args, sessionContext) {
  const result = flagUnknownWord({
    word: args?.word,
    context: args?.context,
    reason: args?.reason,
    ticketId: sessionContext?.ticketId
  });

  return {
    flagged: true,
    id: result.id,
    word: result.word,
    status: result.status,
    occurrence_count: result.occurrence_count,
    message: `Flagged "${result.word}" for developer review.`
  };
}
