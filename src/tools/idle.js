// src/tools/idle.js

export const schema = {
  type: 'function',
  function: {
    name: 'idle',
    description: 'Enter idle state. Call this when you have finished all your current tasks.',
    parameters: {
      type: 'object',
      properties: {
        resolution_type: {
          type: 'string',
          enum: ['resolved', 'needs_clarification', 'escalated', 'rejected'],
          description: 'The final outcome category of the ticket processing loop.'
        },
        reason: {
          type: 'string',
          description: 'A brief explanation justifying the chosen resolution outcome.'
        }
      },
      required: ['resolution_type', 'reason']
    }
  }
};

export async function handler(args, sessionContext) {
  const { resolution_type, reason } = args;
  
  // Record outcomes in the thread-shared session context
  sessionContext.resolutionType = resolution_type;
  sessionContext.resolutionReason = reason;

  return `# Agent idling\n\nResolution: ${resolution_type}\nReason: ${reason}`;
}
