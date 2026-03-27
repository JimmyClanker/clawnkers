// utils/math.js — shared numeric utilities

/**
 * Sanitize numeric values — replace NaN/Infinity with fallback.
 * @param {*} value - input value
 * @param {number|null} [fallback=0] - fallback value when not finite
 * @returns {number|null}
 */
export function safeNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Like safeNumber but returns null instead of a fallback when the value is
 * absent or non-finite.  Use where a missing value must be distinguishable
 * from zero (e.g. scoring conditionals).
 * Round 380 (AutoResearch): Added to reduce "safeNumber(x) !== null" workarounds.
 * @param {*} value
 * @returns {number|null}
 */
export function safeNum(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clamp a number between min and max (inclusive).
 * Round 380 (AutoResearch): Centralises repeated Math.min/Math.max pattern.
 * @param {*} value - input value
 * @param {number} min - minimum bound
 * @param {number} max - maximum bound
 * @returns {number} clamped value (defaults to min if not finite)
 */
export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Round 382 (AutoResearch): Normalize a value to a 0-100 score given min/max range.
 * Useful for converting raw metrics into normalized index scores.
 * @param {number} value - raw value
 * @param {number} min - minimum expected value
 * @param {number} max - maximum expected value
 * @param {boolean} [invert=false] - if true, lower value = higher score (e.g. for risk metrics)
 * @returns {number} 0-100 score
 */
export function normalizeToScore(value, min, max, invert = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || max <= min) return 50;
  const clamped = Math.max(min, Math.min(max, n));
  const normalized = (clamped - min) / (max - min);
  const score = Math.round((invert ? 1 - normalized : normalized) * 100);
  return Math.max(0, Math.min(100, score));
}

/**
 * Round 382 (AutoResearch): Weighted average with optional null-field skipping.
 * Ignores null/undefined/NaN entries and rebalances weights automatically.
 * @param {Array<{value: number|null, weight: number}>} items
 * @returns {number|null} weighted average, or null if no valid entries
 */
export function weightedAvg(items) {
  const valid = items.filter(({ value }) => value != null && Number.isFinite(Number(value)));
  if (valid.length === 0) return null;
  const totalWeight = valid.reduce((s, { weight }) => s + (Number(weight) || 0), 0);
  if (totalWeight === 0) return null;
  return valid.reduce((s, { value, weight }) => s + Number(value) * (Number(weight) / totalWeight), 0);
}
