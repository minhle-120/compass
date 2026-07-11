import { describe, expect, it } from 'vitest';
import { resolveDraftResponseMode } from '../config.js';

describe('draft response mode configuration', () => {
  it('enables automatic responses explicitly', () => {
    expect(resolveDraftResponseMode('auto_response')).toBe('auto_response');
  });

  it.each([undefined, '', 'staff_review', 'unsupported'])('defaults %s to staff review', (value) => {
    expect(resolveDraftResponseMode(value)).toBe('staff_review');
  });
});
