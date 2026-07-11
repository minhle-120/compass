const elements = {
  search: document.getElementById('flag-search'),
  status: document.getElementById('flag-status'),
  refresh: document.getElementById('refresh-flags'),
  count: document.getElementById('flag-count'),
  list: document.getElementById('flag-list'),
  stats: document.getElementById('flag-stats'),
  toast: document.getElementById('flag-toast'),
  addDialog: document.getElementById('add-word-dialog'),
  addForm: document.getElementById('add-word-form'),
  addTerm: document.getElementById('add-word-term'),
  addTarget: document.getElementById('add-word-target'),
  addCategory: document.getElementById('add-word-category'),
  addExplanation: document.getElementById('add-word-explanation'),
  cancelAdd: document.getElementById('cancel-add-word'),
  publishAdd: document.getElementById('publish-add-word')
};

const CATEGORY_OPTIONS = {
  slang: [
    ['general', 'General'],
    ['gaming', 'Gaming'],
    ['chat', 'Chat'],
    ['meme', 'Meme'],
    ['platform', 'Platform'],
    ['sensitive', 'Sensitive']
  ],
  wiki: [
    ['mechanic', 'Mechanic'],
    ['agent', 'Agent'],
    ['ability', 'Ability'],
    ['ultimate', 'Ultimate'],
    ['map', 'Map'],
    ['weapon', 'Weapon'],
    ['cosmetic', 'Cosmetic']
  ]
};

let searchTimer;
let selectedFlag = null;
elements.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadFlags, 180);
});
elements.status.addEventListener('change', loadFlags);
elements.refresh.addEventListener('click', () => Promise.all([loadFlags(), loadStats()]));
elements.cancelAdd.addEventListener('click', () => elements.addDialog.close());
elements.addForm.addEventListener('submit', addFlagToWiki);
elements.addTarget.addEventListener('change', () => renderCategoryOptions(elements.addTarget.value));

await Promise.all([loadFlags(), loadStats()]);

async function loadFlags() {
  elements.list.innerHTML = '<p class="flag-empty">Reading the review queue...</p>';
  try {
    const query = encodeURIComponent(elements.search.value.trim());
    const status = encodeURIComponent(elements.status.value);
    const payload = await request(`/api/wiki/flags?query=${query}&status=${status}&limit=500`);
    elements.count.textContent = `${payload.total} ${payload.total === 1 ? 'flag' : 'flags'}`;
    renderFlags(payload.entries);
  } catch (error) {
    elements.list.innerHTML = `<p class="flag-empty">${escapeHtml(error.message)}</p>`;
    showToast(error.message, true);
  }
}

async function loadStats() {
  try {
    const stats = await request('/api/wiki/stats');
    const counts = stats.unknown_words;
    const values = [
      [counts.open, 'Open'],
      [counts.resolved, 'Resolved'],
      [counts.ignored, 'Ignored'],
      [counts.open + counts.resolved + counts.ignored, 'All sightings']
    ];
    elements.stats.innerHTML = values.map(([value, label]) => (
      `<div class="flag-stat"><strong>${value}</strong><span>${label}</span></div>`
    )).join('');
  } catch {
    elements.stats.innerHTML = '';
  }
}

function renderFlags(entries) {
  if (!entries.length) {
    elements.list.innerHTML = '<p class="flag-empty">No words match this review view.</p>';
    return;
  }

  elements.list.innerHTML = entries.map((entry) => `
    <article class="flag-row">
      <div>
        <span class="flag-status ${entry.status}">${escapeHtml(entry.status)}</span>
        <h2 class="flag-word">${escapeHtml(entry.word)}</h2>
        <div class="flag-meta">Seen ${entry.occurrence_count} ${entry.occurrence_count === 1 ? 'time' : 'times'}</div>
      </div>
      <div>
        <p class="flag-context">${escapeHtml(entry.context || 'No sentence context supplied.')}</p>
        ${entry.reason ? `<p class="flag-reason">${escapeHtml(entry.reason)}</p>` : ''}
      </div>
      <div>
        ${entry.latest_ticket_id ? `<a class="flag-ticket" href="/track.html?id=${encodeURIComponent(entry.latest_ticket_id)}">${escapeHtml(entry.latest_ticket_id)}</a>` : '<span class="flag-meta">No ticket</span>'}
        <p class="flag-time">Last seen<br>${formatDate(entry.last_seen_at)}</p>
      </div>
      <div class="flag-actions">
        ${entry.status !== 'resolved' ? `<button class="button button-accent" data-add-id="${entry.id}" type="button">Add to knowledge</button>` : '<span class="flag-decision">Resolved</span>'}
        ${entry.status === 'open' ? actionButton(entry.id, 'ignored', 'Ignore') : ''}
      </div>
    </article>
  `).join('');

  elements.list.querySelectorAll('[data-status-id]').forEach((button) => {
    button.addEventListener('click', () => updateStatus(button.dataset.statusId, button.dataset.status));
  });
  elements.list.querySelectorAll('[data-add-id]').forEach((button) => {
    button.addEventListener('click', () => openAddDialog(entries.find((entry) => String(entry.id) === button.dataset.addId)));
  });
}

function actionButton(id, status, label) {
  return `<button class="button" data-status-id="${id}" data-status="${status}" type="button">${label}</button>`;
}

async function updateStatus(id, status) {
  try {
    await request(`/api/wiki/flags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    showToast(`Flag marked ${status}.`);
    await Promise.all([loadFlags(), loadStats()]);
  } catch (error) {
    showToast(error.message, true);
  }
}

function openAddDialog(entry) {
  if (!entry) return;
  selectedFlag = entry;
  elements.addTerm.value = entry.word;
  elements.addTarget.value = 'slang';
  renderCategoryOptions('slang');
  elements.addExplanation.value = '';
  elements.addDialog.showModal();
  elements.addExplanation.focus();
}

async function addFlagToWiki(event) {
  event.preventDefault();
  if (!selectedFlag) return;
  elements.publishAdd.disabled = true;
  try {
    const target = elements.addTarget.value === 'wiki' ? 'wiki' : 'slang';
    await request(target === 'wiki' ? '/api/wiki' : '/api/slang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target === 'wiki' ? {
        term: selectedFlag.word,
        category: elements.addCategory.value,
        explanation: elements.addExplanation.value.trim()
      } : {
        term: selectedFlag.word,
        category: elements.addCategory.value,
        definition: elements.addExplanation.value.trim()
      })
    });
    elements.addDialog.close();
    showToast(`Added "${selectedFlag.word}" to ${target === 'wiki' ? 'the wiki' : 'the slang dictionary'} and resolved its flag.`);
    selectedFlag = null;
    await Promise.all([loadFlags(), loadStats()]);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.publishAdd.disabled = false;
  }
}

function renderCategoryOptions(target) {
  const options = CATEGORY_OPTIONS[target] || CATEGORY_OPTIONS.slang;
  elements.addCategory.innerHTML = options.map(([value, label]) => (
    `<option value="${value}">${label}</option>`
  )).join('');
}

async function request(url, options = {}, allowEmpty = false) {
  const response = await fetch(url, options);
  if (allowEmpty && response.ok && response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`);
  return payload;
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.className = `toast visible${isError ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { elements.toast.className = 'toast'; }, 3000);
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Unknown';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  })[character]);
}
