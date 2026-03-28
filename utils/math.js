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

/**
 * Round 95 (AutoResearch): Sigmoid normalization for smooth S-curve score mapping.
 * Useful for converting raw metrics to scores where linear scaling creates hard cliffs.
 *
 * Returns a value in [0, 1]:
 *   - At x == center: returns 0.5
 *   - steepness controls how fast the curve transitions (higher = sharper transition)
 *   - Use invert=true for metrics where lower is better
 *
 * @param {number} x - input value
 * @param {number} center - the midpoint (where output = 0.5)
 * @param {number} steepness - controls curve sharpness (default 1.0)
 * @param {boolean} invert - if true, inverts the output (lower x = higher output)
 * @returns {number} value in [0, 1]
 */
export function sigmoidNormalize(x, center, steepness = 1.0, invert = false) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0.5;
  const sig = 1 / (1 + Math.exp(-steepness * (n - center) / (Math.abs(center) || 1)));
  return invert ? 1 - sig : sig;
}

/**
 * Round 700 (AutoResearch batch): Format a 1-10 score to a human-readable quality label.
 * Useful for generating natural language score descriptions.
 * @param {number} score - 1-10 score value
 * @param {string} [dimension] - optional dimension name for context
 * @returns {string} quality label
 */
export function scoreToLabel(score, dimension = '') {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'unknown';
  if (n >= 8.5) return 'exceptional';
  if (n >= 7.0) return 'strong';
  if (n >= 5.5) return 'moderate';
  if (n >= 4.0) return 'weak';
  if (n >= 2.5) return 'poor';
  return 'critical';
}

/**
 * Round 700 (AutoResearch batch): Compute a quick composite health score (0-100) from scores object.
 * Useful for lightweight comparison without full scoring pipeline.
 * @param {object} scores - calculateScores() output
 * @returns {number} 0-100 health index
 */
export function quickHealthIndex(scores = {}) {
  const dims = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'distribution', 'risk'];
  const values = dims.map((d) => Number(scores?.[d]?.score ?? 5)).filter(Number.isFinite);
  if (values.length === 0) return 50;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  // Normalize 1-10 → 0-100
  return Math.round(((avg - 1) / 9) * 100);
}
