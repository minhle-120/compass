import { describe, expect, it } from 'vitest';
import { formatHumanHistory, formatRawHistory } from '../../../public/js/historyFormatter.js';

describe('agent history formatting', () => {
  const history = [
    { role: 'system', content: 'Very long internal prompt' },
    { role: 'user', content: 'A new ticket is assigned.' },
    {
      role: 'assistant',
      tool_calls: [{
        id: 'call-1',
        function: { name: 'read_ticket', arguments: '{}' }
      }]
    },
    {
      role: 'tool',
      name: 'read_ticket',
      content: JSON.stringify({ ok: true, terminal: false, output: { subject: 'Login' } })
    }
  ];

  it('formats agent activity into friendly transcript entries', () => {
    expect(formatHumanHistory(history)).toEqual([
      { role: 'system', label: 'System', content: 'Agent instructions loaded.' },
      { role: 'user', label: 'Assignment', content: 'A new ticket is assigned.' },
      { role: 'assistant', label: 'Agent action', content: 'Called read ticket' },
      { role: 'tool', label: 'read ticket completed', content: 'Subject: Login' }
    ]);
  });

  it('formats structured failures without exposing the envelope', () => {
    const result = formatHumanHistory([{
      role: 'tool',
      name: 'search_incidents',
      content: JSON.stringify({ ok: false, error: { code: 'TIMEOUT', message: 'Service unavailable' } })
    }]);
    expect(result[0]).toEqual({
      role: 'tool',
      label: 'search incidents failed',
      content: 'Service unavailable (TIMEOUT)'
    });
  });

  it('preserves the exact stored messages in raw JSON mode', () => {
    expect(JSON.parse(formatRawHistory(history))).toEqual(history);
  });

  it('formats nested values without JSON punctuation', () => {
    const result = formatHumanHistory([{
      role: 'tool',
      name: 'read_ticket',
      content: JSON.stringify({
        ok: true,
        output: {
          subject: 'Login issue',
          conversation: [{ sender: 'player', message: 'Still broken' }],
          categories: ['account', 'bug']
        }
      })
    }]);

    expect(result[0].content).toContain('Subject: Login issue');
    expect(result[0].content).toContain('Sender: player');
    expect(result[0].content).toContain('Categories: account, bug');
    expect(result[0].content).not.toMatch(/[{}\[]"]/);
  });
});
