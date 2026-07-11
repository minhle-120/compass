document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('ticket-form');
  const flash = document.getElementById('flash');
  const submitBtn = document.getElementById('submit-btn');
  const attachmentInput = document.getElementById('ticket-attachments');
  const attachmentPreview = document.getElementById('attachment-preview');

  const allowedTypes = new Set([
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]);
  const maxFiles = 4;
  const maxFileBytes = 8 * 1024 * 1024;

  function showFlash(message, type) {
    flash.innerHTML = message;
    flash.className = `flash flash-${type}`;
    flash.style.display = 'block';
    setTimeout(() => { flash.style.display = 'none'; }, 5000);
  }

  attachmentInput.addEventListener('change', () => {
    const files = Array.from(attachmentInput.files || []);
    attachmentPreview.innerHTML = files.map(file => `
      <div class="attachment-preview-item">
        <span>${escapeHTML(file.name)}</span>
        <span>${formatBytes(file.size)}</span>
      </div>
    `).join('');
  });

  form.addEventListener('reset', () => {
    attachmentPreview.innerHTML = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      const attachments = await prepareAttachments(Array.from(attachmentInput.files || []));
      const payload = {
        subject: document.getElementById('ticket-subject').value.trim(),
        description: document.getElementById('ticket-description').value.trim(),
        attachments
      };

      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok) {
        showFlash(`Ticket ${data.ticketId} submitted successfully. <a href="/track.html?id=${encodeURIComponent(data.ticketId)}" style="color: inherit; text-decoration: underline; font-weight: 600;">Track conversation here</a>`, 'success');
        form.reset();
      } else {
        showFlash(data.error || 'Submission failed.', 'error');
      }
    } catch (err) {
      showFlash(err.message || 'Network error. Is the server running?', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Ticket';
    }
  });

  async function prepareAttachments(files) {
    if (files.length > maxFiles) throw new Error(`Choose no more than ${maxFiles} attachments.`);

    return Promise.all(files.map(async (file) => {
      if (!allowedTypes.has(file.type)) throw new Error(`Unsupported file type: ${file.name}`);
      if (file.size > maxFileBytes) throw new Error(`${file.name} exceeds the 8 MB file limit.`);

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

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
