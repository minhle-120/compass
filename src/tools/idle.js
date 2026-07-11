// src/tools/idle.js

export const schema = {
  type: 'function',
  function: {
    name: 'idle',
    description: 'Enter idle state. Call this when you have finished all your current tasks.',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
};

export async function handler(args, sessionContext) {
  return `# Agent idling\n\nAll tasks completed. Ready for review.`;
}
