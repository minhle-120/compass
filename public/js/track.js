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
  const closeTicketBtn = document.getElementById('close-ticket-btn');
  const deleteTicketBtn = document.getElementById('delete-ticket-btn');
  const timeline = document.getElementById('conversation-timeline');
  
  const replyForm = document.getElementById('reply-form');
  const replyBox = document.getElementById('reply-box');
  const replyMessage = document.getElementById('reply-message');
  const replyBtn = document.getElementById('reply-btn');
  const replyAttachmentInput = document.getElementById('reply-attachments');
  const replyAttachmentPreview = document.getElementById('reply-attachment-preview');

  const allowedAttachmentTypes = new Set([
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]);
  const maxReplyAttachments = 4;
  const maxAttachmentBytes = 8 * 1024 * 1024;

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
          user_closed:        '✓ Closed by you',
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
      closeTicketBtn.style.display = isOpen ? 'inline-flex' : 'none';
      replyBox.style.display = isOpen ? 'block' : 'none';

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
      message: ticket.description || '(No description provided)',
      attachments: Array.isArray(ticket.attachments) ? ticket.attachments : []
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
      const attachmentsHtml = renderAttachments(msg.attachments);

      const itemHtml = `
        <div class="${itemClass}">
          <div class="ticket-timeline-avatar">${avatarText}</div>
          <div class="ticket-timeline-content">
            <div class="ticket-timeline-header">
              <strong>${senderName}</strong>
              <span>${dateText}</span>
            </div>
            <div class="ticket-timeline-body">${escapeHTML(msg.message)}</div>
            ${attachmentsHtml}
          </div>
        </div>
      `;
      timeline.insertAdjacentHTML('beforeend', itemHtml);
    });

    if (ticket.status === 'pending' || ticket.status === 'running') {
      timeline.insertAdjacentHTML('beforeend', `
        <div class="ticket-timeline-item agent ai-working" role="status" aria-live="polite">
          <div class="ticket-timeline-avatar">AI</div>
          <div class="ticket-timeline-content">
            <div class="ai-working-body">
              <span class="ai-working-spinner" aria-hidden="true"></span>
              <span>Support Assistant is working on your ticket...</span>
            </div>
          </div>
        </div>
      `);
    }
  }

  function renderAttachments(attachments) {
    if (!Array.isArray(attachments)) return '';
    const items = attachments.map((attachment) => {
      const source = safeMediaDataUrl(attachment?.dataUrl, attachment?.type);
      if (!source) return '';
      const name = escapeHTML(attachment.name || 'Attachment');
      const media = attachment.type.startsWith('image/')
        ? `<img src="${source}" alt="Attached image: ${name}">`
        : `<video src="${source}" controls preload="metadata" aria-label="Attached video: ${name}"></video>`;
      return `<figure class="ticket-media-item">${media}<figcaption>${name}</figcaption></figure>`;
    }).filter(Boolean);
    return items.length ? `<div class="ticket-media-grid">${items.join('')}</div>` : '';
  }

  function safeMediaDataUrl(value, declaredType) {
    if (typeof value !== 'string' || typeof declaredType !== 'string') return '';
    const escapedType = declaredType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^data:${escapedType};base64,[A-Za-z0-9+/=]+$`, 'i').test(value) ? value : '';
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
  replyAttachmentInput.addEventListener('change', () => {
    const files = Array.from(replyAttachmentInput.files || []);
    replyAttachmentPreview.innerHTML = files.map(file => `
      <div class="attachment-preview-item">
        <span>${escapeHTML(file.name)}</span>
        <span>${formatBytes(file.size)}</span>
      </div>
    `).join('');
  });

  replyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageText = replyMessage.value.trim();

    replyBtn.disabled = true;
    replyBtn.textContent = 'Sending…';

    try {
      const attachments = await prepareReplyAttachments(
        Array.from(replyAttachmentInput.files || [])
      );
      if (!messageText && attachments.length === 0) {
        throw new Error('Enter a reply or choose at least one attachment.');
      }
      const res = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: 'player',
          message: messageText,
          attachments
        })
      });

      if (res.ok) {
        replyMessage.value = '';
        replyAttachmentInput.value = '';
        replyAttachmentPreview.innerHTML = '';
        await fetchTicketDetails();
      } else {
        const payload = await res.json().catch(() => ({}));
        alert(payload.error || 'Failed to send reply. Please try again.');
      }
    } catch (err) {
      alert(err.message || 'Network error sending message.');
    } finally {
      replyBtn.disabled = false;
      replyBtn.textContent = 'Send Reply';
    }
  });

  async function prepareReplyAttachments(files) {
    if (files.length > maxReplyAttachments) {
      throw new Error(`Choose no more than ${maxReplyAttachments} attachments.`);
    }
    return Promise.all(files.map(async (file) => {
      if (!allowedAttachmentTypes.has(file.type)) {
        throw new Error(`Unsupported file type: ${file.name}`);
      }
      if (file.size > maxAttachmentBytes) {
        throw new Error(`${file.name} exceeds the 8 MB file limit.`);
      }
      const attachment = {
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: await readAsDataUrl(file)
      };
      if (file.type.startsWith('video/')) {
        attachment.frames = await sampleVideoFrames(file);
      }
      return attachment;
    }));
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  async function sampleVideoFrames(file) {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const loadedData = waitForEvent(video, 'loadeddata', 12000);
    video.src = objectUrl;

    try {
      await loadedData;
      if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) {
        throw new Error(`Could not decode ${file.name} for AI analysis.`);
      }
      const timestamps = [0, video.duration / 2, Math.max(0, video.duration - 0.1)];
      const uniqueTimestamps = [...new Set(timestamps.map(time => Math.round(time * 10) / 10))];
      const frames = [];
      for (const timestamp of uniqueTimestamps) {
        if (Math.abs(video.currentTime - timestamp) > 0.05) {
          video.currentTime = timestamp;
          await waitForEvent(video, 'seeked', 8000);
        }
        frames.push({ timestamp, dataUrl: captureVideoFrame(video) });
      }
      return frames;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function captureVideoFrame(video) {
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.75);
  }

  function waitForEvent(target, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Media processing timed out.'));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        target.removeEventListener(eventName, onSuccess);
        target.removeEventListener('error', onError);
      };
      const onSuccess = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('The selected media could not be decoded.')); };
      target.addEventListener(eventName, onSuccess, { once: true });
      target.addEventListener('error', onError, { once: true });
    });
  }

  function formatBytes(bytes) {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

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

  closeTicketBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(`Close ticket ${ticketId}? Its conversation will remain available, but the AI will stop working on it.`);
    if (!confirmed) return;

    closeTicketBtn.disabled = true;
    closeTicketBtn.textContent = 'Closing...';
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/close`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to close ticket.');
      await fetchTicketDetails();
    } catch (error) {
      window.alert(error.message);
    } finally {
      closeTicketBtn.disabled = false;
      closeTicketBtn.textContent = 'Close ticket';
    }
  });

  // 4. Initial load & Polling Loop
  fetchTicketDetails();
  pollInterval = setInterval(fetchTicketDetails, 4000);
});
