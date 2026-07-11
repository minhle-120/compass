import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set environment variable to run database in-memory for testing
process.env.DB_PATH = ':memory:';

// Mock worker_threads but retain original exports like isMainThread and threadId
vi.mock('worker_threads', async (importOriginal) => {
  const actual = await importOriginal();
  let activeInstance = null;

  class MockWorkerClass {
    constructor(scriptPath, options) {
      this.scriptPath = scriptPath;
      this.options = options;
      this.listeners = {};
      activeInstance = this;
    }

    on(event, callback) {
      this.listeners[event] = callback;
      return this;
    }

    trigger(event, data) {
      if (this.listeners[event]) {
        this.listeners[event](data);
      }
    }
  }

  return {
    ...actual,
    Worker: MockWorkerClass,
    _getMockInstance: () => activeInstance,
    _resetMockInstance: () => { activeInstance = null; }
  };
});

// Import the mock helpers from the mocked module
import { _getMockInstance, _resetMockInstance } from 'worker_threads';
import { initDb, insertTicket, getTicket, updateTicketStatus } from '../../database/sqlite.js';
import { pool } from '../pool.js';
import { config } from '../../config.js';

describe('WorkerPool Orchestrator', () => {
  beforeEach(() => {
    initDb();
    // Clear database state
    const db = initDb();
    db.prepare('DELETE FROM tickets').run();

    // Reset pool state
    pool.stop();
    pool.activeWorkers.clear();
    pool.isChecking = false;
    _resetMockInstance();

    vi.useFakeTimers();
  });

  afterEach(() => {
    pool.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should not spawn worker if there are no pending tickets', async () => {
    // No tickets in db
    await pool.checkQueue();

    expect(pool.activeWorkers.size).toBe(0);
    expect(_getMockInstance()).toBeNull();
  });

  it('should spawn worker when a pending ticket exists and mark it running', async () => {
    insertTicket({ id: 'T-POOL-1', status: 'pending', created_at: new Date().toISOString() });

    await pool.checkQueue();

    expect(pool.activeWorkers.size).toBe(1);
    const instance = _getMockInstance();
    expect(instance).not.toBeNull();
    expect(instance.options.workerData).toEqual({ ticketId: 'T-POOL-1' });

    // Ticket status should be updated to 'running'
    const fetched = getTicket('T-POOL-1');
    expect(fetched.status).toBe('running');
  });

  it('should respect concurrency cap and not spawn more than limit', async () => {
    const originalCap = config.concurrencyCap;
    config.concurrencyCap = 2;

    try {
      insertTicket({ id: 'T-1', status: 'pending', created_at: '2026-07-11T10:00:00Z' });
      insertTicket({ id: 'T-2', status: 'pending', created_at: '2026-07-11T10:01:00Z' });
      insertTicket({ id: 'T-3', status: 'pending', created_at: '2026-07-11T10:02:00Z' });

      await pool.checkQueue();

      // Only 2 workers should be running
      expect(pool.activeWorkers.size).toBe(2);

      expect(getTicket('T-1').status).toBe('running');
      expect(getTicket('T-2').status).toBe('running');
      expect(getTicket('T-3').status).toBe('pending');
    } finally {
      config.concurrencyCap = originalCap;
    }
  });

  it('should handle worker errors and mark ticket failed', async () => {
    insertTicket({ id: 'T-POOL-ERR', status: 'pending' });

    await pool.checkQueue();

    const worker = _getMockInstance();
    expect(worker).not.toBeNull();

    // Simulate worker crashing
    worker.trigger('error', new Error('Model connection failed'));
    worker.trigger('exit', 1);

    expect(pool.activeWorkers.size).toBe(0);
    const fetched = getTicket('T-POOL-ERR');
    expect(fetched.status).toBe('failed');
    expect(fetched.error_message).toBe('Model connection failed');
  });

  it('should poll database periodically when started', async () => {
    const checkSpy = vi.spyOn(pool, 'checkQueue');

    pool.start();

    // Advance time by 2 polling cycles
    await vi.advanceTimersByTimeAsync(config.pollIntervalMs * 2);

    // Initial check + 2 ticks = 3 calls
    expect(checkSpy).toHaveBeenCalledTimes(3);
  });

  it('should track and update active worker states in activeWorkersMap', async () => {
    insertTicket({ id: 'T-TRACK-1', status: 'pending' });

    await pool.checkQueue();

    // Verify entry is registered
    expect(pool.activeWorkersMap.has('T-TRACK-1')).toBe(true);
    const initial = pool.activeWorkersMap.get('T-TRACK-1');
    expect(initial.step).toBe('spawned');
    expect(initial.tokenCount).toBe(0);

    const worker = _getMockInstance();
    expect(worker).not.toBeNull();

    // Simulate sending agent_activity update from worker thread
    worker.trigger('message', {
      type: 'agent_activity',
      step: 'executing_tool:read_ticket',
      toolName: 'read_ticket',
      toolArgs: {},
      tokenCount: 150,
      flags: { wasTicketRead: true }
    });

    const updated = pool.activeWorkersMap.get('T-TRACK-1');
    expect(updated.step).toBe('executing_tool:read_ticket');
    expect(updated.toolName).toBe('read_ticket');
    expect(updated.tokenCount).toBe(150);
    expect(updated.flags.wasTicketRead).toBe(true);

    // Simulate exit and ensure the entry is deleted
    worker.trigger('exit', 0);
    expect(pool.activeWorkersMap.has('T-TRACK-1')).toBe(false);
  });
});

