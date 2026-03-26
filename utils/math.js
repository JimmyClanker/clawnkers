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
