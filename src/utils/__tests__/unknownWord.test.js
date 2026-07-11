import { describe, expect, it } from 'vitest';

import { hasExactKnowledgeMatch, normalizeUnknownWord } from '../unknownWord.js';

describe('unknown-word matching', () => {
  it('normalizes casing, surrounding punctuation, and whitespace', () => {
    expect(normalizeUnknownWord('  "Glorp!"  ')).toBe('glorp');
    expect(normalizeUnknownWord('two   words')).toBe('two words');
  });

  it('accepts only an exact normalized result title', () => {
    const result = {
      total_matches: 2,
      results: [
        { title: 'Glorping' },
        { title: 'A guide whose explanation mentions glorp' }
      ]
    };

    expect(hasExactKnowledgeMatch(result, 'glorp')).toBe(false);
    expect(hasExactKnowledgeMatch({ results: [{ title: 'Glorp!' }] }, 'glorp')).toBe(true);
  });
});
