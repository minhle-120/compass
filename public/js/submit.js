document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('ticket-form');
  const flash = document.getElementById('flash');
  const submitBtn = document.getElementById('submit-btn');

  function showFlash(message, type) {
    flash.textContent = message;
    flash.className = `flash flash-${type}`;
    flash.style.display = 'block';
    setTimeout(() => { flash.style.display = 'none'; }, 5000);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const payload = {
      subject: document.getElementById('ticket-subject').value.trim(),
      description: document.getElementById('ticket-description').value.trim()
    };

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok) {
        showFlash(`Ticket ${data.ticketId} submitted successfully.`, 'success');
        form.reset();
      } else {
        showFlash(data.error || 'Submission failed.', 'error');
      }
    } catch (err) {
      showFlash('Network error. Is the server running?', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Ticket';
    }
  });
});
