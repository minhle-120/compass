import { describe, expect, it } from 'vitest';
import { normalizeTicketSubmission } from '../ticketSubmission.js';

describe('ticket submission normalization', () => {
  const options = { createId: () => 'T-GENERATED' };

  it('returns only server-owned fields plus subject and description', () => {
    const result = normalizeTicketSubmission({
      id: 'USER-CONTROLLED',
      subject: '  Login problem  ',
      description: '  I cannot sign in.  ',
      status: 'completed',
      account_id: 'private-account',
      platform: 'PC'
    }, options);

    expect(result).toEqual({
      id: 'T-GENERATED',
      subject: 'Login problem',
      description: 'I cannot sign in.',
      attachments: [],
      status: 'pending'
    });
  });

  it.each([
    [null, 'Ticket submission must be a JSON object'],
    [[], 'Ticket submission must be a JSON object'],
    [{ description: 'Details' }, 'Ticket Subject'],
    [{ subject: 'Subject' }, 'Ticket Description'],
    [{ subject: '   ', description: 'Details' }, 'Ticket Subject'],
    [{ subject: 'Subject', description: '   ' }, 'Ticket Description']
  ])('rejects invalid submission %#', (input, error) => {
    expect(() => normalizeTicketSubmission(input, options)).toThrow(error);
  });

  it('normalizes supported image attachments', () => {
    expect(normalizeTicketSubmission({
      subject: 'Visual bug',
      description: 'See screenshot',
      attachments: [{
        name: '../screenshot.png',
        type: 'image/png',
        size: 999,
        dataUrl: 'data:image/png;base64,YQ=='
      }]
    }, options).attachments).toEqual([{
      name: 'screenshot.png',
      type: 'image/png',
      size: 1,
      dataUrl: 'data:image/png;base64,YQ=='
    }]);
  });

  it('requires sampled frames for video attachments', () => {
    expect(() => normalizeTicketSubmission({
      subject: 'Video bug',
      description: 'See recording',
      attachments: [{
        name: 'recording.mp4',
        dataUrl: 'data:video/mp4;base64,YQ=='
      }]
    }, options)).toThrow('must include preview frames');
  });

  it('rejects unsupported attachment types', () => {
    expect(() => normalizeTicketSubmission({
      subject: 'File',
      description: 'See file',
      attachments: [{ name: 'payload.svg', dataUrl: 'data:image/svg+xml;base64,YQ==' }]
    }, options)).toThrow('unsupported type');
  });
});
