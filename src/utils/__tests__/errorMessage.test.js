import { describe, expect, it } from 'vitest';

import { errorMessage } from '../errorMessage.js';

describe('errorMessage', () => {
  it('preserves normal Error messages', () => {
    expect(errorMessage(new Error('Model failed'))).toBe('Model failed');
  });

  it('serializes object-shaped provider messages instead of returning object Object', () => {
    expect(errorMessage({ message: { code: 'bad_request', detail: 'Invalid payload' } }))
      .toBe('{"code":"bad_request","detail":"Invalid payload"}');
  });
});
