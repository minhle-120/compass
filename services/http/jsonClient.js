import { config } from '../../src/config.js';

export async function fetchJson(url, options = {}) {
  const response = await request(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers
    }
  });

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.info || payload.error.message || payload.error.code);
  }

  return payload;
}

export async function fetchText(url, options = {}) {
  const response = await request(url, {
    ...options,
    headers: {
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      ...options.headers
    }
  });
  return response.text();
}

async function request(url, { fetchImpl = globalThis.fetch, headers = {} } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A Fetch API implementation is required.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.remoteRequestTimeoutMs);

  try {
    const response = await fetchImpl(url.toString(), {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Mozilla/5.0 (compatible; CompassWikiImporter/1.0; +http://localhost)',
        ...headers
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Knowledge provider request failed with HTTP ${response.status}.`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
