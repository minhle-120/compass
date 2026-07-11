import { describe, expect, it } from 'vitest';
import { resolveDraftResponseMode, resolveOptionalTemperature } from '../config.js';

describe('draft response mode configuration', () => {
  it('enables automatic responses explicitly', () => {
    expect(resolveDraftResponseMode('auto_response')).toBe('auto_response');
  });

  it.each([undefined, '', 'staff_review', 'unsupported'])('defaults %s to staff review', (value) => {
    expect(resolveDraftResponseMode(value)).toBe('staff_review');
  });
});

describe('LLM temperature configuration', () => {
  it.each([undefined, null, ''])('omits temperature when unset as %s', (value) => {
    expect(resolveOptionalTemperature(value)).toBeNull();
  });

  it.each([
    ['0', 0],
    ['0.2', 0.2],
    ['1', 1],
    [2, 2]
  ])('accepts %s as a valid temperature', (value, expected) => {
    expect(resolveOptionalTemperature(value)).toBe(expected);
  });

  it.each(['nope', '-0.1', '2.1'])('rejects invalid temperature %s', (value) => {
    expect(() => resolveOptionalTemperature(value)).toThrow('LLM_TEMPERATURE');
  });
});
