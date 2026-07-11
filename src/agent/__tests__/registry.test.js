import { describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';

const { executeTool, getOpenAITools } = await import('../registry.js');
const { getDb, insertTicket } = await import('../../database/sqlite.js');

function createSessionContext() {
  return {
    ticketId: 'T-REGISTRY',
    flags: {
      wasTicketRead: false,
      wasClassified: false,
      wasResponseDrafted: false,
      wasIncidentsChecked: false,
      wasKnowledgeBaseChecked: false,
      wasRouted: false
    }
  };
}

describe('tool registry outcomes', () => {
  it('loads every tool with a unique schema', () => {
    const names = getOpenAITools().map((tool) => tool.function.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('idle');
    expect(names).toContain('read_ticket');
  });

  it('does not mark a workflow step complete when its handler fails', async () => {
    const context = createSessionContext();
    const result = await executeTool('get_incident_details', {}, context);

    expect(result).toMatchObject({
      ok: false,
      terminal: false,
      error: { code: 'INVALID_ARGUMENT' }
    });
    expect(context.flags.wasIncidentsChecked).toBe(false);
  });

  it('marks a workflow step complete only after a successful handler', async () => {
    getDb().prepare('DELETE FROM tickets').run();
    insertTicket({ id: 'T-REGISTRY', subject: 'Help', description: 'Details' });
    const context = createSessionContext();

    const result = await executeTool('read_ticket', {}, context);

    expect(result.ok).toBe(true);
    expect(result.terminal).toBe(false);
    expect(context.flags.wasTicketRead).toBe(true);
  });

  it('returns a structured non-terminal result when idle validation fails', async () => {
    const context = createSessionContext();
    const result = await executeTool('idle', {
      resolution_type: 'resolved',
      reason: 'Done'
    }, context);

    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(false);
    expect(result.error.code).toBe('WORKFLOW_INCOMPLETE');
    expect(result.missingSteps).toContain('read_ticket');
  });

  it('returns a structured terminal result when idle validation succeeds', async () => {
    const context = createSessionContext();
    context.flags.wasTicketRead = true;

    const result = await executeTool('idle', {
      resolution_type: 'rejected',
      reason: 'Spam'
    }, context);

    expect(result).toMatchObject({ ok: true, terminal: true });
    expect(context.resolutionType).toBe('rejected');
    expect(context.resolutionReason).toBe('Spam');
  });

  it('rejects non-object arguments without invoking a handler', async () => {
    const context = createSessionContext();
    const result = await executeTool('idle', null, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(context.resolutionType).toBeUndefined();
  });

  it('rejects unknown tool names', async () => {
    await expect(executeTool('missing_tool', {}, createSessionContext()))
      .rejects.toThrow('is not registered');
  });
});
