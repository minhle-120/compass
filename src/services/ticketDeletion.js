import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { deleteResolvedTicketRecord, getTicket } from '../database/sqlite.js';
import { assertValidTicketId } from '../utils/ticketId.js';
import { logger } from '../utils/logger.js';

export class TicketDeletionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TicketDeletionError';
    this.code = code;
  }
}

export function deleteResolvedTicket(ticketId) {
  const id = assertValidTicketId(ticketId);
  const ticket = getTicket(id);

  if (!ticket) {
    throw new TicketDeletionError('TICKET_NOT_FOUND', `Ticket "${id}" was not found.`);
  }
  if (ticket.status !== 'completed' || ticket.resolution_type !== 'resolved') {
    throw new TicketDeletionError(
      'TICKET_NOT_RESOLVED',
      `Ticket "${id}" cannot be deleted because it is not resolved.`
    );
  }
  if (!deleteResolvedTicketRecord(id)) {
    throw new TicketDeletionError(
      'TICKET_DELETE_CONFLICT',
      `Ticket "${id}" changed before it could be deleted.`
    );
  }

  const historyPath = join(config.historyDir, `${id}.json`);
  let historyDeleted = false;
  if (existsSync(historyPath)) {
    try {
      unlinkSync(historyPath);
      historyDeleted = true;
    } catch (error) {
      logger.warn(`Deleted ticket ${id}, but could not remove its history file: ${error.message}`, 'TicketDeletion');
    }
  }

  return { deleted: true, ticket_id: id, history_deleted: historyDeleted };
}
