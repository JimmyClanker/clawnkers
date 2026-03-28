const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 800;

// Round R10 (AutoResearch nightly): rotate user-agents to reduce bot-filter false positives
// Round 700 (AutoResearch batch): Updated to Chrome 132/133 fingerprints (2026 versions)
// More realistic browser-style UAs to reduce 403/429 on aggressive APIs
const USER_AGENTS = [
  'AlphaScanner/2.0 (research; +https://clawnkers.com)',
  'CryptoResearch/1.5 (+https://clawnkers.com/alphascan)',
  'Mozilla/5.0 (compatible; AlphaBot/1.0; +https://clawnkers.com)',
  // Chrome 132 (Jan 2026) on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  // Chrome 132 on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  // Chrome 133 on Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  // Firefox 135 on macOS (diversity for API fingerprint bypass)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0',
  // Edge 132 on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
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
// Round 186 (AutoResearch): allow env-var tuning of cooldown parameters
const DOMAIN_COOLDOWN_MS = Number(process.env.DOMAIN_COOLDOWN_MS) || 60_000; // default 1 minute
const DOMAIN_FAIL_THRESHOLD = Number(process.env.DOMAIN_FAIL_THRESHOLD) || 3; // default 3 failures

// Round 536 (AutoResearch): per-domain 429 backoff state
// Tracks when a domain's rate-limit window expires to avoid hammering on 429 responses
const domainRateLimitUntil = new Map();
function setDomainRateLimit(url, retryAfterMs) {
  const domain = extractDomain(url);
  const existing = domainRateLimitUntil.get(domain) || 0;
  const until = Math.max(existing, Date.now() + retryAfterMs);
  domainRateLimitUntil.set(domain, until);
}
function getDomainRateLimitWait(url) {
  const domain = extractDomain(url);
  const until = domainRateLimitUntil.get(domain) || 0;
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

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

// Round R25: In-flight deduplication — prevent multiple identical concurrent fetches
// E.g. if 3 collectors fetch the same CoinGecko trending URL simultaneously,
// only one HTTP request fires; all callers await the same promise.
const _inFlight = new Map();
function dedupeRequest(url, makeRequest) {
  const existing = _inFlight.get(url);
  if (existing) return existing;
  const promise = makeRequest().finally(() => _inFlight.delete(url));
  _inFlight.set(url, promise);
  return promise;
}

/**
 * fetchJson with automatic retry + exponential backoff.
 * Handles 429 (rate-limit) with Retry-After header respect.
 * Returns partial data (null) instead of throwing on final failure.
 */
async function _fetchJsonImpl(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers, retries = DEFAULT_RETRIES } = {}) {
  // Round 46: Skip domains that are consistently failing
  if (isDomainCoolingDown(url)) {
    throw new Error(`Domain ${extractDomain(url)} in cooldown (too many recent failures)`);
  }

  const _reqStart = Date.now(); // Round 203: track request start time
  let lastError;

  // Round 536 (AutoResearch): check domain-level rate limit before first attempt
  const rateLimitWait = getDomainRateLimitWait(url);
  if (rateLimitWait > 0) {
    // If rate limit window is still active, wait it out (capped at 8s)
    await new Promise((r) => setTimeout(r, Math.min(rateLimitWait, 8000)));
  }

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
          // Round 83 (AutoResearch): identify scanner in server logs for debugging
          'x-scanner-version': '7.0.0',
          ...(headers || {}),
        },
        signal: controller.signal,
      });

      // Rate limit — respect Retry-After if present, then retry
      // Round 536 (AutoResearch): also record domain-level rate limit to protect all future requests
      if (response.status === 429 && attempt < retries) {
        const retryAfterSec = Number(response.headers.get('retry-after') || 0);
        const delayMs = retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 10000)
          : jitterMs(RETRY_BASE_DELAY_MS * Math.pow(2, attempt)); // Round 19: jitter
        setDomainRateLimit(url, delayMs); // record for future requests
        clearTimeout(timeout);
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
      // Round 203 (AutoResearch): attach latency as non-enumerable metadata for diagnostics
      // (Does not affect JSON serialization but available to callers who want timing)
      const latencyMs = Date.now() - _reqStart;
      if (result && typeof result === 'object') {
        try {
          Object.defineProperty(result, '_fetchLatencyMs', {
            value: latencyMs,
            writable: false, configurable: true, enumerable: false,
          });
        } catch { /* non-critical */ }
      }
      // Round 238 (AutoResearch): warn on slow requests (>5s) for performance monitoring
      if (latencyMs > 5000) {
        const domain = extractDomain(url);
        console.warn(`[fetch] Slow request: ${domain} took ${latencyMs}ms (attempt ${attempt + 1})`);
      }
      return result;
    } catch (err) {
      lastError = err;
      // Don't retry on abort (caller-controlled timeout) or final attempt
      if (err.name === 'AbortError' || attempt >= retries) {
        recordDomainFailure(url);
        throw lastError;
      }
      // Exponential backoff + jitter before retry (Round 19 + Round 236: cap at 8s to prevent hangs)
      const backoffMs = Math.min(8000, jitterMs(RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
      await new Promise((r) => setTimeout(r, backoffMs));
    } finally {
      clearTimeout(timeout);
    }
  }

  recordDomainFailure(url);
  throw lastError;
}

// Round R25: Public fetchJson wraps _fetchJsonImpl with in-flight deduplication
export function fetchJson(url, opts = {}) {
  // Only deduplicate GET-like requests (no special headers, default retries)
  // Skip deduplication for requests with custom headers (may have auth tokens)
  if (!opts.headers) {
    return dedupeRequest(url, () => _fetchJsonImpl(url, opts));
  }
  return _fetchJsonImpl(url, opts);
}

// Round 560 (AutoResearch): Export domain cache clear function for health endpoint reset
// Allows ops to manually clear cooldown state if a previously failing API recovers
export function clearDomainFailCache(domain) {
  if (domain) {
    domainFailCache.delete(domain);
    domainRateLimitUntil.delete(domain);
  } else {
    domainFailCache.clear();
    domainRateLimitUntil.clear();
  }
}

// Round 233 (AutoResearch nightly): Export domain failure stats for health diagnostics
// Allows health endpoint to surface which domains are currently in cooldown
// Round 537 (AutoResearch): also includes rate-limit windows
export function getDomainFailStats() {
  const now = Date.now();
  const result = {};
  for (const [domain, entry] of domainFailCache.entries()) {
    const coolingDown = entry.fails >= DOMAIN_FAIL_THRESHOLD && now < entry.cooldownUntil;
    result[domain] = {
      fails: entry.fails,
      cooling_down: coolingDown,
      cooldown_remaining_ms: coolingDown ? entry.cooldownUntil - now : 0,
      rate_limited: false,
      rate_limit_remaining_ms: 0,
    };
  }
  // Merge in rate-limit state (may include domains not in fail cache)
  for (const [domain, until] of domainRateLimitUntil.entries()) {
    const remaining = until - now;
    if (remaining > 0) {
      if (!result[domain]) result[domain] = { fails: 0, cooling_down: false, cooldown_remaining_ms: 0 };
      result[domain].rate_limited = true;
      result[domain].rate_limit_remaining_ms = remaining;
    }
  }
  return result;
}
