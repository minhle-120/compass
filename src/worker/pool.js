// src/worker/pool.js
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getNextPendingTicket, updateTicketStatus } from '../database/sqlite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workerScriptPath = join(__dirname, 'agentWorker.js');

class WorkerPool {
  constructor() {
    this.activeWorkers = new Set();
    this.timer = null;
    this.isChecking = false;
  }

  /**
   * Start polling the SQLite database for pending tickets.
   */
  start() {
    if (this.timer) return;
    logger.info(`Starting Worker Pool with concurrency cap of ${config.concurrencyCap} and poll interval of ${config.pollIntervalMs}ms`);
    
    // Initial check
    this.checkQueue();
    
    // Set up polling interval
    this.timer = setInterval(() => {
      this.checkQueue();
    }, config.pollIntervalMs);
  }

  /**
   * Stop polling.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Polls database and spawns workers for pending tickets up to concurrency capacity.
   */
  async checkQueue() {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      while (this.activeWorkers.size < config.concurrencyCap) {
        const ticket = getNextPendingTicket();
        if (!ticket) {
          break; // No more pending tickets
        }

        this.spawnWorker(ticket.id);
      }
    } catch (err) {
      logger.error('Error during queue check', 'WorkerPool', err);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Spawns a new worker thread for a given ticket ID.
   */
  spawnWorker(ticketId) {
    logger.info(`Spawning worker for ticket ${ticketId}`, 'WorkerPool');
    
    // Mark as running in database before spawning to prevent other threads/polls from grabbing it
    updateTicketStatus(ticketId, 'running');

    try {
      const worker = new Worker(workerScriptPath, {
        workerData: { ticketId }
      });

      this.activeWorkers.add(worker);

      worker.on('message', (msg) => {
        // Handle custom messages from the agent worker thread if needed
        if (msg.type === 'log') {
          logger.info(`[Worker Log - ${ticketId}] ${msg.message}`, 'WorkerPool');
        } else if (msg.type === 'status_update') {
          logger.debug(`[Status Update - ${ticketId}] Status: ${msg.status}`, 'WorkerPool');
        }
      });

      worker.on('error', (err) => {
        logger.error(`Error in worker for ticket ${ticketId}`, 'WorkerPool', err);
        updateTicketStatus(ticketId, 'failed', err.message || String(err));
      });

      worker.on('exit', (code) => {
        this.activeWorkers.delete(worker);
        logger.info(`Worker for ticket ${ticketId} exited with code ${code}. Active workers: ${this.activeWorkers.size}`, 'WorkerPool');
        
        // Immediately check queue when a slot opens up
        this.checkQueue();
      });

    } catch (err) {
      logger.error(`Failed to instantiate worker for ticket ${ticketId}`, 'WorkerPool', err);
      updateTicketStatus(ticketId, 'failed', `Failed to spawn worker: ${err.message}`);
    }
  }
}

export const pool = new WorkerPool();
