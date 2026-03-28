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

    // Round 382 (AutoResearch): Fetch only recent 90-day window to prevent stale data drift
    // Historical data older than 90 days may not reflect current market conditions
    // Falls back to all-time history if recent window has < MIN_HISTORY points
    let rows;
    try {
      const recentRows = db.prepare(
        "SELECT score FROM score_history WHERE dimension = ? AND created_at > datetime('now', '-90 days')"
      ).all(dim);
      rows = recentRows.length >= MIN_HISTORY ? recentRows
        : db.prepare('SELECT score FROM score_history WHERE dimension = ?').all(dim);
    } catch {
      try {
        rows = db.prepare('SELECT score FROM score_history WHERE dimension = ?').all(dim);
      } catch {
        // Table doesn't exist yet — return raw
        calibrated[dim] = { raw: rawScore, z_score: null, calibrated: false };
        continue;
      }
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

  // Round 384 (AutoResearch batch): Add calibration quality score
  // Measures how reliable the calibration is based on n, stddev, and coverage
  const calibrationQuality = (() => {
    if (calibratedDims.length === 0) return { score: 0, label: 'uncalibrated' };
    const avgN = calibratedDims.reduce((s, c) => s + (c.n ?? 0), 0) / calibratedDims.length;
    const coverage = calibratedDims.length / DIMENSIONS.length;
    // More data points = more reliable; full coverage = better
    const nScore = Math.min(50, (avgN / 100) * 50); // 0-50 based on data quantity
    const coverageScore = coverage * 30;             // 0-30 based on coverage
    const outlierPenalty = outliers * 5;             // -5 per outlier dimension
    const qualityScore = Math.max(0, Math.min(100, Math.round(nScore + coverageScore + 20 - outlierPenalty)));
    const label = qualityScore >= 70 ? 'high' : qualityScore >= 40 ? 'moderate' : 'low';
    return { score: qualityScore, label, avg_n: Math.round(avgN) };
  })();

  // Round 700 (AutoResearch batch): Composite score_rank — percentile of overall score vs historical
  // Users care "is this score high or low vs what we normally see?" — a percentile answers that clearly
  let overallPercentile = null;
  let overallScoreRank = null;
  try {
    const overallVal = typeof rawScores?.overall === 'object' ? rawScores.overall.score : rawScores?.overall;
    if (overallVal != null) {
      const allOverall = db.prepare(
        "SELECT score FROM score_history WHERE dimension = 'overall' ORDER BY created_at DESC LIMIT 500"
      ).all().map((r) => r.score).filter(Number.isFinite);
      if (allOverall.length >= MIN_HISTORY) {
        const below = allOverall.filter((s) => s < overallVal).length;
        overallPercentile = Math.round((below / allOverall.length) * 100);
        overallScoreRank = overallPercentile >= 80 ? 'top_20pct'
          : overallPercentile >= 60 ? 'above_median'
          : overallPercentile >= 40 ? 'median'
          : overallPercentile >= 20 ? 'below_median'
          : 'bottom_20pct';
      }
    }
  } catch { /* ignore if table not ready */ }

  return {
    scores: rawScores,
    calibrated,
    summary: {
      avg_z_score: avgZScore != null ? parseFloat(avgZScore.toFixed(3)) : null,
      outlier_dimensions: outliers,
      calibration_coverage: `${calibratedDims.length}/${DIMENSIONS.length}`,
      has_full_calibration: calibratedDims.length === DIMENSIONS.length,
      calibration_quality: calibrationQuality,
      // Round 700: overall score percentile rank
      overall_percentile: overallPercentile,
      overall_score_rank: overallScoreRank,
    },
  };
}
