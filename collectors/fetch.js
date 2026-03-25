const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 800;

/**
 * fetchJson with automatic retry + exponential backoff.
 * Handles 429 (rate-limit) with Retry-After header respect.
 * Returns partial data (null) instead of throwing on final failure.
 */
export async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers, retries = DEFAULT_RETRIES } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'AlphaScanner/1.0',
          ...(headers || {}),
        },
        signal: controller.signal,
      });

      // Rate limit — respect Retry-After if present, then retry
      if (response.status === 429 && attempt < retries) {
        const retryAfterSec = Number(response.headers.get('retry-after') || 0);
        const delayMs = retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 10000)
          : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
        lastError = new Error(`HTTP 429 rate-limited for ${url}`);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return await response.json();
    } catch (err) {
      lastError = err;
      // Don't retry on abort (caller-controlled timeout) or final attempt
      if (err.name === 'AbortError' || attempt >= retries) throw lastError;
      // Exponential backoff before retry
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}
