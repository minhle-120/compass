// src/index.js
import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

import { config } from './config.js';
import { logger } from './utils/logger.js';
import { initDb, resetInterruptedTickets, getTicket, insertTicket, getDb } from './database/sqlite.js';
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

// API Endpoint to fetch status of a single ticket
app.get('/api/tickets/:id', (req, res) => {
  try {
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


// API Endpoint to submit a new ticket
app.post('/api/tickets', (req, res) => {
  try {
    const ticketData = req.body;
    if (!ticketData.id) {
      return res.status(400).json({ error: 'Ticket ID is required' });
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
