const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 800;

// Round 4 (AutoResearch batch): rotate user-agents to reduce bot-filter false positives
const USER_AGENTS = [
  'AlphaScanner/2.0 (research; +https://clawnkers.com)',
  'CryptoResearch/1.5 (+https://clawnkers.com/alphascan)',
  'Mozilla/5.0 (compatible; AlphaBot/1.0; +https://clawnkers.com)',
];
let _uaIdx = 0;
function nextUserAgent() {
  const ua = USER_AGENTS[_uaIdx % USER_AGENTS.length];
  _uaIdx++;
  return ua;
}

// Round 46: Simple in-memory negative cache to avoid hammering APIs that consistently fail
// Key: url domain, Value: { fails: number, cooldownUntil: number }
const domainFailCache = new Map();
const DOMAIN_COOLDOWN_MS = 60_000; // 1 minute cooldown after 3 consecutive failures
const DOMAIN_FAIL_THRESHOLD = 3;

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function isDomainCoolingDown(url) {
  const domain = extractDomain(url);
  const entry = domainFailCache.get(domain);
  if (!entry) return false;
  if (entry.fails >= DOMAIN_FAIL_THRESHOLD && Date.now() < entry.cooldownUntil) return true;
  if (Date.now() >= entry.cooldownUntil) domainFailCache.delete(domain); // expired
  return false;
}

function recordDomainFailure(url) {
  const domain = extractDomain(url);
  const entry = domainFailCache.get(domain) || { fails: 0, cooldownUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= DOMAIN_FAIL_THRESHOLD) {
    entry.cooldownUntil = Date.now() + DOMAIN_COOLDOWN_MS;
  }
  domainFailCache.set(domain, entry);
}

function recordDomainSuccess(url) {
  const domain = extractDomain(url);
  domainFailCache.delete(domain); // clear on success
}

// Round 19: Add ±25% jitter to retry backoff to reduce thundering herd on shared APIs
function jitterMs(baseMs) {
  return Math.round(baseMs * (0.75 + Math.random() * 0.5));
}

/**
 * fetchJson with automatic retry + exponential backoff.
 * Handles 429 (rate-limit) with Retry-After header respect.
 * Returns partial data (null) instead of throwing on final failure.
 */
export async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers, retries = DEFAULT_RETRIES } = {}) {
  // Round 46: Skip domains that are consistently failing
  if (isDomainCoolingDown(url)) {
    throw new Error(`Domain ${extractDomain(url)} in cooldown (too many recent failures)`);
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': nextUserAgent(),
          // Round 13: prevent CDN/proxy from serving stale data
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          ...(headers || {}),
        },
        signal: controller.signal,
      });

      // Rate limit — respect Retry-After if present, then retry
      if (response.status === 429 && attempt < retries) {
        const retryAfterSec = Number(response.headers.get('retry-after') || 0);
        const delayMs = retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 10000)
          : jitterMs(RETRY_BASE_DELAY_MS * Math.pow(2, attempt)); // Round 19: jitter
        await new Promise((r) => setTimeout(r, delayMs));
        lastError = new Error(`HTTP 429 rate-limited for ${url}`);
        continue;
      }

      if (!response.ok) {
        // Round 42 (AutoResearch): include status text and truncated URL for cleaner debug logs
        const statusText = response.statusText || '';
        const urlHint = url.length > 120 ? url.slice(0, 80) + '…' + url.slice(-20) : url;
        throw new Error(`HTTP ${response.status}${statusText ? ` ${statusText}` : ''} — ${urlHint}`);
      }

      const result = await response.json();
      recordDomainSuccess(url); // clear failure counter on success
      return result;
    } catch (err) {
      lastError = err;
      // Don't retry on abort (caller-controlled timeout) or final attempt
      if (err.name === 'AbortError' || attempt >= retries) {
        recordDomainFailure(url);
        throw lastError;
      }
      // Exponential backoff + jitter before retry (Round 19)
      await new Promise((r) => setTimeout(r, jitterMs(RETRY_BASE_DELAY_MS * Math.pow(2, attempt))));
    } finally {
      clearTimeout(timeout);
    }
  }

  recordDomainFailure(url);
  throw lastError;
}
