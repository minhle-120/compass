import { beforeEach, describe, expect, it } from 'vitest';

process.env.WIKI_DB_PATH = ':memory:';

import {
  createWikiEntry,
  deleteWikiEntry,
  deleteUnknownWord,
  flagUnknownWord,
  getWikiEntry,
  getUnknownWord,
  importWikiEntries,
  initWikiDb,
  listUnknownWords,
  searchWikiEntries,
  updateUnknownWordStatus,
  updateWikiEntry
} from '../wikiService.js';
import { downloadValorantTerminology, parseTerminologyHtml } from '../importer.js';

describe('Local wiki service', () => {
  beforeEach(() => {
    const db = initWikiDb();
    db.prepare('DELETE FROM wiki_entries').run();
    db.prepare('DELETE FROM unknown_words').run();
  });

  it('creates, searches, updates, and deletes an entry', () => {
    const created = createWikiEntry({ term: 'One tap', explanation: 'A kill with one bullet to the head.', category: 'mechanic' });
    expect(searchWikiEntries('one bullet')[0].id).toBe(created.id);

    const updated = updateWikiEntry(created.id, { term: 'One-tap', explanation: 'A one-shot headshot kill.', category: 'weapon' });
    expect(updated.origin).toBe('manual');
    expect(updated.category).toBe('weapon');
    expect(getWikiEntry(created.id).term).toBe('One-tap');

    expect(deleteWikiEntry(created.id)).toBe(true);
    expect(getWikiEntry(created.id)).toBeNull();
  });

  it('does not overwrite a locally edited entry during source import', () => {
    const created = createWikiEntry({ term: 'Ace', explanation: 'Local editorial explanation.' });
    const result = importWikiEntries([
      { term: 'Ace', explanation: 'Source explanation.' },
      { term: 'Clutch', explanation: 'Winning as the last player alive.' }
    ]);

    expect(result.preserved).toBe(1);
    expect(result.added).toBe(1);
    expect(getWikiEntry(created.id).explanation).toBe('Local editorial explanation.');
  });

  it('parses text-only term explanations from MediaWiki HTML', () => {
    const entries = parseTerminologyHtml(`
      <table><tr><th>Term</th><th>Explanation</th></tr>
      <tr><td><b>Eco</b></td><td>A round where a team saves credits.</td></tr></table>
      <dl><dt>Heaven</dt><dd>A high map position.</dd></dl>
    `);

    expect(entries).toEqual([
      { term: 'Eco', explanation: 'A round where a team saves credits.' },
      { term: 'Heaven', explanation: 'A high map position.' }
    ]);
  });

  it('downloads the rendered public page before trying the blocked Action API', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => (
      `<tr><td>Term ${index}</td><td>Explanation ${index}</td></tr>`
    )).join('');
    const requestedUrls = [];
    const result = await downloadValorantTerminology({
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        return {
          ok: true,
          status: 200,
          text: async () => `<table>${rows}</table>`
        };
      }
    });

    expect(result.method).toBe('rendered_page');
    expect(result.entries).toHaveLength(20);
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain('/en-us/Terminology');
  });

  it('groups repeated unknown words and resolves them when a definition is added', () => {
    const first = flagUnknownWord({
      word: 'Glorp!',
      context: 'That enemy is glorp.',
      reason: 'No dictionary result.',
      ticketId: 'T-ONE'
    });
    const repeated = flagUnknownWord({
      word: 'glorp',
      context: 'This weapon feels glorp.',
      ticketId: 'T-TWO'
    });

    expect(repeated.id).toBe(first.id);
    expect(repeated.occurrence_count).toBe(2);
    expect(repeated.latest_ticket_id).toBe('T-TWO');
    expect(listUnknownWords({ status: 'open' }).total).toBe(1);
    expect(listUnknownWords({ status: 'all' }).total).toBe(1);

    expect(updateUnknownWordStatus(first.id, 'ignored').status).toBe('ignored');
    createWikiEntry({ term: 'Glorp', explanation: 'A newly documented term.', category: 'mechanic' });
    expect(getUnknownWord(first.id).status).toBe('resolved');

    expect(deleteUnknownWord(first.id)).toBe(true);
    expect(getUnknownWord(first.id)).toBeNull();
  });

  it('rejects an unknown word without review context', () => {
    expect(() => flagUnknownWord({ word: 'glorp', context: '   ' }))
      .toThrow('Context is required.');
  });
});
