export function normalizeTicketSubmission(input, { createId = defaultTicketId } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Ticket submission must be a JSON object.');
  }

  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';

  if (!subject) {
    throw new TypeError('A valid string Ticket Subject is required.');
  }
  if (!description) {
    throw new TypeError('A valid string Ticket Description is required.');
  }

  return {
    id: createId(),
    subject,
    description,
    status: 'pending'
  };
}

function defaultTicketId() {
  return `T-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}
