export function presentTicket(ticket, { staff = false } = {}) {
  if (!ticket) return ticket;
  const presented = { ...ticket };

  if (!staff && presented.draft_status === 'pending_review') {
    presented.draft_response = null;
    presented.resolution_type = null;
    presented.resolution_reason = null;
    presented.status = 'awaiting_review';
  }

  return presented;
}
