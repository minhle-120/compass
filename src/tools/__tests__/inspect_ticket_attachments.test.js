import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DB_PATH = ':memory:';
process.env.OPENAI_API_KEY = 'test-key';

vi.mock('axios', () => ({
  default: { post: vi.fn() }
}));

const axios = (await import('axios')).default;
const { initDb, insertTicket } = await import('../../database/sqlite.js');
const { handler, schema } = await import('../inspect_ticket_attachments.js');

describe('Inspect Ticket Attachments Tool', () => {
  beforeEach(() => {
    initDb().prepare('DELETE FROM tickets').run();
    axios.post.mockReset();
  });

  it('defines the attachment inspection command', () => {
    expect(schema.function.name).toBe('inspect_ticket_attachments');
  });

  it('sends images and sampled video frames to the vision model', async () => {
    insertTicket({
      id: 'T-MEDIA',
      subject: 'Visual issue',
      description: 'The HUD is broken',
      attachments: [
        {
          name: 'hud.png',
          type: 'image/png',
          size: 1,
          dataUrl: 'data:image/png;base64,YQ=='
        },
        {
          name: 'match.mp4',
          type: 'video/mp4',
          size: 1,
          dataUrl: 'data:video/mp4;base64,YQ==',
          frames: [{ timestamp: 2.5, dataUrl: 'data:image/jpeg;base64,Yg==' }]
        }
      ]
    });
    axios.post.mockResolvedValue({
      data: { choices: [{ message: { content: 'The HUD error banner is visible.' } }] }
    });

    const result = await handler({}, { ticketId: 'T-MEDIA' });

    expect(result).toMatchObject({
      summary: 'The HUD error banner is visible.',
      visuals_inspected: 2
    });
    const requestBody = axios.post.mock.calls[0][1];
    const visualParts = requestBody.messages[1].content.filter((part) => part.type === 'image_url');
    expect(visualParts).toHaveLength(2);
  });

  it('returns cleanly when a ticket has no attachments', async () => {
    insertTicket({ id: 'T-NO-MEDIA', subject: 'Question', description: 'Help' });

    await expect(handler({}, { ticketId: 'T-NO-MEDIA' })).resolves.toMatchObject({
      summary: 'No media attachments were supplied.'
    });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
