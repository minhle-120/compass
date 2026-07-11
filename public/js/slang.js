const state = {
  entries: [],
  selected: null,
  editingId: null,
  searchTimer: null
};

const elements = {
  search: document.getElementById('slang-search'),
  categoryFilter: document.getElementById('category-filter'),
  list: document.getElementById('entry-list'),
  count: document.getElementById('entry-count'),
  add: document.getElementById('add-entry'),
  welcome: document.getElementById('welcome-state'),
  reader: document.getElementById('reader-state'),
  editor: document.getElementById('editor-state'),
  stats: document.getElementById('slang-stats'),
  category: document.getElementById('entry-category'),
  term: document.getElementById('entry-term'),
  definition: document.getElementById('entry-definition'),
  example: document.getElementById('entry-example'),
  notes: document.getElementById('entry-notes'),
  updated: document.getElementById('entry-updated'),
  edit: document.getElementById('edit-entry'),
  remove: document.getElementById('delete-entry'),
  form: document.getElementById('entry-form'),
  editorTitle: document.getElementById('editor-title'),
  termInput: document.getElementById('term-input'),
  categoryInput: document.getElementById('category-input'),
  definitionInput: document.getElementById('definition-input'),
  exampleInput: document.getElementById('example-input'),
  notesInput: document.getElementById('notes-input'),
  characterCount: document.getElementById('character-count'),
  save: document.getElementById('save-entry'),
  cancel: document.getElementById('cancel-edit'),
  deleteDialog: document.getElementById('delete-dialog'),
  deleteCopy: document.getElementById('delete-copy'),
  toast: document.getElementById('toast')
};

elements.search.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => loadEntries(elements.search.value), 180);
});
elements.categoryFilter.addEventListener('change', () => loadEntries(elements.search.value));
elements.add.addEventListener('click', () => openEditor());
elements.edit.addEventListener('click', () => openEditor(state.selected));
elements.remove.addEventListener('click', openDeleteDialog);
elements.cancel.addEventListener('click', closeEditor);
elements.form.addEventListener('submit', saveEntry);
elements.definitionInput.addEventListener('input', updateCharacterCount);
elements.deleteDialog.addEventListener('close', () => {
  if (elements.deleteDialog.returnValue === 'confirm') deleteEntry();
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    elements.search.focus();
  }
  if (event.key === 'Escape' && !elements.editor.hidden) closeEditor();
});

await Promise.all([loadEntries(), loadStats()]);
const initialId = Number.parseInt(location.hash.slice(1), 10);
if (initialId) {
  const initialEntry = state.entries.find((entry) => entry.id === initialId);
  if (initialEntry) showEntry(initialEntry);
}

setInterval(() => {
  if (elements.editor.hidden) {
    loadEntries(elements.search.value);
    loadStats();
  }
}, 10000);

async function loadEntries(query = '') {
  elements.list.innerHTML = '<p class="list-message">Checking the slang desk...</p>';
  try {
    const category = encodeURIComponent(elements.categoryFilter.value);
    const payload = await request(`/api/slang?query=${encodeURIComponent(query)}&category=${category}&limit=500`);
    state.entries = payload.entries;
    elements.count.textContent = `${payload.total} ${payload.total === 1 ? 'entry' : 'entries'}`;
    renderList();

    if (state.selected) {
      const current = state.entries.find((entry) => entry.id === state.selected.id);
      if (current) showEntry(current);
    }
  } catch (error) {
    elements.list.innerHTML = `<p class="list-message">${escapeHtml(error.message)}</p>`;
    showToast(error.message, true);
  }
}

async function loadStats() {
  try {
    const stats = await request('/api/slang/stats');
    elements.stats.innerHTML = '';
    for (const [value, label] of [
      [stats.total, 'local entries'],
      [stats.categories.gaming, 'gaming'],
      [stats.categories.chat, 'chat'],
      [stats.categories.sensitive, 'sensitive']
    ]) {
      const chip = document.createElement('span');
      chip.className = 'stat-chip';
      chip.textContent = `${value} ${label}`;
      elements.stats.append(chip);
    }
  } catch {
    elements.stats.textContent = 'Statistics unavailable.';
  }
}

function renderList() {
  elements.list.innerHTML = '';
  if (!state.entries.length) {
    elements.list.innerHTML = '<p class="list-message">No matching slang yet. Add a local definition for this search.</p>';
    return;
  }

  state.entries.forEach((entry, index) => {
    const button = document.createElement('button');
    button.className = `entry-item${state.selected?.id === entry.id ? ' active' : ''}`;
    button.type = 'button';
    button.style.animationDelay = `${Math.min(index * 18, 180)}ms`;
    button.innerHTML = `
      <span class="entry-number">${String(index + 1).padStart(2, '0')}</span>
      <span><strong>${escapeHtml(entry.term)}</strong><small>${escapeHtml(entry.category)} / ${escapeHtml(truncate(entry.definition, 82))}</small></span>
    `;
    button.addEventListener('click', () => showEntry(entry));
    elements.list.append(button);
  });
}

function showEntry(entry) {
  state.selected = entry;
  state.editingId = null;
  elements.welcome.hidden = true;
  elements.editor.hidden = true;
  elements.reader.hidden = false;
  elements.category.textContent = entry.category;
  elements.term.textContent = entry.term;
  elements.definition.textContent = entry.definition;
  elements.example.textContent = entry.example ? `Example: ${entry.example}` : '';
  elements.notes.textContent = entry.notes ? `Notes: ${entry.notes}` : '';
  elements.updated.textContent = `Last revised ${formatDate(entry.updated_at)} / Entry ${String(entry.id).padStart(4, '0')}`;
  renderList();
  history.replaceState(null, '', `#${entry.id}`);
}

function openEditor(entry = null) {
  state.editingId = entry?.id || null;
  elements.welcome.hidden = true;
  elements.reader.hidden = true;
  elements.editor.hidden = false;
  elements.editorTitle.textContent = entry ? 'Revise slang' : 'New slang';
  elements.termInput.value = entry?.term || '';
  elements.categoryInput.value = entry?.category || 'general';
  elements.definitionInput.value = entry?.definition || '';
  elements.exampleInput.value = entry?.example || '';
  elements.notesInput.value = entry?.notes || '';
  elements.save.textContent = entry ? 'Save revision' : 'Publish entry';
  updateCharacterCount();
  elements.termInput.focus();
}

function closeEditor() {
  elements.editor.hidden = true;
  if (state.selected) {
    elements.reader.hidden = false;
  } else {
    elements.welcome.hidden = false;
  }
}

async function saveEntry(event) {
  event.preventDefault();
  elements.save.disabled = true;
  const payload = {
    term: elements.termInput.value.trim(),
    category: elements.categoryInput.value,
    definition: elements.definitionInput.value.trim(),
    example: elements.exampleInput.value.trim(),
    notes: elements.notesInput.value.trim()
  };
  const isEditing = Boolean(state.editingId);

  try {
    const entry = await request(isEditing ? `/api/slang/${state.editingId}` : '/api/slang', {
      method: isEditing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    state.selected = entry;
    showToast(isEditing ? 'Revision published.' : 'New slang published.');
    await Promise.all([loadEntries(elements.search.value), loadStats()]);
    showEntry(entry);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.save.disabled = false;
  }
}

function openDeleteDialog() {
  if (!state.selected) return;
  elements.deleteCopy.textContent = `"${state.selected.term}" will be removed from the local slang dictionary and agent search results.`;
  elements.deleteDialog.returnValue = 'cancel';
  elements.deleteDialog.showModal();
}

async function deleteEntry() {
  if (!state.selected) return;
  try {
    await request(`/api/slang/${state.selected.id}`, { method: 'DELETE' }, true);
    showToast(`Deleted "${state.selected.term}".`);
    state.selected = null;
    history.replaceState(null, '', location.pathname);
    elements.reader.hidden = true;
    elements.welcome.hidden = false;
    await Promise.all([loadEntries(elements.search.value), loadStats()]);
  } catch (error) {
    showToast(error.message, true);
  }
}

function updateCharacterCount() {
  elements.characterCount.textContent = `${elements.definitionInput.value.length.toLocaleString()} / 10,000`;
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
  showToast.timer = setTimeout(() => { elements.toast.className = 'toast'; }, 3200);
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}...` : value;
}

function formatDate(value) {
  if (!value) return 'unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  })[character]);
}
