/**
 * fear-greed.js — Round 384 (AutoResearch batch)
 * Collects the Crypto Fear & Greed Index from alternative.me (free, no API key).
 * Provides macro sentiment context for scoring calibration.
 */
import { fetchJson } from './fetch.js';

const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=7&format=json';

// Round 106 (AutoResearch): in-memory cache for fear/greed index (refreshes once per hour)
// Fear & Greed changes slowly (updates once daily) — no need to re-fetch for every project scan
let cachedResult = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 3600000; // 1 hour

/**
 * @returns {{ value: number, classification: string, value_7d_avg: number|null, trend: string|null, error: string|null }}
 */
export async function collectFearGreed() {
  // Return cached result if fresh
  if (cachedResult && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedResult;
  }
  try {
    const data = await fetchJson(FEAR_GREED_URL, { timeoutMs: 8000 });
    const entries = data?.data;
    if (!Array.isArray(entries) || entries.length === 0) {
      return { value: null, classification: null, value_7d_avg: null, trend: null, error: 'No data returned' };
    }

    const latest = entries[0];
    const value = parseInt(latest?.value ?? '0', 10);
    const classification = latest?.value_classification || null;

    // 7-day average
    const vals = entries.map(e => parseInt(e?.value ?? '0', 10)).filter(Number.isFinite);
    const value_7d_avg = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;

    // Trend: compare today vs 7d avg
    let trend = null;
    if (value_7d_avg != null) {
      if (value > value_7d_avg + 5) trend = 'improving';
      else if (value < value_7d_avg - 5) trend = 'declining';
      else trend = 'stable';
    }

    const result = { value, classification, value_7d_avg, trend, error: null };
    // Cache the result
    cachedResult = result;
    cacheTimestamp = Date.now();
    return result;
  } catch (err) {
    const errorResult = { value: null, classification: null, value_7d_avg: null, trend: null, error: err.message };
    // Don't cache errors (retry on next call)
    return errorResult;
  }
}
