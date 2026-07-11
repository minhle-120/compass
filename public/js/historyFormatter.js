function humanizeName(value) {
  return String(value || 'unknown').replace(/_/g, ' ');
}

function formatHumanValue(value, depth = 0) {
  if (value == null || value === '') return '';
  if (typeof value !== 'object') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    if (value.every((item) => item == null || typeof item !== 'object')) {
      return value.map(String).join(', ');
    }
    return value.map((item, index) => `${index + 1}. ${formatHumanValue(item, depth + 1)}`).join('\n');
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return '';
  return entries.map(([key, item]) => {
    const formatted = formatHumanValue(item, depth + 1);
    const label = humanizeName(key).replace(/^./, (letter) => letter.toUpperCase());
    if (item && typeof item === 'object' && formatted.includes('\n')) {
      return `${label}:\n${formatted.split('\n').map((line) => `  ${line}`).join('\n')}`;
    }
    return `${label}: ${formatted || 'None'}`;
  }).join('\n');
}

function parseToolOutcome(content) {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed?.ok === 'boolean') return parsed;
  } catch {}
  return { ok: true, output: content };
}

export function formatHumanHistory(messages) {
  if (!Array.isArray(messages)) return [];

  return messages.flatMap((message) => {
    const role = message?.role || 'unknown';

    if (role === 'system') {
      return [{ role: 'system', label: 'System', content: 'Agent instructions loaded.' }];
    }

    if (role === 'user') {
      const isUpdate = String(message.content || '').includes('workflow_revision:');
      return [{
        role: 'user',
        label: isUpdate ? 'New player update' : 'Assignment',
        content: message.content || ''
      }];
    }

    if (role === 'assistant') {
      const entries = [];
      // Model thinking: content present alongside tool calls (or standalone)
      if (message.content) {
        entries.push({ role: 'thinking', label: 'Model thinking', content: message.content, isThinking: true });
      }
      for (const call of message.tool_calls || []) {
        const toolName = call.function?.name || 'unknown_tool';
        let args = call.function?.arguments || '{}';
        try { args = JSON.parse(args); } catch {}
        const formattedArgs = formatHumanValue(args);
        entries.push({
          role: 'assistant',
          label: 'Agent action',
          content: `Called ${humanizeName(toolName)}${formattedArgs ? `\n${formattedArgs}` : ''}`
        });
      }
      return entries.length ? entries : [{ role: 'assistant', label: 'Agent', content: 'No visible response.' }];
    }

    if (role === 'tool') {
      const outcome = parseToolOutcome(message.content);
      const label = humanizeName(message.name);
      if (!outcome.ok) {
        return [{
          role: 'tool',
          label: `${label} failed`,
          content: `${outcome.error?.message || 'Unknown error'}${outcome.error?.code ? ` (${outcome.error.code})` : ''}`
        }];
      }
      return [{
        role: 'tool',
        label: `${label} completed`,
        content: formatHumanValue(outcome.output) || 'Completed successfully.'
      }];
    }

    return [{ role: 'unknown', label: humanizeName(role), content: formatHumanValue(message) }];
  });
}

export function formatRawHistory(messages) {
  return JSON.stringify(Array.isArray(messages) ? messages : [], null, 2);
}
