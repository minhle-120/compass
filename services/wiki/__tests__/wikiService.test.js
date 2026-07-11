import { beforeEach, describe, expect, it } from 'vitest';

process.env.WIKI_DB_PATH = ':memory:';

import {
  createWikiEntry,
  deleteWikiEntry,
  getWikiEntry,
  importWikiEntries,
  initWikiDb,
  searchWikiEntries,
  updateWikiEntry
} from '../wikiService.js';
import { downloadValorantTerminology, parseTerminologyHtml } from '../importer.js';

describe('Local wiki service', () => {
  beforeEach(() => {
    initWikiDb().prepare('DELETE FROM wiki_entries').run();
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
});
