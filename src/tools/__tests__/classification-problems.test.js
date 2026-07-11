import { beforeEach, describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';
process.env.INCIDENT_DB_PATH = ':memory:';

import { getDb, getTicket, initDb, insertTicket } from '../../database/sqlite.js';
import { handler as classifyTicket } from '../classify_ticket.js';
import { handler as compareSameTypeTickets } from '../compare_same_type_tickets.js';
import { getIncidentDb } from '../../../services/incident/db.js';

describe('classify_ticket problem clustering', () => {
  beforeEach(() => {
    const db = initDb();
    db.prepare('DELETE FROM problem_tickets').run();
    db.prepare('DELETE FROM problems').run();
    db.prepare('DELETE FROM tickets').run();
    getIncidentDb().prepare('DELETE FROM incidents').run();
  });

  it('creates an open problem and adds same-type matching reports to its pile', async () => {
    insertTicket({ id: 'T-ONE', description: 'Game crashes when I start a match.', status: 'pending' });
    insertTicket({ id: 'T-TWO', description: 'GAME crashes when I start a match!!!', status: 'pending' });

    const first = JSON.parse(await classifyTicket({
      categories: ['bug'],
      severity: 'high',
      rationale: 'Match-start crash.',
      problem_summary: 'Game crashes when starting a match',
      problem_reason: 'Starting a match with ultra graphics enabled'
    }, { ticketId: 'T-ONE' }));
    const second = JSON.parse(await classifyTicket({
      categories: ['bug'],
      severity: 'high',
      rationale: 'Same crash report.',
      problem_summary: 'Game crashes when starting a match',
      problem_reason: 'Starting a match with ultra graphics enabled'
    }, { ticketId: 'T-TWO' }));

    expect(first.problem_action).toBe('created_problem');
    expect(second.problem_action).toBe('added_to_pile');
    expect(second.problem.id).toBe(first.problem.id);
    expect(getTicket('T-TWO').categories).toEqual(['bug']);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM problem_tickets').get().count).toBe(2);
  });

  it('lets the agent compare a ticket against exact same-type clusters before classifying it', async () => {
    insertTicket({ id: 'T-OLD', description: 'Game crashes with ultra graphics.', status: 'pending' });
    insertTicket({ id: 'T-NEW', description: 'My game crashes when ultra graphics is enabled.', status: 'pending' });

    await classifyTicket({
      categories: ['bug'],
      severity: 'high',
      rationale: 'Crash tied to graphics setting.',
      problem_summary: 'Game crashes when starting a match',
      problem_reason: 'Ultra graphics setting is enabled'
    }, { ticketId: 'T-OLD' });

    const result = await compareSameTypeTickets({
      category: 'bug',
      problem_summary: 'Game crashes when starting a match',
      problem_reason: 'Ultra graphics setting is enabled'
    }, { ticketId: 'T-NEW' });

    expect(result.exact_match).toMatchObject({
      category: 'bug',
      problem_summary: 'Game crashes when starting a match',
      problem_reason: 'Ultra graphics setting is enabled',
      ticket_count: 1
    });
    expect(result.exact_match.tickets.map((ticket) => ticket.id)).toEqual(['T-OLD']);
  });

  it('keeps same-symptom tickets separate when the reason is different', async () => {
    insertTicket({ id: 'T-GFX', description: 'Game crashes when I start a match with ultra graphics.', status: 'pending' });
    insertTicket({ id: 'T-CONTROLLER', description: 'Game crashes when I start a match using a controller.', status: 'pending' });

    const first = JSON.parse(await classifyTicket({
      categories: ['bug'],
      severity: 'high',
      rationale: 'Crash tied to graphics setting.',
      problem_summary: 'Game crashes when starting a match',
      problem_reason: 'Ultra graphics setting is enabled'
    }, { ticketId: 'T-GFX' }));
    const second = JSON.parse(await classifyTicket({
      categories: ['bug'],
      severity: 'high',
      rationale: 'Crash tied to controller input.',
      problem_summary: 'Game crashes when starting a match',
      problem_reason: 'Controller is connected'
    }, { ticketId: 'T-CONTROLLER' }));

    expect(first.problem.id).not.toBe(second.problem.id);
    expect(second.problem_action).toBe('created_problem');
  });

  it('promotes a high-severity repeated problem to an incident after five close tickets', async () => {
    const created_at = '2026-07-12T10:00:00.000Z';
    for (let index = 1; index <= 5; index += 1) {
      insertTicket({
        id: `T-CRASH-${index}`,
        description: `Crash ${index}`,
        status: 'pending',
        created_at,
        platform: 'PC',
        region: 'NA'
      });
    }

    let latest;
    for (let index = 1; index <= 5; index += 1) {
      latest = JSON.parse(await classifyTicket({
        categories: ['bug'],
        severity: 'high',
        rationale: 'Crash from ultra graphics.',
        problem_summary: 'Game crashes when starting a match',
        problem_reason: 'Ultra graphics setting is enabled'
      }, { ticketId: `T-CRASH-${index}` }));
    }

    expect(latest.incident).toMatchObject({
      promoted: true,
      ticket_count: 5,
      required_ticket_count: 5
    });
    expect(latest.incident.incident.summary).toContain('Reason/scenario: Ultra graphics setting is enabled.');
    expect(latest.incident.metadata.platform_counts).toEqual([{ value: 'PC', count: 5 }]);
  });

  it('promotes based on ticket count even when matching reports are more than one day apart', async () => {
    const createdTimes = [
      '2026-07-12T10:00:00.000Z',
      '2026-07-12T20:00:00.000Z',
      '2026-07-13T06:00:00.000Z',
      '2026-07-13T16:00:00.000Z',
      '2026-07-14T08:00:00.000Z'
    ];
    for (let index = 0; index < createdTimes.length; index += 1) {
      insertTicket({
        id: `T-SPAN-${index + 1}`,
        description: `Astra cannot move ${index + 1}`,
        status: 'pending',
        created_at: createdTimes[index],
        platform: index < 4 ? 'PC' : 'Console',
        region: 'NA'
      });
    }

    let latest;
    for (let index = 0; index < createdTimes.length; index += 1) {
      latest = JSON.parse(await classifyTicket({
        categories: ['bug'],
        severity: 'high',
        rationale: 'Astra ultimate movement lock.',
        problem_summary: 'Astra cannot move after using ultimate',
        problem_reason: 'Astra ultimate activation causes movement lock'
      }, { ticketId: `T-SPAN-${index + 1}` }));
    }

    expect(latest.incident).toMatchObject({
      promoted: true,
      ticket_count: 5,
      stale_after_hours: 48
    });
    expect(latest.incident.metadata.platform_counts).toEqual([
      { value: 'PC', count: 4 },
      { value: 'Console', count: 1 }
    ]);
    expect(latest.incident.incident.summary).toContain('Metadata: 4/5 reports on PC; all reports in NA.');
  });

  it('does not promote stale clusters that only meet the count after more than two days', async () => {
    const createdTimes = [
      '2026-07-12T10:00:00.000Z',
      '2026-07-12T20:00:00.000Z',
      '2026-07-13T06:00:00.000Z',
      '2026-07-13T16:00:00.000Z',
      '2026-07-14T12:01:00.000Z'
    ];
    for (let index = 0; index < createdTimes.length; index += 1) {
      insertTicket({
        id: `T-STALE-${index + 1}`,
        description: `Astra cannot move stale ${index + 1}`,
        status: 'pending',
        created_at: createdTimes[index]
      });
    }

    let latest;
    for (let index = 0; index < createdTimes.length; index += 1) {
      latest = JSON.parse(await classifyTicket({
        categories: ['bug'],
        severity: 'high',
        rationale: 'Astra ultimate movement lock.',
        problem_summary: 'Astra cannot move after using ultimate',
        problem_reason: 'Astra ultimate activation causes movement lock'
      }, { ticketId: `T-STALE-${index + 1}` }));
    }

    expect(latest.incident).toMatchObject({
      promoted: false,
      reason: 'stale_ticket_cluster',
      ticket_count: 5,
      stale_after_hours: 48
    });
  });

  it('does not promote payment problems before ten matching tickets', async () => {
    for (let index = 1; index <= 5; index += 1) {
      insertTicket({
        id: `T-PAY-${index}`,
        description: `Payment ${index}`,
        status: 'pending',
        created_at: '2026-07-12T10:00:00.000Z'
      });
    }

    let latest;
    for (let index = 1; index <= 5; index += 1) {
      latest = JSON.parse(await classifyTicket({
        categories: ['payment'],
        severity: 'high',
        rationale: 'Payment receipt missing.',
        problem_summary: 'Purchased currency does not appear',
        problem_reason: 'Store receipt is delayed after payment confirmation'
      }, { ticketId: `T-PAY-${index}` }));
    }

    expect(latest.incident).toMatchObject({
      promoted: false,
      reason: 'below_threshold',
      ticket_count: 5,
      required_ticket_count: 10
    });
  });

  it('does not add a ticket to the same problem twice', async () => {
    insertTicket({ id: 'T-ONE', description: 'Login fails after update.', status: 'pending' });
    const args = {
      categories: ['account'],
      severity: 'medium',
      rationale: 'Login issue.',
      problem_summary: 'Login fails after update',
      problem_reason: 'Client was updated before logging in'
    };

    await classifyTicket(args, { ticketId: 'T-ONE' });
    const repeated = JSON.parse(await classifyTicket(args, { ticketId: 'T-ONE' }));

    expect(repeated.problem_action).toBe('already_linked');
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM problem_tickets').get().count).toBe(1);
  });
});
