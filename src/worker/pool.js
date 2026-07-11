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
    this.activeWorkersMap = new Map(); // ticketId -> state
    this.timer = null;
    this.isChecking = false;
  }

  updateActiveWorkerState(ticketId, msg) {
    if (this.activeWorkersMap.has(ticketId)) {
      const state = this.activeWorkersMap.get(ticketId);
      state.step = msg.step;
      if (msg.toolName !== undefined) state.toolName = msg.toolName;
      if (msg.toolArgs !== undefined) state.toolArgs = msg.toolArgs;
      if (msg.tokenCount !== undefined) state.tokenCount = msg.tokenCount;
      if (msg.flags !== undefined) state.flags = msg.flags;
      this.activeWorkersMap.set(ticketId, state);
    }
  }

  getActiveStates() {
    return Array.from(this.activeWorkersMap.values());
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
        const ticket = getNextPendingTicket(Array.from(this.activeWorkersMap.keys()));
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
    if (this.activeWorkersMap.has(ticketId)) {
      logger.warn(`Worker already active for ticket ${ticketId}; skipping duplicate spawn.`, 'WorkerPool');
      return null;
    }
    logger.info(`Spawning worker for ticket ${ticketId}`, 'WorkerPool');
    
    // Mark as running in database before spawning to prevent other threads/polls from grabbing it
    updateTicketStatus(ticketId, 'running');

    // Register active worker state in the pool's tracker map
    this.activeWorkersMap.set(ticketId, {
      ticketId,
      startTime: new Date().toISOString(),
      step: 'spawned',
      toolName: null,
      toolArgs: null,
      tokenCount: 0,
      flags: {
        wasTicketRead: false,
        wasIncidentsChecked: false,
        wasClassified: false,
        wasResponseDrafted: false,
        wasRouted: false
      }
    });

    try {
      const worker = new Worker(workerScriptPath, {
        workerData: { ticketId }
      });

      this.activeWorkers.add(worker);

      // Inactivity watchdog: progress messages re-arm it, so healthy long-running
      // workflows are not killed merely for exceeding an absolute wall-clock budget.
      let watchdog;
      const armWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(async () => {
          logger.error(`Worker for ticket ${ticketId} made no progress for ${config.workerTimeoutMs}ms. Terminating thread.`, 'WorkerPool');
          try {
            await worker.terminate();
          } catch (termErr) {
            logger.error(`Failed to force terminate worker for ticket ${ticketId}`, 'WorkerPool', termErr);
          }
          updateTicketStatus(ticketId, 'failed', `Execution timeout: no worker progress for ${config.workerTimeoutMs}ms`);
          this.activeWorkers.delete(worker);
          this.activeWorkersMap.delete(ticketId);
          this.checkQueue();
        }, config.workerTimeoutMs);
      };
      armWatchdog();

      worker.on('message', (msg) => {
        armWatchdog();
        if (msg.type === 'log') {
          logger.info(`[Worker Log - ${ticketId}] ${msg.message}`, 'WorkerPool');
        } else if (msg.type === 'status_update') {
          logger.debug(`[Status Update - ${ticketId}] Status: ${msg.status}`, 'WorkerPool');
        } else if (msg.type === 'agent_activity') {
          this.updateActiveWorkerState(ticketId, msg);
        }
      });

      worker.on('error', (err) => {
        clearTimeout(watchdog);
        logger.error(`Error in worker for ticket ${ticketId}`, 'WorkerPool', err);
        updateTicketStatus(ticketId, 'failed', err.message || String(err));
        this.activeWorkersMap.delete(ticketId);
      });

      worker.on('exit', (code) => {
        clearTimeout(watchdog);
        if (this.activeWorkers.has(worker)) {
          this.activeWorkers.delete(worker);
          this.activeWorkersMap.delete(ticketId);
          logger.info(`Worker for ticket ${ticketId} exited with code ${code}. Active workers: ${this.activeWorkers.size}`, 'WorkerPool');
          // Immediately check queue when a slot opens up
          this.checkQueue();
        }
      });

    } catch (err) {
      logger.error(`Failed to instantiate worker for ticket ${ticketId}`, 'WorkerPool', err);
      updateTicketStatus(ticketId, 'failed', `Failed to spawn worker: ${err.message}`);
      this.activeWorkersMap.delete(ticketId);
    }
  }

}

export const pool = new WorkerPool();
