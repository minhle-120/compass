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
      id: document.getElementById('ticket-id').value.trim(),
      subject: document.getElementById('ticket-subject').value.trim(),
      description: document.getElementById('ticket-description').value.trim(),
      requester_id: document.getElementById('ticket-requester').value.trim() || null,
      account_id: document.getElementById('ticket-account').value.trim() || null,
      platform: document.getElementById('ticket-platform').value || null,
      region: document.getElementById('ticket-region').value || null,
      device: document.getElementById('ticket-device').value.trim() || null,
      game_version: document.getElementById('ticket-version').value.trim() || null,
      locale: document.getElementById('ticket-locale').value.trim() || null,
      transaction_id: document.getElementById('ticket-txn').value.trim() || null,
      product: document.getElementById('ticket-product').value.trim() || null,
      amount: document.getElementById('ticket-amount').value.trim() || null
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
