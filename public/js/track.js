document.addEventListener('DOMContentLoaded', () => {
  const loading = document.getElementById('loading');
  const lookupView = document.getElementById('lookup-view');
  const lookupForm = document.getElementById('lookup-form');
  const lookupIdInput = document.getElementById('lookup-id');
  const errorView = document.getElementById('error-view');
  const ticketView = document.getElementById('ticket-view');
  
  const ticketTitle = document.getElementById('ticket-title');
  const ticketStatus = document.getElementById('ticket-status');
  const ticketResolution = document.getElementById('ticket-resolution');
  const ticketIdDisplay = document.getElementById('ticket-id-display');
  const ticketCreated = document.getElementById('ticket-created');
  const deleteTicketBtn = document.getElementById('delete-ticket-btn');
  const timeline = document.getElementById('conversation-timeline');
  
  const replyForm = document.getElementById('reply-form');
  const replyMessage = document.getElementById('reply-message');
  const replyBtn = document.getElementById('reply-btn');

  const urlParams = new URLSearchParams(window.location.search);
  const ticketId = urlParams.get('id')?.trim();

  let pollInterval = null;

  // 1. Check if Ticket ID is provided in URL
  if (!ticketId) {
    loading.style.display = 'none';
    lookupView.style.display = 'block';

    lookupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputId = lookupIdInput.value.trim();
      if (inputId) {
        window.location.search = `?id=${encodeURIComponent(inputId)}`;
      }
    });
    return;
  }

  // 2. Fetch and render ticket helper
  async function fetchTicketDetails() {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      if (!res.ok) {
        throw new Error('Ticket not found');
      }
      const ticket = await res.json();
      
      // Show ticket details panel
      loading.style.display = 'none';
      lookupView.style.display = 'none';
      errorView.style.display = 'none';
      ticketView.style.display = 'block';

      // Update basic fields
      ticketTitle.textContent = ticket.subject || 'No Subject';
      ticketIdDisplay.textContent = ticket.id;
      
      // Update Status Badge
      const isOpen = ['pending', 'running', 'awaiting_review', 'escalated', 'needs_clarification'].includes(ticket.status);
      ticketStatus.textContent = isOpen ? 'Open' : 'Closed';
      ticketStatus.className = `status-badge ${isOpen ? 'status-running' : 'status-completed'}`;

      // Update Resolution Badge (idle conclusion)
      if (ticket.resolution_type) {
        const labelMap = {
          resolved:           '✓ Resolved',
          needs_clarification: '? Needs Clarification',
          escalated:          '↑ Escalated',
          rejected:           '✗ Rejected'
        };
        ticketResolution.textContent = labelMap[ticket.resolution_type] || ticket.resolution_type;
        ticketResolution.className = `status-badge status-${ticket.resolution_type}`;
        ticketResolution.style.display = 'inline-flex';
      } else {
        ticketResolution.style.display = 'none';
      }

      const canDelete = ticket.status === 'completed' && ticket.resolution_type === 'resolved';
      deleteTicketBtn.style.display = canDelete ? 'inline-flex' : 'none';

      // Manage polling dynamically based on status
      const isActive = ['pending', 'running', 'awaiting_review'].includes(ticket.status);
      if (isActive) {
        if (!pollInterval) {
          pollInterval = setInterval(fetchTicketDetails, 4000);
        }
      } else {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }

      // Update date format
      const createdDate = new Date(ticket.created_at || Date.now());
      ticketCreated.textContent = createdDate.toLocaleString();

      // Render timeline conversation
      renderTimeline(ticket);

    } catch (err) {
      loading.style.display = 'none';
      ticketView.style.display = 'none';
      errorView.style.display = 'block';
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    }
  }

  function renderTimeline(ticket) {
    timeline.innerHTML = '';

    // First timeline item is always the original description
    const initialMsg = {
      sender: 'player',
      timestamp: ticket.created_at || new Date().toISOString(),
      message: ticket.description || '(No description provided)'
    };

    // Combine original details and conversation thread
    let conversationList = [];
    try {
      conversationList = typeof ticket.conversation === 'string' 
        ? JSON.parse(ticket.conversation) 
        : (ticket.conversation || []);
    } catch (e) {
      conversationList = [];
    }

    const fullMessages = [initialMsg, ...conversationList];
    if (ticket.draft_response && ticket.draft_status !== 'pending_review' && ticket.status !== 'pending' && ticket.status !== 'running') {
      fullMessages.push({
        sender: 'agent',
        timestamp: ticket.updated_at || ticket.created_at || new Date().toISOString(),
        message: ticket.draft_response
      });
    }

    fullMessages.forEach(msg => {
      const isAgent = msg.sender !== 'player';
      const itemClass = isAgent ? 'ticket-timeline-item agent' : 'ticket-timeline-item';
      const avatarText = isAgent ? 'SR' : 'ME';
      const senderName = isAgent ? 'Support Assistant (AI)' : 'You (Player)';
      const dateText = new Date(msg.timestamp).toLocaleString();

      const itemHtml = `
        <div class="${itemClass}">
          <div class="ticket-timeline-avatar">${avatarText}</div>
          <div class="ticket-timeline-content">
            <div class="ticket-timeline-header">
              <strong>${senderName}</strong>
              <span>${dateText}</span>
            </div>
            <div class="ticket-timeline-body">${escapeHTML(msg.message)}</div>
          </div>
        </div>
      `;
      timeline.insertAdjacentHTML('beforeend', itemHtml);
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

  // 3. Setup message reply handler
  replyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageText = replyMessage.value.trim();
    if (!messageText) return;

    replyBtn.disabled = true;
    replyBtn.textContent = 'Sending…';

    try {
      const res = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: 'player',
          message: messageText
        })
      });

      if (res.ok) {
        replyMessage.value = '';
        await fetchTicketDetails();
      } else {
        alert('Failed to send reply. Please try again.');
      }
    } catch (err) {
      alert('Network error sending message.');
    } finally {
      replyBtn.disabled = false;
      replyBtn.textContent = 'Send Reply';
    }
  });

  deleteTicketBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(`Permanently delete resolved ticket ${ticketId}? This cannot be undone.`);
    if (!confirmed) return;

    deleteTicketBtn.disabled = true;
    deleteTicketBtn.textContent = 'Deleting...';
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to delete ticket.');

      if (pollInterval) clearInterval(pollInterval);
      window.location.href = `/tickets.html?deleted=${encodeURIComponent(ticketId)}`;
    } catch (error) {
      window.alert(error.message);
      deleteTicketBtn.disabled = false;
      deleteTicketBtn.textContent = 'Delete ticket';
    }
  });

  // 4. Initial load & Polling Loop
  fetchTicketDetails();
  pollInterval = setInterval(fetchTicketDetails, 4000);
});
