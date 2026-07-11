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
});
