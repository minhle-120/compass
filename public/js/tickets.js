document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('tickets-container');
  const tabOpen = document.getElementById('tab-open');
  const tabClosed = document.getElementById('tab-closed');

  let openTickets = [];
  let closedTickets = [];
  let currentTab = 'open'; // 'open' or 'closed'

  async function fetchTickets() {
    try {
      const res = await fetch('/api/tickets');
      if (!res.ok) throw new Error('Failed to fetch tickets');
      const tickets = await res.json();

      // Separate open & closed tickets
      // Open tickets: pending, running, escalated
      // Closed tickets: completed, failed
      openTickets = tickets.filter(t => t.status === 'pending' || t.status === 'running' || t.status === 'escalated');
      closedTickets = tickets.filter(t => t.status === 'completed' || t.status === 'failed');

      // Update Tab count labels
      tabOpen.textContent = `Open Tickets (${openTickets.length})`;
      tabClosed.textContent = `Closed Tickets (${closedTickets.length})`;

      renderTicketsList();
    } catch (err) {
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--color-fg-danger);">
          Error loading tickets. Please check connection.
        </div>
      `;
    }
  }

  function renderTicketsList() {
    const list = currentTab === 'open' ? openTickets : closedTickets;

    if (list.length === 0) {
      container.innerHTML = `
        <div style="padding: 32px; text-align: center; color: var(--color-fg-muted); font-size: 14px;">
          No ${currentTab} tickets found.
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    list.forEach(ticket => {
      const createdDate = new Date(ticket.created_at).toLocaleString();
      const row = document.createElement('a');
      row.className = 'ticket-row';
      row.href = `/track.html?id=${encodeURIComponent(ticket.id)}`;

      row.innerHTML = `
        <div class="ticket-info">
          <div class="ticket-title">${escapeHTML(ticket.subject || 'No Subject')}</div>
          <div class="ticket-meta">
            <span style="font-family: var(--font-mono); font-weight: 600;">${ticket.id}</span>
            <span style="margin: 0 4px;">•</span>
            Created on ${createdDate}
          </div>
        </div>
        <div>
          <span class="status-badge status-${ticket.status}">${ticket.status}</span>
        </div>
      `;
      container.appendChild(row);
    });
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function handleTabSwitch(tabName) {
    currentTab = tabName;
    if (tabName === 'open') {
      tabOpen.classList.add('active');
      tabClosed.classList.remove('active');
    } else {
      tabClosed.classList.add('active');
      tabOpen.classList.remove('active');
    }
    renderTicketsList();
  }

  // Bind tab click events
  tabOpen.addEventListener('click', () => handleTabSwitch('open'));
  tabClosed.addEventListener('click', () => handleTabSwitch('closed'));

  // Load and poll
  fetchTickets();
  setInterval(fetchTickets, 5000);
});
