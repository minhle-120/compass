// src/index.js
import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';

import { config } from './config.js';
import { logger } from './utils/logger.js';
import { isValidTicketId } from './utils/ticketId.js';
import { normalizeAttachments, normalizeTicketSubmission } from './utils/ticketSubmission.js';
import { presentTicket } from './utils/ticketPresentation.js';
import { initDb, resetInterruptedTickets, getTicket, insertTicket, getDb, getQueueStats, appendTicketMessage, publishDraftResponse, closeTicketByUser, getIncidentTicketSummary } from './database/sqlite.js';
import { deleteResolvedTicket, TicketDeletionError } from './services/ticketDeletion.js';
import { pool } from './worker/pool.js';
import { listUnresolvedIncidents } from '../services/incident/incidentService.js';
import {
  WikiValidationError,
  createWikiEntry,
  deleteWikiEntry,
  getWikiEntry,
  getWikiStats,
  listUnknownWords,
  initWikiDb,
  listWikiEntries,
  updateUnknownWordStatus,
  updateWikiEntry
} from '../services/wiki/wikiService.js';
import { startWikiSync } from '../services/wiki/sync.js';
import {
  SlangValidationError,
  createLocalSlangEntry,
  deleteLocalSlangEntry,
  getLocalSlangEntry,
  getSlangStats,
  initSlangDb,
  listLocalSlangEntries,
  updateLocalSlangEntry
} from '../services/slang/slangService.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Initialize DB schema and reset interrupted tickets
initDb();
resetInterruptedTickets();
initWikiDb();
initSlangDb();
startWikiSync();

// Start worker thread pool
pool.start();

const app = express();
app.use(express.json({ limit: '30mb' }));

// Serve static assets from public folder
app.use(express.static(join(__dirname, '../public')));

app.get('/wiki', (req, res) => {
  res.sendFile(join(__dirname, '../public/wiki.html'));
});

app.get('/slang', (req, res) => {
  res.sendFile(join(__dirname, '../public/slang.html'));
});

app.get('/flags', (req, res) => {
  res.sendFile(join(__dirname, '../public/flags.html'));
});

app.get('/api/wiki', (req, res) => {
  try {
    res.json(listWikiEntries({
      query: req.query.query || '',
      category: req.query.category || '',
      limit: req.query.limit,
      offset: req.query.offset
    }));
  } catch (error) {
    sendWikiError(res, error, 'list wiki entries');
  }
});

app.get('/api/wiki/stats', (req, res) => {
  try {
    res.json(getWikiStats());
  } catch (error) {
    sendWikiError(res, error, 'retrieve wiki statistics');
  }
});

app.get('/api/wiki/flags', (req, res) => {
  try {
    res.json(listUnknownWords({
      query: req.query.query || '',
      status: req.query.status || 'open',
      limit: req.query.limit,
      offset: req.query.offset
    }));
  } catch (error) {
    sendWikiError(res, error, 'list flagged words');
  }
});

app.patch('/api/wiki/flags/:id', (req, res) => {
  try {
    const entry = updateUnknownWordStatus(req.params.id, req.body?.status);
    if (!entry) return res.status(404).json({ error: 'Flagged word not found.' });
    res.json(entry);
  } catch (error) {
    sendWikiError(res, error, 'update flagged word');
  }
});

app.get('/api/wiki/:id', (req, res) => {
  try {
    const entry = getWikiEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Wiki entry not found.' });
    res.json(entry);
  } catch (error) {
    sendWikiError(res, error, 'retrieve wiki entry');
  }
});

app.post('/api/wiki', (req, res) => {
  try {
    res.status(201).json(createWikiEntry(req.body));
  } catch (error) {
    sendWikiError(res, error, 'create wiki entry');
  }
});

app.put('/api/wiki/:id', (req, res) => {
  try {
    const entry = updateWikiEntry(req.params.id, req.body);
    if (!entry) return res.status(404).json({ error: 'Wiki entry not found.' });
    res.json(entry);
  } catch (error) {
    sendWikiError(res, error, 'update wiki entry');
  }
});

app.delete('/api/wiki/:id', (req, res) => {
  try {
    if (!deleteWikiEntry(req.params.id)) {
      return res.status(404).json({ error: 'Wiki entry not found.' });
    }
    res.status(204).end();
  } catch (error) {
    sendWikiError(res, error, 'delete wiki entry');
  }
});

app.get('/api/slang', (req, res) => {
  try {
    res.json(listLocalSlangEntries({
      query: req.query.query || '',
      category: req.query.category || '',
      limit: req.query.limit,
      offset: req.query.offset
    }));
  } catch (error) {
    sendSlangError(res, error, 'list slang entries');
  }
});

app.get('/api/slang/stats', (req, res) => {
  try {
    res.json(getSlangStats());
  } catch (error) {
    sendSlangError(res, error, 'retrieve slang statistics');
  }
});

app.get('/api/slang/:id', (req, res) => {
  try {
    const entry = getLocalSlangEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Slang entry not found.' });
    res.json(entry);
  } catch (error) {
    sendSlangError(res, error, 'retrieve slang entry');
  }
});

app.post('/api/slang', (req, res) => {
  try {
    res.status(201).json(createLocalSlangEntry(req.body));
  } catch (error) {
    sendSlangError(res, error, 'create slang entry');
  }
});

app.put('/api/slang/:id', (req, res) => {
  try {
    const entry = updateLocalSlangEntry(req.params.id, req.body);
    if (!entry) return res.status(404).json({ error: 'Slang entry not found.' });
    res.json(entry);
  } catch (error) {
    sendSlangError(res, error, 'update slang entry');
  }
});

app.delete('/api/slang/:id', (req, res) => {
  try {
    if (!deleteLocalSlangEntry(req.params.id)) {
      return res.status(404).json({ error: 'Slang entry not found.' });
    }
    res.status(204).end();
  } catch (error) {
    sendSlangError(res, error, 'delete slang entry');
  }
});

// API Endpoint to fetch status of all tickets
app.get('/api/tickets', (req, res) => {
  try {
    const database = getDb();
    const rows = database.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all();
    
    // Parse JSON fields for client convenience
    const tickets = rows.map(ticket => {
      const copy = { ...ticket };
      if (copy.attachments) {
        try {
          copy.attachments = JSON.parse(copy.attachments).map(({ name, type, size }) => ({ name, type, size }));
        } catch (e) {}
      }
      if (copy.conversation) {
        try { copy.conversation = JSON.parse(copy.conversation); } catch (e) {}
      }
      if (copy.categories) {
        try { copy.categories = JSON.parse(copy.categories); } catch (e) {}
      }
      return presentTicket(copy);
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

app.get('/api/incidents/open', (req, res) => {
  try {
    const incidents = listUnresolvedIncidents({ limit: req.query.limit });
    const ticketSummary = getIncidentTicketSummary(incidents.map((incident) => incident.id));
    res.json(incidents.map((incident) => ({
      ...incident,
      ticket_count: ticketSummary[incident.id]?.ticket_count || 0,
      ticket_ids: ticketSummary[incident.id]?.ticket_ids || []
    })));
  } catch (err) {
    logger.error('Failed to retrieve open incidents', 'ExpressAPI', err);
    res.status(500).json({ error: 'Failed to retrieve open incidents' });
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
    res.json(presentTicket(ticket, { staff: req.query.staff === 'true' }));
  } catch (err) {
    logger.error(`Failed to retrieve ticket ${req.params.id}`, 'ExpressAPI', err);
    res.status(500).json({ error: 'Failed to retrieve ticket' });
  }
});

app.delete('/api/tickets/:id', (req, res) => {
  try {
    const result = deleteResolvedTicket(req.params.id);
    logger.info(`Permanently deleted resolved ticket ${req.params.id}`, 'ExpressAPI');
    return res.json(result);
  } catch (err) {
    if (err instanceof TypeError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof TicketDeletionError) {
      const status = err.code === 'TICKET_NOT_FOUND' ? 404 : 409;
      return res.status(status).json({ error: err.message, code: err.code });
    }
    logger.error(`Failed to delete ticket ${req.params.id}`, 'ExpressAPI', err);
    return res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

// Player action to close an open ticket without deleting its history.
app.post('/api/tickets/:id/close', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidTicketId(id)) return res.status(400).json({ error: 'Invalid ticket ID' });
    if (!getTicket(id)) return res.status(404).json({ error: 'Ticket not found' });

    await pool.cancelTicket(id);
    const closed = closeTicketByUser(id);
    if (!closed) return res.status(409).json({ error: 'This ticket is already closed.' });

    logger.info(`Ticket ${id} was closed by the player`, 'ExpressAPI');
    return res.json({ message: 'Ticket closed successfully', ticketId: id });
  } catch (err) {
    logger.error(`Failed to close ticket ${req.params.id}`, 'ExpressAPI', err);
    return res.status(500).json({ error: 'Failed to close ticket' });
  }
});

// Staff action to approve and publish a pending AI draft.
app.post('/api/tickets/:id/draft/approve', (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidTicketId(id)) return res.status(400).json({ error: 'Invalid ticket ID' });
    if (!getTicket(id)) return res.status(404).json({ error: 'Ticket not found' });

    const result = publishDraftResponse(id);
    if (!result.published) return res.status(409).json({ error: result.reason });
    return res.json({ message: 'Draft response published', ticketId: id });
  } catch (err) {
    logger.error(`Failed to approve draft for ticket ${req.params.id}`, 'ExpressAPI', err);
    return res.status(500).json({ error: 'Failed to approve draft response' });
  }
});

// API Endpoint to fetch raw conversation history trace from disk
app.get('/api/tickets/:id/history', (req, res) => {
  try {
    if (!isValidTicketId(req.params.id)) return res.status(400).json({ error: 'Invalid ticket ID' });
    if (!getTicket(req.params.id)) return res.status(404).json({ error: 'Ticket not found' });
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
    const { sender, message } = req.body || {};
    const attachments = normalizeAttachments(req.body?.attachments);
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';

    // Validate inputs
    if (!normalizedMessage && attachments.length === 0) {
      return res.status(400).json({ error: 'A message or at least one attachment is required' });
    }
    if (sender && (typeof sender !== 'string' || !sender.trim())) {
      return res.status(400).json({ error: 'Sender must be a valid string if provided' });
    }


    if (!isValidTicketId(id)) return res.status(400).json({ error: 'Invalid ticket ID' });

    const ticket = getTicket(id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    const acceptsReplies = ['pending', 'running', 'escalated'].includes(ticket.status)
      || (ticket.status === 'completed' && (
        ticket.resolution_type === 'needs_clarification'
        || ticket.draft_status === 'pending_review'
      ));
    if (!acceptsReplies) {
      return res.status(409).json({ error: 'This ticket is closed and cannot receive new replies.' });
    }

    appendTicketMessage(
      id,
      sender || 'player',
      normalizedMessage || 'Added attachment(s).',
      attachments
    );

    logger.info(`Received player reply for ticket ${id}. Resetting status to pending.`, 'ExpressAPI');

    // Trigger queue check in worker pool
    pool.checkQueue();

    res.json({ message: 'Reply added successfully', ticketId: id });
  } catch (err) {
    if (err instanceof TypeError) {
      return res.status(400).json({ error: err.message });
    }
    logger.error(`Failed to process player reply for ticket ${req.params.id}`, 'ExpressAPI', err);
    res.status(500).json({ error: 'Failed to process player reply' });
  }
});



// API Endpoint to submit a new ticket
app.post('/api/tickets', (req, res) => {
  try {
    const ticketData = normalizeTicketSubmission(req.body);
    insertTicket(ticketData);
    logger.info(`Queued ticket ${ticketData.id} via API`, 'ExpressAPI');
    
    // Notify pool to check the queue immediately
    pool.checkQueue();

    res.status(201).json({ message: 'Ticket queued successfully', ticketId: ticketData.id });
  } catch (err) {
    if (err instanceof TypeError) {
      return res.status(400).json({ error: err.message });
    }
    logger.error('Failed to insert and queue new ticket', 'ExpressAPI', err);
    res.status(500).json({ error: 'Failed to queue ticket' });
  }
});

function sendWikiError(res, error, action) {
  if (error instanceof WikiValidationError) {
    return res.status(400).json({ error: error.message });
  }
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'A wiki entry with that term already exists.' });
  }

  logger.error(`Failed to ${action}`, 'WikiAPI', error);
  return res.status(500).json({ error: `Failed to ${action}.` });
}

function sendSlangError(res, error, action) {
  if (error instanceof SlangValidationError) {
    return res.status(400).json({ error: error.message });
  }
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'A slang entry with that term already exists.' });
  }

  logger.error(`Failed to ${action}`, 'SlangAPI', error);
  return res.status(500).json({ error: `Failed to ${action}.` });
}


// Start Express server
const port = config.port;
app.listen(port, () => {
  logger.info(`Express web server running on port ${port}`);
});
