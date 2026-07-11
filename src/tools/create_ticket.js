import { getDb, insertTicket } from '../database/sqlite.js';

export const schema = {
  type: 'function',
  function: {
    name: 'create_ticket',
    description: 'Create a new game-support ticket with a generated ID, title, description, requester, and ticket type.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short summary of the player issue.' },
        description: { type: 'string', description: 'Full player issue details.' },
        requester: { type: 'string', description: 'Player or requester name.' },
        ticket_type: {
          type: 'string',
          enum: [
            'account', 'bug', 'player_report', 'payment_issue', 'connection_issue',
            'crash_or_freeze', 'missing_item', 'gameplay_issue', 'cheating_or_exploit',
            'harassment_or_safety', 'ban_or_appeal', 'feedback'
          ],
          description: 'Game-support ticket category.'
        }
      },
      required: ['title', 'description', 'requester', 'ticket_type']
    }
  }
};

export async function handler({ title, description, requester, ticket_type }) {
  if (![title, description, requester, ticket_type].every((value) => typeof value === 'string' && value.trim())) {
    throw new Error('title, description, requester, and ticket_type are required.');
  }

  const creationTime = new Date().toISOString();
  const id = `GAME-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  insertTicket({
    id,
    subject: title.trim(),
    description: description.trim(),
    requester_id: requester.trim(),
    status: 'pending',
    created_at: creationTime,
    updated_at: creationTime
  });

  // Store the type in the existing categories field so no database schema change is needed.
  getDb().prepare('UPDATE tickets SET categories = ? WHERE id = ?')
    .run(JSON.stringify([`ticket_type:${ticket_type.trim()}`]), id);

  return JSON.stringify({
    id,
    title: title.trim(),
    description: description.trim(),
    requester: requester.trim(),
    ticket_type: ticket_type.trim(),
    status: 'pending',
    creation_time: creationTime
  });
}
