import { config } from '../../src/config.js';

export async function fetchJson(url, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A Fetch API implementation is required.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.remoteRequestTimeoutMs);

  try {
    const response = await fetchImpl(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CompassGameSupport/1.0 (remote knowledge lookup)'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Remote knowledge request failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error.info || payload.error.message || payload.error.code);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
