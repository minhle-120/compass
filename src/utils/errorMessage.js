export function errorMessage(error, fallback = 'Unknown error') {
  const candidates = [
    error?.response?.data?.error?.message,
    error?.message,
    error
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === 'object') {
      try {
        const serialized = JSON.stringify(candidate);
        if (serialized && serialized !== '{}') return serialized;
      } catch {}
    }
  }
  return fallback;
}
