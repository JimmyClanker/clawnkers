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

  // Round 233 (AutoResearch nightly): Add score_tier to each calibrated dimension
  // Lets consumers quickly see "is this dimension exceptional, normal, or below-average?"
  for (const dim of Object.keys(calibrated)) {
    const c = calibrated[dim];
    if (!c?.calibrated || c.z_score == null) continue;
    const z = c.z_score;
    c.score_tier = z >= 2.0 ? 'exceptional'
      : z >= 1.0 ? 'above_average'
      : z >= -1.0 ? 'average'
      : z >= -2.0 ? 'below_average'
      : 'poor';
    // Round 236 (AutoResearch): add 95% confidence interval for the raw score
    // CI = raw ± 1.96 * stddev / sqrt(n) — tighter CI = more reliable calibration
    if (c.stddev != null && c.n != null && c.n > 0) {
      const margin = 1.96 * c.stddev / Math.sqrt(c.n);
      c.confidence_interval_95 = {
        low: parseFloat((c.raw - margin).toFixed(3)),
        high: parseFloat((c.raw + margin).toFixed(3)),
        margin: parseFloat(margin.toFixed(3)),
      };
    }
  }

  // Round 17 (AutoResearch nightly): Add calibration summary — overall z-score and outlier detection
  const calibratedDims = Object.values(calibrated).filter((c) => c.calibrated && c.z_score != null);
  const avgZScore = calibratedDims.length > 0
    ? calibratedDims.reduce((s, c) => s + c.z_score, 0) / calibratedDims.length
    : null;
  const outliers = calibratedDims.filter((c) => Math.abs(c.z_score) > 2).length;

  return {
    scores: rawScores,
    calibrated,
    summary: {
      avg_z_score: avgZScore != null ? parseFloat(avgZScore.toFixed(3)) : null,
      outlier_dimensions: outliers,
      calibration_coverage: `${calibratedDims.length}/${DIMENSIONS.length}`,
      has_full_calibration: calibratedDims.length === DIMENSIONS.length,
    },
  };
}
