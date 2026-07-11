export const TICKET_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidTicketId(value) {
  return typeof value === 'string' && TICKET_ID_PATTERN.test(value);
}

export function assertValidTicketId(value) {
  if (!isValidTicketId(value)) {
    throw new TypeError('Ticket ID may contain only letters, numbers, underscores, and hyphens.');
  }
  return value;
}
