/**
 * score-calibration.js — Round 16
 * Provides z-score calibration for scan scores using historical data.
 */

const DIMENSIONS = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'distribution', 'risk'];
const MIN_HISTORY = 10;

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr, avg) {
  const m = avg ?? mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Compute z-scores for all dimensions using historical score data.
 * Returns raw scores unchanged if fewer than MIN_HISTORY data points exist.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} rawScores - calculateScores() result
 * @returns {object} { scores: rawScores, calibrated: { dimension: { raw, z_score, percentile_approx } } }
 */
export function calibrateScores(db, rawScores) {
  const calibrated = {};

  for (const dim of DIMENSIONS) {
    const val = rawScores[dim];
    if (val == null) continue;
    const rawScore = typeof val === 'object' ? val.score : val;

    // Fetch all historical scores for this dimension
    let rows;
    try {
      rows = db.prepare('SELECT score FROM score_history WHERE dimension = ?').all(dim);
    } catch {
      // Table doesn't exist yet — return raw
      calibrated[dim] = { raw: rawScore, z_score: null, calibrated: false };
      continue;
    }

    if (rows.length < MIN_HISTORY) {
      calibrated[dim] = { raw: rawScore, z_score: null, calibrated: false, reason: `only ${rows.length} historical points` };
      continue;
    }

    const scores = rows.map((r) => r.score);
    const avg = mean(scores);
    const sd  = stddev(scores, avg);
    const zScore = sd > 0 ? (rawScore - avg) / sd : 0;

    calibrated[dim] = {
      raw: rawScore,
      z_score: parseFloat(zScore.toFixed(3)),
      mean: parseFloat(avg.toFixed(3)),
      stddev: parseFloat(sd.toFixed(3)),
      n: rows.length,
      calibrated: true,
    };
  }

  return { scores: rawScores, calibrated };
}
