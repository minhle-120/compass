// public/js/app.js

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  const ticketForm = document.getElementById('ticket-form');
  const ticketsContainer = document.getElementById('tickets-container');
  const refreshBtn = document.getElementById('refresh-btn');
  
  // Tab Elements
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  // History Tab DOM Elements
  const historyRunsList = document.getElementById('history-runs-list');
  const viewerTitle = document.getElementById('viewer-title');
  const viewerSubtitle = document.getElementById('viewer-subtitle');
  const viewerBody = document.getElementById('viewer-body');
  
  // Modal DOM Elements (For quick view from Queue)
  const historyModal = document.getElementById('history-modal');
  const modalTicketId = document.getElementById('modal-ticket-id');
  const modalBody = document.getElementById('modal-body');
  const closeModalBtn = document.getElementById('close-modal-btn');

  let pollInterval = null;
  let activeTab = 'queue-tab';
  let selectedHistoryTicketId = null;

  // 1. Auto-generate unique Ticket ID on startup
  function generateTicketId() {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    document.getElementById('ticket-id').value = `T-${randomNum}`;
  }
  generateTicketId();

  // 2. Fetch all tickets and render the queue/sidebar
  async function fetchTickets(silent = false) {
    try {
      const response = await fetch('/api/tickets');
      if (!response.ok) throw new Error('Failed to fetch tickets');
      const tickets = await response.json();
      
      // Render components depending on current views
      renderTickets(tickets);
      renderHistorySidebar(tickets);
      
      // If there are running or pending tickets, start polling
      const hasActive = tickets.some(t => t.status === 'running' || t.status === 'pending');
      if (hasActive) {
        startPolling();
      } else {
        stopPolling();
      }
    } catch (err) {
      console.error('Error fetching tickets:', err);
    }
  }

  // 3. Render ticket list (Queue Tab)
  function renderTickets(tickets) {
    if (ticketsContainer.offsetParent === null) return; // Skip if tab is hidden

    if (tickets.length === 0) {
      ticketsContainer.innerHTML = `
        <div class="empty-state">
          <i data-lucide="inbox"></i>
          <p>No tickets in the queue. Use the form on the left to submit a ticket!</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    ticketsContainer.innerHTML = tickets.map(ticket => {
      let statusIcon = 'clock';
      if (ticket.status === 'running') statusIcon = 'loader';
      if (ticket.status === 'completed') statusIcon = 'check-circle2';
      if (ticket.status === 'escalated') statusIcon = 'arrow-up-right';
      if (ticket.status === 'failed') statusIcon = 'alert-triangle';

      const showOutput = ticket.status === 'completed' || ticket.status === 'escalated' || ticket.status === 'failed';
      const categories = ticket.categories || [];
      const showCategories = categories.length > 0;

      return `
        <div class="card glass ticket-card status-${ticket.status}">
          <div class="ticket-card-header">
            <div class="ticket-meta">
              <h3>${ticket.id} — ${ticket.subject || 'No Subject'}</h3>
              <span>Created: ${new Date(ticket.created_at).toLocaleString()}</span>
            </div>
            <span class="badge badge-${ticket.status}">
              <i data-lucide="${statusIcon}" class="${ticket.status === 'running' ? 'logo-spin' : ''}"></i>
              ${ticket.status}
            </span>
          </div>

          <div class="ticket-card-body">
            <p class="ticket-desc">${ticket.description || 'No description provided.'}</p>
            
            ${showOutput ? `
              <div class="agent-output-block">
                <div class="output-header">
                  <i data-lucide="bot"></i>
                  <span>AI Agent Analysis Output</span>
                </div>
                
                <div class="output-row">
                  ${showCategories ? `
                    <div class="output-item">
                      <span>Categories:</span>
                      <div class="pill-group">
                        ${categories.map(c => `<span class="pill">${c}</span>`).join('')}
                      </div>
                    </div>
                  ` : ''}
                  ${ticket.severity ? `
                    <div class="output-item">
                      <span>Severity:</span>
                      <strong>${ticket.severity.toUpperCase()}</strong>
                    </div>
                  ` : ''}
                  ${ticket.routing_destination ? `
                    <div class="output-item">
                      <span>Routing Queue:</span>
                      <strong>${ticket.routing_destination}</strong>
                    </div>
                  ` : ''}
                </div>

                ${ticket.draft_response ? `
                  <div class="output-header" style="margin-top: 1rem; color: #4facfe;">
                    <i data-lucide="message-square-quote"></i>
                    <span>Drafted Player Reply</span>
                  </div>
                  <div class="draft-box">${ticket.draft_response}</div>
                ` : ''}

                ${ticket.error_message ? `
                  <div class="output-header" style="margin-top: 1rem; color: #ef4444;">
                    <i data-lucide="x-circle"></i>
                    <span>Execution Error</span>
                  </div>
                  <div class="error-box">${ticket.error_message}</div>
                ` : ''}
              </div>
            ` : ''}
          </div>

          <div class="ticket-card-footer">
            <button class="btn-secondary view-logs-btn" data-id="${ticket.id}">
              <i data-lucide="scroll-text"></i>
              <span>View AI Execution Logs</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    lucide.createIcons();

    // Attach click listeners to "View Logs" buttons
    document.querySelectorAll('.view-logs-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        openHistoryModal(btn.dataset.id);
      });
    });
  }

  // 4. Render Sidebar list (History Tab)
  function renderHistorySidebar(tickets) {
    if (historyRunsList.offsetParent === null) return; // Skip if tab is hidden

    // Filter tickets that have runs (or all tickets, but completed/failed/escalated runs are best)
    const runs = tickets.filter(t => t.status === 'completed' || t.status === 'escalated' || t.status === 'failed');

    if (runs.length === 0) {
      historyRunsList.innerHTML = `<p class="empty-sidebar">No processed runs available.</p>`;
      return;
    }

    historyRunsList.innerHTML = runs.map(run => {
      const activeClass = selectedHistoryTicketId === run.id ? 'active' : '';
      return `
        <button class="run-item ${activeClass}" data-id="${run.id}">
          <div class="run-item-header">
            <span class="run-item-id">${run.id}</span>
            <span class="badge badge-${run.status}" style="font-size: 0.65rem; padding: 0.15rem 0.45rem;">${run.status}</span>
          </div>
          <div class="run-item-subject">${run.subject || 'No Subject'}</div>
          <div class="run-item-time">${new Date(run.updated_at || run.created_at).toLocaleTimeString()}</div>
        </button>
      `;
    }).join('');

    // Attach click listener to run list items
    document.querySelectorAll('.run-item').forEach(item => {
      item.addEventListener('click', () => {
        selectedHistoryTicketId = item.dataset.id;
        document.querySelectorAll('.run-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        fetchAndRenderHistoryTrace(selectedHistoryTicketId);
      });
    });
  }

  // 5. Fetch and Render Agent History Trace in main viewer panel
  async function fetchAndRenderHistoryTrace(ticketId) {
    viewerTitle.textContent = `Audit Log: ${ticketId}`;
    viewerSubtitle.textContent = `Inspecting conversation and execution trace from the SQLite database and raw files`;
    viewerBody.innerHTML = `
      <div class="empty-state" style="border:none; padding-top: 10rem;">
        <i data-lucide="loader" class="logo-spin"></i>
        <p>Loading agent execution trace...</p>
      </div>
    `;
    lucide.createIcons();

    try {
      const response = await fetch(`/api/tickets/${ticketId}/history`);
      if (!response.ok) throw new Error('History trace file not found');
      const history = await response.json();
      
      if (!history || history.length === 0) {
        viewerBody.innerHTML = `
          <div class="empty-state" style="border:none; padding-top: 10rem;">
            <i data-lucide="scroll-text"></i>
            <p>Execution logs are empty.</p>
          </div>
        `;
        return;
      }

      viewerBody.innerHTML = history.map(step => {
        let icon = 'message-square';
        if (step.role === 'system') icon = 'settings';
        if (step.role === 'user') icon = 'user';
        if (step.role === 'assistant') icon = 'bot';
        if (step.role === 'tool') icon = 'wrench';

        const showToolCalls = step.tool_calls && step.tool_calls.length > 0;

        return `
          <div class="trace-step ${step.role}">
            <div class="trace-icon">
              <i data-lucide="${icon}"></i>
            </div>
            <div class="trace-content">
              <div class="trace-meta">
                <span class="trace-role">${step.role}</span>
                ${step.timestamp ? `<span class="trace-time">${new Date(step.timestamp).toLocaleTimeString()}</span>` : ''}
              </div>
              
              ${step.content ? `<div class="trace-text">${step.content}</div>` : ''}

              ${showToolCalls ? `
                <div class="trace-tool-calls">
                  ${step.tool_calls.map(tc => `
                    <div class="tool-call-card">
                      <div class="tool-call-name">🛠️ Called: ${tc.function.name}()</div>
                      ${tc.function.arguments && tc.function.arguments !== '{}' ? `
                        <pre class="tool-call-args">${JSON.stringify(JSON.parse(tc.function.arguments), null, 2)}</pre>
                      ` : ''}
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      lucide.createIcons();
    } catch (err) {
      viewerBody.innerHTML = `
        <div class="empty-state" style="border:none; color: #ef4444; padding-top: 10rem;">
          <i data-lucide="alert-circle"></i>
          <p>Failed to load trace: ${err.message}</p>
        </div>
      `;
      lucide.createIcons();
    }
  }

  // 6. Tab Switcher Logic
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      activeTab = targetTab;
      
      // Update button state
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update content visibility
      tabContents.forEach(content => {
        if (content.id === targetTab) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });

      // Refresh data
      fetchTickets();
    });
  });

  // 7. Polling functions
  function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(() => fetchTickets(true), 2000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  // 8. Submit ticket form
  ticketForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const ticket = {
      id: document.getElementById('ticket-id').value,
      subject: document.getElementById('subject').value,
      requester_id: document.getElementById('player-id').value || null,
      account_id: document.getElementById('account-id').value || null,
      locale: document.getElementById('locale').value,
      region: document.getElementById('region').value,
      platform: document.getElementById('platform').value,
      game_version: '4.18.2',
      device: document.getElementById('platform').value === 'Android' ? 'Samsung Galaxy S24' : (document.getElementById('platform').value === 'iOS' ? 'iPhone 15' : 'PC Desktop'),
      description: document.getElementById('description').value,
      transaction_id: document.getElementById('transaction-id').value || null,
      product: document.getElementById('product').value || null,
      amount: document.getElementById('amount').value || null,
      attachments: document.getElementById('transaction-id').value ? [{ filename: 'receipt.png' }] : [],
      conversation: []
    };

    try {
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(ticket)
      });

      if (!response.ok) throw new Error('Failed to submit ticket');
      
      // Clear description
      document.getElementById('description').value = '';
      document.getElementById('subject').value = '';
      document.getElementById('transaction-id').value = '';
      document.getElementById('product').value = '';
      document.getElementById('amount').value = '';
      
      const details = document.querySelector('.billing-details-summary');
      if (details) details.removeAttribute('open');

      generateTicketId();
      fetchTickets();
    } catch (err) {
      alert(`Error submitting ticket: ${err.message}`);
    }
  });

  // 9. Quick view Modal Timeline Handlers
  async function openHistoryModal(ticketId) {
    modalTicketId.textContent = `Ticket ${ticketId} Execution Logs`;
    modalBody.innerHTML = `
      <div class="empty-state" style="border:none; padding: 2rem;">
        <i data-lucide="loader" class="logo-spin"></i>
        <p>Loading agent execution trace...</p>
      </div>
    `;
    lucide.createIcons();
    historyModal.classList.add('active');

    try {
      const response = await fetch(`/api/tickets/${ticketId}/history`);
      if (!response.ok) throw new Error('History logs not found');
      const history = await response.json();
      
      if (!history || history.length === 0) {
        modalBody.innerHTML = '<p class="empty-state">No execution logs found.</p>';
        return;
      }

      modalBody.innerHTML = history.map(step => {
        let icon = 'message-square';
        if (step.role === 'system') icon = 'settings';
        if (step.role === 'user') icon = 'user';
        if (step.role === 'assistant') icon = 'bot';
        if (step.role === 'tool') icon = 'wrench';

        const showToolCalls = step.tool_calls && step.tool_calls.length > 0;

        return `
          <div class="trace-step ${step.role}">
            <div class="trace-icon">
              <i data-lucide="${icon}"></i>
            </div>
            <div class="trace-content">
              <div class="trace-meta">
                <span class="trace-role">${step.role}</span>
                ${step.timestamp ? `<span class="trace-time">${new Date(step.timestamp).toLocaleTimeString()}</span>` : ''}
              </div>
              
              ${step.content ? `<div class="trace-text">${step.content}</div>` : ''}

              ${showToolCalls ? `
                <div class="trace-tool-calls">
                  ${step.tool_calls.map(tc => `
                    <div class="tool-call-card">
                      <div class="tool-call-name">🛠️ Called: ${tc.function.name}()</div>
                      ${tc.function.arguments && tc.function.arguments !== '{}' ? `
                        <pre class="tool-call-args">${JSON.stringify(JSON.parse(tc.function.arguments), null, 2)}</pre>
                      ` : ''}
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      lucide.createIcons();
    } catch (err) {
      modalBody.innerHTML = `
        <div class="empty-state" style="border:none; color: #ef4444;">
          <i data-lucide="alert-circle"></i>
          <p>Failed to load execution logs: ${err.message}</p>
        </div>
      `;
      lucide.createIcons();
    }
  }

  closeModalBtn.addEventListener('click', () => {
    historyModal.classList.remove('active');
  });

  historyModal.addEventListener('click', (e) => {
    if (e.target === historyModal) {
      historyModal.classList.remove('active');
    }
  });

  // Manual refresh button
  refreshBtn.addEventListener('click', () => {
    fetchTickets();
  });

  // Initial load
  fetchTickets();
});
