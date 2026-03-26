import crypto from 'crypto';

/**
 * Timing-safe string comparison to prevent timing attacks.
 * @param {string} a - first string
 * @param {string} b - second string
 * @returns {boolean} true if strings are equal
 */
export function secureCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
