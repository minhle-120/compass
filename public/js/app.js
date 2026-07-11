// public/js/app.js

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  const ticketForm = document.getElementById('ticket-form');
  const ticketsContainer = document.getElementById('tickets-container');
  const refreshBtn = document.getElementById('refresh-btn');
  
  // Modal DOM Elements
  const historyModal = document.getElementById('history-modal');
  const modalTicketId = document.getElementById('modal-ticket-id');
  const modalBody = document.getElementById('modal-body');
  const closeModalBtn = document.getElementById('close-modal-btn');

  let pollInterval = null;

  // 1. Auto-generate unique Ticket ID on startup
  function generateTicketId() {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    document.getElementById('ticket-id').value = `T-${randomNum}`;
  }
  generateTicketId();

  // 2. Fetch all tickets and render the queue
  async function fetchTickets() {
    try {
      const response = await fetch('/api/tickets');
      if (!response.ok) throw new Error('Failed to fetch tickets');
      const tickets = await response.json();
      renderTickets(tickets);
      
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

  // 3. Render ticket list
  function renderTickets(tickets) {
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
      // Determine status icon and color
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

    // Re-initialize Lucide icons for dynamically added elements
    lucide.createIcons();

    // Attach click listeners to "View Logs" buttons
    document.querySelectorAll('.view-logs-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        openHistoryModal(btn.dataset.id);
      });
    });
  }

  // 4. Polling functions to keep updates real-time
  function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(fetchTickets, 2000); // Poll every 2 seconds
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  // 5. Submit new ticket
  ticketForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const ticketIdVal = document.getElementById('ticket-id').value;
    const localeVal = document.getElementById('locale').value;
    const subjectVal = document.getElementById('subject').value;
    const playerIdVal = document.getElementById('player-id').value;
    const accountIdVal = document.getElementById('account-id').value;
    const platformVal = document.getElementById('platform').value;
    const regionVal = document.getElementById('region').value;
    const descriptionVal = document.getElementById('description').value;
    
    // Billing Details (optional)
    const transactionIdVal = document.getElementById('transaction-id').value;
    const productVal = document.getElementById('product').value;
    const amountVal = document.getElementById('amount').value;

    const ticket = {
      id: ticketIdVal,
      subject: subjectVal,
      requester_id: playerIdVal || null,
      account_id: accountIdVal || null,
      locale: localeVal,
      region: regionVal,
      platform: platformVal,
      game_version: '4.18.2',
      device: platformVal === 'Android' ? 'Samsung Galaxy S24' : (platformVal === 'iOS' ? 'iPhone 15' : 'PC Desktop'),
      description: descriptionVal,
      transaction_id: transactionIdVal || null,
      product: productVal || null,
      amount: amountVal || null,
      attachments: transactionIdVal ? [{ filename: 'receipt.png' }] : [],
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
      
      // Reset details toggle if open
      const details = document.querySelector('.billing-details-summary');
      if (details) details.removeAttribute('open');

      // Generate next ticket ID
      generateTicketId();

      // Refresh list immediately
      fetchTickets();
    } catch (err) {
      alert(`Error submitting ticket: ${err.message}`);
    }
  });

  // 6. Open History Modal and load ReAct trace logs
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
      renderHistory(history);
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

  // Render trace timeline
  function renderHistory(history) {
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
  }

  // Close modal handlers
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
