import { describe, it, expect } from 'vitest';
import { handler, schema } from '../idle.js';

describe('Idle Tool', () => {
  it('should define the correct OpenAI tool schema', () => {
    expect(schema.type).toBe('function');
    expect(schema.function.name).toBe('idle');
    expect(schema.function.description).toContain('Enter idle state');
  });

  it('should return idling status message on execution', async () => {
    const sessionContext = { ticketId: 'T-1001' };
    const result = await handler({}, sessionContext);
    expect(result).toContain('Agent idling');
    expect(result).toContain('All tasks completed');
  });
});
