import { describe, it, expect, beforeEach } from 'vitest';

// Use in-memory SQLite for testing
process.env.DB_PATH = ':memory:';

import { initDb } from '../../database/sqlite.js';
import { handler as querySlang } from '../query_slang_dictionary.js';
import { handler as searchKB } from '../search_knowledge_base.js';
import { handler as getKB } from '../get_knowledge_base_article.js';

describe('Slang & Knowledge Base Tools', () => {
  let mainDb;

  beforeEach(() => {
    // Initialize main database in-memory (including tickets, kb_articles, and slang tables)
    mainDb = initDb();
    
    // Clear tables
    mainDb.prepare('DELETE FROM tickets').run();
    mainDb.prepare('DELETE FROM kb_articles').run();
    mainDb.prepare('DELETE FROM slang').run();

    // Seed unified slang data
    const insert = mainDb.prepare(`
      INSERT INTO slang (slang, description, example, context, source)
      VALUES (?, ?, ?, ?, ?)
    `);
    insert.run('lit', 'Very exciting or excellent', 'That match was lit', 'General chat', 'genz');
    insert.run('Heaven', 'High vantage point on map', 'Enemy sniper in heaven', 'Map Callouts', 'game');
    insert.run('Clutch', 'Winning a round as the last survivor', 'Carl clutched the 1v3', 'Gameplay terms', 'game');
  });

  describe('query_slang_dictionary', () => {
    it('should return correct explanation for Gen-Z slang', async () => {
      const result = await querySlang({ term: 'lit' }, {});
      expect(result).toContain('[Gen-Z Slang]');
      expect(result).toContain('lit: Very exciting or excellent');
      expect(result).toContain('Example: That match was lit');
    });

    it('should return correct explanation for gaming terminology', async () => {
      const result = await querySlang({ term: 'heaven' }, {});
      expect(result).toContain('[Gaming Term]');
      expect(result).toContain('Heaven: High vantage point on map');
    });

    it('should return not found message for unknown terms', async () => {
      const result = await querySlang({ term: 'nonexistent_term' }, {});
      expect(result).toBe('No slang definition found for "nonexistent_term".');
    });
  });

  describe('search_knowledge_base', () => {
    it('should search merged slang/game terms successfully', async () => {
      const res = await searchKB({ query: 'clutch round' }, {});
      expect(res.total_matches).toBeGreaterThan(0);
      expect(res.results[0].title).toBe('Clutch');
      expect(res.results[0].source).toBe('game_terminology');
    });

    it('should search FAQ articles in main DB as well', async () => {
      // Seed an article in primary DB
      mainDb.exec(`
        INSERT INTO kb_articles (id, title, summary, content)
        VALUES ('faq-1', 'Billing Issues', 'FAQ about double charges', 'If double charged, route to payment team.')
      `);

      const res = await searchKB({ query: 'Billing Double' }, {});
      expect(res.total_matches).toBeGreaterThan(0);
      const article = res.results.find(r => r.article_id === 'faq-1');
      expect(article).toBeDefined();
      expect(article.title).toBe('Billing Issues');
      expect(article.source).toBe('knowledge_base_article');
    });
  });

  describe('get_knowledge_base_article', () => {
    it('should retrieve full reference knowledge details', async () => {
      // Find the actual ID of the inserted term 'lit'
      const row = mainDb.prepare("SELECT id FROM slang WHERE slang = 'lit'").get();
      
      const res = await getKB({ article_id: `slang:${row.id}` }, {});
      expect(res.found).toBe(true);
      expect(res.title).toBe('lit');
      expect(res.source).toBe('genz_slang');
      expect(res.content).toContain('Very exciting or excellent');
    });

    it('should retrieve full FAQ article details from main DB', async () => {
      mainDb.exec(`
        INSERT INTO kb_articles (id, title, summary, content)
        VALUES ('faq-login', 'Login Issues', 'Login FAQ', 'Try restarting app.')
      `);

      const res = await getKB({ article_id: 'faq-login' }, {});
      expect(res.found).toBe(true);
      expect(res.title).toBe('Login Issues');
      expect(res.content).toBe('Try restarting app.');
    });

    it('should return not found for nonexistent article_id', async () => {
      const res = await getKB({ article_id: 'nonexistent-id' }, {});
      expect(res.found).toBe(false);
    });
  });
});
