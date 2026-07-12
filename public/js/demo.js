document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('spawn-demo');
  const flash = document.getElementById('demo-flash');
  const result = document.getElementById('demo-result');
  const resultBody = document.getElementById('demo-result-body');

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showFlash(message, type) {
    flash.textContent = message;
    flash.className = `flash flash-${type}`;
    flash.style.display = 'block';
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Creating incident burst…';
    result.style.display = 'none';
    flash.style.display = 'none';

    try {
      const response = await fetch('/api/demo/spawn-incident', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The demo batch could not be created.');

      const incidentText = data.incident
        ? `<p><strong>Incident:</strong> ${escapeHTML(data.incident.id)} — ${escapeHTML(data.incident.title)} (${escapeHTML(data.incident.severity)})</p>`
        : '<p><strong>Incident:</strong> Clustering completed; check the dashboard for the active incident.</p>';
      const ticketLinks = data.tickets.map((ticket) =>
        `<li><a href="/track.html?id=${encodeURIComponent(ticket.id)}">${escapeHTML(ticket.id)}</a> — ${escapeHTML(ticket.subject)}</li>`
      ).join('');

      resultBody.innerHTML = `
        <p><strong>Shared creation time:</strong> ${escapeHTML(data.createdAt)}</p>
        <p><strong>New problem:</strong> ${escapeHTML(data.scenario.name)}</p>
        ${incidentText}
        <p><strong>Ticket IDs:</strong></p>
        <ul>${ticketLinks}</ul>
        <a class="btn btn-primary" href="/dashboard.html">Watch processing on dashboard</a>
      `;
      result.style.display = 'block';
      showFlash('Five tickets were created and grouped successfully.', 'success');
    } catch (error) {
      showFlash(error.message || 'Could not connect to the demo API.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Create next problem and incident';
    }
  });
});
