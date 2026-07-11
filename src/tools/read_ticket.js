// src/tools/read_ticket.js

export const schema = {
  type: 'function',
  function: {
    name: 'read_ticket',
    description: 'Read the current ticket being processed. Returns ticket content, metadata, and status.',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
};

export async function handler(args, sessionContext) {
  return 'Ticket content stub';
}
