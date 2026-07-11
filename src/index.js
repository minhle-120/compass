// src/index.js
import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

import { config } from './config.js';
import { logger } from './utils/logger.js';
import { isValidTicketId } from './utils/ticketId.js';
import { initDb, resetInterruptedTickets, getTicket, insertTicket, getDb, getQueueStats, appendTicketMessage } from './database/sqlite.js';
import { pool } from './worker/pool.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Initialize DB schema and reset interrupted tickets
initDb();
resetInterruptedTickets();

// Start worker thread pool
pool.start();

const app = express();
app.use(express.json());

// Serve static assets from public folder
app.use(express.static(join(__dirname, '../public')));

// API Endpoint to fetch status of all tickets
app.get('/api/tickets', (req, res) => {
  try {
    const database = getDb();
    const rows = database.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all();
    
    // Parse JSON fields for client convenience
    const tickets = rows.map(ticket => {
      const copy = { ...ticket };
      if (copy.attachments) {
        try { copy.attachments = JSON.parse(copy.attachments); } catch (e) {}
      }
      if (copy.conversation) {
        try { copy.conversation = JSON.parse(copy.conversation); } catch (e) {}
      }
      if (copy.categories) {
        try { copy.categories = JSON.parse(copy.categories); } catch (e) {}
      }
      return copy;
    });

    res.json(tickets);
  } catch (err) {
    logger.error('Failed to retrieve tickets from database', 'ExpressAPI', err);
    res.status(500).json({ error: 'Failed to retrieve tickets' });
  }
});

// API Endpoint to fetch the system management layer and active worker status
app.get('/api/system/status', (req, res) => {
  try {
    const queueStats = getQueueStats();
    const activeStates = pool.getActiveStates();

    res.json({
      management: {
        concurrencyCap: config.concurrencyCap,
        activeWorkersCount: activeStates.length,
        llmProvider: config.llmProvider,
        pollIntervalMs: config.pollIntervalMs,
        queue: queueStats
      },
      activeAgents: activeStates
    });
  } catch (err) {
    logger.error('Failed to retrieve system status', 'ExpressAPI', err);
    res.status(500).json({ error: 'Failed to retrieve system status' });
  }
});

// API Endpoint to fetch status of a single ticket
app.get('/api/tickets/:id', (req, res) => {
  try {
    if (!isValidTicketId(req.params.id)) return res.status(400).json({ error: 'Invalid ticket ID' });
    const ticket = getTicket(req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(ticket);
  } catch (err) {
    logger.error(`Failed to retrieve ticket ${req.params.id}`, 'ExpressAPI', err);
    res.status(500).json({ error: 'Failed to retrieve ticket' });
  }
});

// API Endpoint to fetch raw conversation history trace from disk
app.get('/api/tickets/:id/history', (req, res) => {
  try {
    if (!isValidTicketId(req.params.id)) return res.status(400).json({ error: 'Invalid ticket ID' });
    const historyPath = join(config.historyDir, `${req.params.id}.json`);
    if (!existsSync(historyPath)) {
      return res.status(404).json({ error: 'History not found' });
    }
    const raw = readFileSync(historyPath, 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    logger.error(`Failed to retrieve history for ticket ${req.params.id}`, 'ExpressAPI', err);
    res.status(500).json({ error: 'Failed to retrieve history' });
  }
});

// API Endpoint to post a new player reply to an existing ticket
app.post('/api/tickets/:id/messages', (req, res) => {
  try {
    const { id } = req.params;
    const { sender, message } = req.body;

    // Validate inputs
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'A valid string message content is required' });
    }
    if (sender && (typeof sender !== 'string' || !sender.trim())) {
      return res.status(400).json({ error: 'Sender must be a valid string if provided' });
    }


    if (!isValidTicketId(id)) return res.status(400).json({ error: 'Invalid ticket ID' });

    const ticket = getTicket(id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    appendTicketMessage(id, sender || 'player', message.trim());

    logger.info(`Received player reply for ticket ${id}. Resetting status to pending.`, 'ExpressAPI');

    // Trigger queue check in worker pool
    pool.checkQueue();

    res.json({ message: 'Reply added successfully', ticketId: id });
  } catch (err) {
    logger.error(`Failed to process player reply for ticket ${req.params.id}`, 'ExpressAPI', err);
    res.status(500).json({ error: 'Failed to process player reply' });
  }
});



// API Endpoint to submit a new ticket
app.post('/api/tickets', (req, res) => {
  try {
    const ticketData = req.body;
    
    // Auto-generate ticket ID if not provided
    if (!ticketData.id || typeof ticketData.id !== 'string' || !ticketData.id.trim()) {
      ticketData.id = `T-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    if (!isValidTicketId(ticketData.id)) {
      return res.status(400).json({ error: 'Ticket ID may contain only letters, numbers, underscores, and hyphens' });
    }
    if (!ticketData.subject || typeof ticketData.subject !== 'string' || !ticketData.subject.trim()) {
      return res.status(400).json({ error: 'A valid string Ticket Subject is required' });
    }
    if (!ticketData.description || typeof ticketData.description !== 'string' || !ticketData.description.trim()) {
      return res.status(400).json({ error: 'A valid string Ticket Description is required' });
    }

    // Default status is pending
    ticketData.status = 'pending';
    
    insertTicket(ticketData);
    logger.info(`Queued ticket ${ticketData.id} via API`, 'ExpressAPI');
    
    // Notify pool to check the queue immediately
    pool.checkQueue();

    res.status(201).json({ message: 'Ticket queued successfully', ticketId: ticketData.id });
  } catch (err) {
    logger.error('Failed to insert and queue new ticket', 'ExpressAPI', err);
    res.status(500).json({ error: 'Failed to queue ticket' });
  }
});


// Start Express server
const port = config.port;
app.listen(port, () => {
  logger.info(`Express web server running on port ${port}`);
});
