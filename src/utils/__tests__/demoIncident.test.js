import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildDemoIncidentTickets,
  demoIncidentClassification,
  demoIncidentInputs,
  demoIncidentScenarios,
  getDemoIncidentScenario
} from '../demoIncident.js';

process.env.DB_PATH = ':memory:';
process.env.INCIDENT_DB_PATH = ':memory:';

const { getDb, initDb, insertTicket } = await import('../../database/sqlite.js');
const { getIncidentDb } = await import('../../../services/incident/db.js');
const { handler: classifyTicket } = await import('../../tools/classify_ticket.js');

describe('incident demo ticket batch', () => {
  beforeEach(() => {
    const database = initDb();
    database.prepare('DELETE FROM problem_tickets').run();
    database.prepare('DELETE FROM problems').run();
    database.prepare('DELETE FROM tickets').run();
    getIncidentDb().prepare('DELETE FROM incidents').run();
  });

  it('creates five unique realistic tickets with one exact timestamp', () => {
    const createdAt = '2026-07-12T12:34:56.789Z';
    const tickets = buildDemoIncidentTickets({ createdAt, batchId: 'TEST' });

    expect(tickets).toHaveLength(5);
    expect(demoIncidentInputs).toHaveLength(5);
    expect(new Set(tickets.map((ticket) => ticket.id)).size).toBe(5);
    expect(new Set(tickets.map((ticket) => ticket.subject)).size).toBe(5);
    expect(new Set(tickets.map((ticket) => ticket.description)).size).toBe(5);
    expect(new Set(tickets.map((ticket) => ticket.created_at))).toEqual(new Set([createdAt]));
    expect(tickets.every((ticket) => ticket.platform === 'PS5' && ticket.region === 'NA')).toBe(true);
  });

  it('uses one canonical high-severity classification so three reports meet the incident threshold', () => {
    expect(demoIncidentClassification).toMatchObject({
      categories: ['bug'],
      severity: 'high',
      problem_summary: 'PS5 display turns black when gameplay begins'
    });
  });

  it('rotates to a different problem for each new demo batch', () => {
    expect(demoIncidentScenarios).toHaveLength(4);
    expect([0, 1, 2, 3].map((index) => getDemoIncidentScenario(index).key)).toEqual([
      'ps5-black-screen',
      'xbox-voice-drop',
      'payment-receipt-freeze',
      'vanguard-restart-loop'
    ]);
    expect(getDemoIncidentScenario(4).key).toBe('ps5-black-screen');
  });

  it('actually clusters consecutive batches into separate incidents', async () => {
    for (let batchNumber = 0; batchNumber < 2; batchNumber += 1) {
      const scenario = getDemoIncidentScenario(batchNumber);
      const tickets = buildDemoIncidentTickets({
        createdAt: `2026-07-12T12:34:5${batchNumber}.789Z`,
        batchId: `SPAWN-${batchNumber}`,
        scenario
      });
      for (const ticket of tickets) insertTicket(ticket);
      for (const ticket of tickets) {
        await classifyTicket(scenario.classification, { ticketId: ticket.id });
      }
    }

    const incidents = getIncidentDb().prepare(`
      SELECT id, title, severity FROM incidents WHERE id LIKE 'INC-AUTO-%'
    `).all();
    const storedTickets = getDb().prepare(`
      SELECT id, created_at FROM tickets ORDER BY id
    `).all();

    expect(incidents).toHaveLength(2);
    expect(incidents.map((incident) => incident.title)).toEqual(expect.arrayContaining([
      'PS5 Display Turns Black When Gameplay Begins',
      'Xbox Voice Chat Disconnects During A Match'
    ]));
    expect(storedTickets).toHaveLength(10);
    expect(new Set(storedTickets.map((ticket) => ticket.created_at)).size).toBe(2);
  });
});
