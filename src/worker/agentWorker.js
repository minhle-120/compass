// src/worker/agentWorker.js
import { parentPort, workerData } from 'worker_threads';
import { failRunningTicket, getTicket } from '../database/sqlite.js';
import { runAgentLoop } from '../agent/loop.js';
import { logger } from '../utils/logger.js';
import { errorMessage } from '../utils/errorMessage.js';

const { ticketId } = workerData;

if (!ticketId) {
  logger.error('No ticketId provided to worker thread', 'AgentWorker');
  process.exit(1);
}

async function start() {
  logger.info(`Agent worker thread started for ticket ${ticketId}`, `Ticket-${ticketId}`);
  
  // Track checklist progress locally in the worker thread memory
  const ticket = getTicket(ticketId);
  if (!ticket) throw new Error(`Ticket "${ticketId}" not found before worker startup.`);

  const sessionContext = {
    ticketId,
    workflowRevision: ticket.workflow_revision || 0,
    unknownWordChecks: {},
    flags: {
      wasTicketRead: false,
      wasClassified: false,
      wasResponseDrafted: false,
      wasIncidentsChecked: false,
      wasRouted: false
    }
  };

  try {
    const result = await runAgentLoop(sessionContext);
    
    // Notify parent of success if parentPort exists
    if (parentPort) {
      parentPort.postMessage({
        type: 'status_update',
        ticketId,
        status: result.status
      });
    }
    
    logger.info(`Agent worker thread completed execution for ticket ${ticketId} with status ${result.status}`, `Ticket-${ticketId}`);
  } catch (err) {
    logger.error(`Agent worker thread crashed for ticket ${ticketId}`, `Ticket-${ticketId}`, err);
    
    // Update ticket state in database to failed
    try {
      failRunningTicket(ticketId, errorMessage(err));
    } catch (dbErr) {
      logger.error('Failed to update ticket status to failed in database', `Ticket-${ticketId}`, dbErr);
    }
    
    // Rethrow to bubble error up to parentPort 'error' listener and terminate thread
    throw err;
  }
}


start();
