document.addEventListener('DOMContentLoaded', () => {
  const POLL_INTERVAL = 3000;

  // DOM refs
  const statPending = document.getElementById('stat-pending');
  const statRunning = document.getElementById('stat-running');
  const statCompleted = document.getElementById('stat-completed');
  const statFailed = document.getElementById('stat-failed');
  const statConcurrency = document.getElementById('stat-concurrency');
  const providerLabel = document.getElementById('provider-label');
  const agentCount = document.getElementById('agent-count');
  const agentsContainer = document.getElementById('agents-container');
  const ticketTbody = document.getElementById('ticket-tbody');
  const detailOverlay = document.getElementById('detail-overlay');
  const detailTitle = document.getElementById('detail-title');
  const detailFields = document.getElementById('detail-fields');
  const detailHistory = document.getElementById('detail-history');
  const detailClose = document.getElementById('detail-close');

  // Close detail panel
  detailClose.addEventListener('click', () => { detailOverlay.style.display = 'none'; });
  detailOverlay.addEventListener('click', (e) => {
    if (e.target === detailOverlay) detailOverlay.style.display = 'none';
  });

  // Helpers
  function statusLabel(status) {
    const s = (status || 'pending').toLowerCase();
    return `<span class="label label-${s}">${s}</span>`;
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '–';
    const diff = Date.now() - new Date(dateStr).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function esc(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function truncate(str, len) {
    if (!str) return '–';
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  // Fetch management layer status
  async function fetchSystemStatus() {
    try {
      const res = await fetch('/api/system/status');
      const data = await res.json();
      const mgmt = data.management;
      const queue = mgmt.queue;

      statPending.textContent = queue.pending;
      statRunning.textContent = queue.running;
      statCompleted.textContent = queue.completed;
      statFailed.textContent = queue.failed;
      statConcurrency.textContent = `${mgmt.activeWorkersCount}/${mgmt.concurrencyCap}`;
      providerLabel.textContent = mgmt.llmProvider;

      // Render active agents
      const agents = data.activeAgents || [];
      agentCount.textContent = `${agents.length} active`;

      if (agents.length === 0) {
        agentsContainer.innerHTML = '<div class="empty-state"><h3>No active agents</h3><p>Agents will appear here when processing tickets.</p></div>';
      } else {
        agentsContainer.innerHTML = agents.map(a => {
          const checklist = a.checklist || {};
          const checkItems = ['read_ticket', 'search_incidents', 'classify_ticket', 'draft_response', 'route_ticket']
            .map(key => `<span class="check-item ${checklist[key] ? 'done' : ''}">${checklist[key] ? '✓' : '○'} ${key.replace(/_/g, ' ')}</span>`)
            .join('');

          return `
            <div class="agent-card">
              <div class="agent-card-header">
                <span class="agent-ticket">${esc(a.ticketId)}</span>
                <span class="label label-running"><span class="pulse"></span> processing</span>
              </div>
              <div class="agent-step">Step ${a.step || '?'}: ${esc(a.currentTool || 'waiting for LLM')}</div>
              <div class="agent-meta">
                <span>Tokens: ${a.totalTokens || 0}</span>
                <span>Elapsed: ${a.startedAt ? timeAgo(a.startedAt) : '–'}</span>
              </div>
              <div class="checklist">${checkItems}</div>
            </div>
          `;
        }).join('');
      }
    } catch (err) {
      console.error('Failed to fetch system status', err);
    }
  }

  // Fetch all tickets
  async function fetchTickets() {
    try {
      const res = await fetch('/api/tickets');
      const tickets = await res.json();

      if (tickets.length === 0) {
        ticketTbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><h3>No tickets yet</h3><p>Submit a ticket to get started.</p></div></td></tr>';
        return;
      }

      ticketTbody.innerHTML = tickets.map(t => {
        const categories = Array.isArray(t.categories) ? t.categories.join(', ') : (t.categories || '–');
        const resolutionBadge = t.resolution_type
          ? `<span class="label label-${t.resolution_type}">${t.resolution_type}</span>`
          : '–';
        return `
          <tr>
            <td><a class="ticket-id" data-id="${esc(t.id)}">${esc(t.id)}</a></td>
            <td class="ticket-subject">${esc(truncate(t.subject, 60))}</td>
            <td>${statusLabel(t.status)}</td>
            <td>${resolutionBadge}</td>
            <td>${esc(t.routing_destination || '–')}</td>
            <td class="text-muted text-sm">${esc(truncate(categories, 30))}</td>
            <td class="ticket-time">${timeAgo(t.created_at)}</td>
          </tr>
        `;
      }).join('');

      // Bind click handlers
      ticketTbody.querySelectorAll('.ticket-id').forEach(el => {
        el.addEventListener('click', () => openDetail(el.dataset.id));
      });

    } catch (err) {
      console.error('Failed to fetch tickets', err);
    }
  }

  // Open ticket detail overlay
  async function openDetail(ticketId) {
    detailOverlay.style.display = 'block';
    detailTitle.textContent = ticketId;
    detailFields.innerHTML = '<dd>Loading…</dd>';
    detailHistory.innerHTML = '<div class="text-muted">Loading…</div>';

    // Fetch ticket detail
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      const t = await res.json();

      const fields = [
        ['ID', t.id], ['Subject', t.subject], ['Status', t.status],
        ['Description', t.description],
        ['Requester', t.requester_id], ['Account', t.account_id],
        ['Platform', t.platform], ['Region', t.region],
        ['Device', t.device], ['Game Version', t.game_version],
        ['Locale', t.locale],
        ['Transaction', t.transaction_id], ['Product', t.product], ['Amount', t.amount],
        ['Categories', Array.isArray(t.categories) ? t.categories.join(', ') : t.categories],
        ['Severity', t.severity], ['Rationale', t.rationale],
        ['Routing', t.routing_destination], ['Routing Reason', t.routing_reason],
        ['Draft Response', t.draft_response],
        ['Error', t.error_message],
        ['Created', t.created_at], ['Updated', t.updated_at]
      ];

      detailFields.innerHTML = fields.map(([label, val]) =>
        `<dt>${esc(label)}</dt><dd>${esc(val != null ? String(val) : '–')}</dd>`
      ).join('');
    } catch (err) {
      detailFields.innerHTML = '<dd>Failed to load ticket.</dd>';
    }

    // Fetch conversation history
    try {
      const res = await fetch(`/api/tickets/${ticketId}/history`);
      if (!res.ok) {
        detailHistory.innerHTML = '<div class="text-muted">No history available.</div>';
        return;
      }
      const history = await res.json();
      detailHistory.innerHTML = renderHistory(history);
    } catch (err) {
      detailHistory.innerHTML = '<div class="text-muted">Failed to load history.</div>';
    }
  }

  function renderHistory(messages) {
    if (!messages || messages.length === 0) {
      return '<div class="text-muted">No conversation history.</div>';
    }
    return '<ul class="timeline">' + messages.map(msg => {
      const role = msg.role || 'unknown';
      let content = '';

      if (role === 'assistant') {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          content = msg.tool_calls.map(tc => {
            const fn = tc.function || {};
            let args = fn.arguments || '{}';
            try { args = JSON.stringify(JSON.parse(args), null, 2); } catch (e) {}
            return `→ ${fn.name}(${args})`;
          }).join('\n');
        }
        if (msg.reasoning_content) {
          content = '💭 ' + msg.reasoning_content + (content ? '\n' + content : '');
        }
        if (msg.content) {
          content = msg.content + (content ? '\n' + content : '');
        }
      } else if (role === 'tool') {
        content = `[${msg.name || 'tool'}] ${msg.content || ''}`;
      } else {
        content = msg.content || '';
      }

      return `
        <li class="timeline-item">
          <div class="timeline-role ${role}">${role}</div>
          <div class="timeline-content">${esc(truncate(content, 800))}</div>
        </li>
      `;
    }).join('') + '</ul>';
  }

  // Initial fetch + polling
  fetchSystemStatus();
  fetchTickets();
  setInterval(() => {
    fetchSystemStatus();
    fetchTickets();
  }, POLL_INTERVAL);
});
