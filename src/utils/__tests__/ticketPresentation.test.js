import { describe, expect, it } from 'vitest';
import { presentTicket } from '../ticketPresentation.js';

const pendingReviewTicket = {
  id: 'T-REVIEW',
  status: 'completed',
  draft_response: 'Internal draft',
  draft_status: 'pending_review',
  resolution_type: 'resolved',
  resolution_reason: 'Answered'
};

describe('ticket presentation', () => {
  it('withholds pending drafts and resolution from the player', () => {
    expect(presentTicket(pendingReviewTicket)).toMatchObject({
      status: 'awaiting_review',
      draft_response: null,
      resolution_type: null,
      resolution_reason: null
    });
  });

  it('shows pending drafts to staff', () => {
    expect(presentTicket(pendingReviewTicket, { staff: true })).toEqual(pendingReviewTicket);
  });

  it('does not alter published tickets', () => {
    const published = { ...pendingReviewTicket, draft_response: null, draft_status: 'published' };
    expect(presentTicket(published)).toEqual(published);
  });

  it('maps completed status to needs_clarification when resolution_type is needs_clarification', () => {
    const needsClarificationTicket = {
      id: 'T-CLARIFY',
      status: 'completed',
      draft_response: 'Internal draft',
      draft_status: 'published',
      resolution_type: 'needs_clarification',
      resolution_reason: 'More info needed'
    };
    expect(presentTicket(needsClarificationTicket)).toMatchObject({
      status: 'needs_clarification',
      resolution_type: 'needs_clarification'
    });
  });
});
