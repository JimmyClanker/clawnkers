/**
 * metrics.js — Accuracy metrics for the scoring engine
 *
 * Calculates hit rates, Spearman correlation, circuit breaker protection,
 * and other calibration stats from the calibration database.
 */

import { getCalibrationDb } from './db.js';

// ── Spearman rank correlation helpers ──────────────────────────────────────

function toRanks(arr) {
  const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  for (let i = 0; i < sorted.length; i++) ranks[sorted[i].i] = i + 1;
  return ranks;
}

function spearmanRank(x, y) {
  const n = x.length;
  if (n < 5) return null;
  const rankX = toRanks(x);
  const rankY = toRanks(y);
  let d2sum = 0;
  for (let i = 0; i < n; i++) d2sum += (rankX[i] - rankY[i]) ** 2;
  return 1 - (6 * d2sum) / (n * (n * n - 1));
}

// ── Sub-functions ──────────────────────────────────────────────────────────

function getCoverageStats(db) {
  const totalTokens = db.prepare('SELECT COUNT(*) AS n FROM token_universe WHERE active = 1').get().n;
  const totalSnapshots = db.prepare('SELECT COUNT(*) AS n FROM token_snapshots').get().n;
  const totalWithOutcomes = db.prepare(`
    SELECT COUNT(DISTINCT snapshot_id) AS n FROM token_outcomes
  `).get().n;

  // Date range and avg snapshots/day
  const dateRange = db.prepare(`
    SELECT
      MIN(snapshot_at) AS first_at,
      MAX(snapshot_at) AS last_at
    FROM token_snapshots
  `).get();

  let snapshotsPerDay = null;
  if (dateRange && dateRange.first_at && dateRange.last_at) {
    const firstMs = new Date(dateRange.first_at).getTime();
    const lastMs = new Date(dateRange.last_at).getTime();
    const daysDiff = Math.max((lastMs - firstMs) / (1000 * 60 * 60 * 24), 1);
    snapshotsPerDay = +(totalSnapshots / daysDiff).toFixed(2);
  }

  return {
    total_tokens: totalTokens,
    total_snapshots: totalSnapshots,
    total_with_outcomes: totalWithOutcomes,
    snapshots_per_day: snapshotsPerDay,
    first_snapshot_at: dateRange?.first_at ?? null,
    last_snapshot_at: dateRange?.last_at ?? null,
  };
}

function getHitRates(db) {
  // Join token_scores with token_outcomes for 30d forward
  const rows = db.prepare(`
    SELECT
      sc.verdict,
      o.relative_return_pct
    FROM token_scores sc
    JOIN token_outcomes o ON o.snapshot_id = sc.snapshot_id
    WHERE o.days_forward = 30
      AND sc.verdict IS NOT NULL
      AND o.relative_return_pct IS NOT NULL
  `).all();

  const buyRows = rows.filter(r => r.verdict.includes('BUY') && !r.verdict.includes('AVOID'));
  const avoidRows = rows.filter(r => r.verdict.includes('AVOID'));
  const holdRows = rows.filter(r => r.verdict === 'HOLD' || r.verdict === 'NEUTRAL');

  const totalCount = rows.length;

  if (totalCount < 10) {
    return {
      status: 'insufficient_data',
      count: totalCount,
      min_required: 10,
    };
  }

  const buyHits = buyRows.filter(r => r.relative_return_pct > 0).length;
  const avoidHits = avoidRows.filter(r => r.relative_return_pct < 0).length;

  return {
    buy_hit_rate: buyRows.length > 0 ? +(buyHits / buyRows.length).toFixed(4) : null,
    buy_count: buyRows.length,
    avoid_hit_rate: avoidRows.length > 0 ? +(avoidHits / avoidRows.length).toFixed(4) : null,
    avoid_count: avoidRows.length,
    hold_count: holdRows.length,
    total_count: totalCount,
  };
}

function getScoreCorrelation(db) {
  const rows = db.prepare(`
    SELECT
      sc.overall_score,
      o.relative_return_pct
    FROM token_scores sc
    JOIN token_outcomes o ON o.snapshot_id = sc.snapshot_id
    WHERE o.days_forward = 30
      AND sc.overall_score IS NOT NULL
      AND o.relative_return_pct IS NOT NULL
  `).all();

  if (rows.length < 5) {
    return {
      status: 'insufficient_data',
      count: rows.length,
      min_required: 5,
    };
  }

  const scores = rows.map(r => r.overall_score);
  const returns = rows.map(r => r.relative_return_pct);
  const rho = spearmanRank(scores, returns);

  let interpretation = 'none';
  if (rho !== null) {
    const abs = Math.abs(rho);
    if (abs >= 0.7) interpretation = 'strong';
    else if (abs >= 0.4) interpretation = 'moderate';
    else if (abs >= 0.2) interpretation = 'weak';
    else interpretation = 'negligible';
  }

  return {
    spearman_rho: rho !== null ? +rho.toFixed(4) : null,
    interpretation,
    count: rows.length,
  };
}

function getBreakerProtection(db) {
  // Snapshots with circuit breakers active
  const breakerRows = db.prepare(`
    SELECT
      sc.snapshot_id,
      sc.circuit_breakers_json,
      o.return_pct
    FROM token_scores sc
    LEFT JOIN token_outcomes o ON o.snapshot_id = sc.snapshot_id AND o.days_forward = 30
    WHERE sc.circuit_breakers_json IS NOT NULL
      AND sc.circuit_breakers_json != ''
      AND sc.circuit_breakers_json != '[]'
      AND sc.circuit_breakers_json != '{}'
  `).all();

  if (breakerRows.length === 0) {
    return {
      status: 'insufficient_data',
      count: 0,
      min_required: 1,
    };
  }

  // Of those with outcomes: how many actually lost > 20%?
  const withOutcomes = breakerRows.filter(r => r.return_pct !== null && r.return_pct !== undefined);
  const actuallyLost = withOutcomes.filter(r => r.return_pct < -20);

  return {
    total_with_breaker: breakerRows.length,
    with_outcomes: withOutcomes.length,
    actually_lost_20pct: actuallyLost.length,
    protection_rate: withOutcomes.length > 0
      ? +(actuallyLost.length / withOutcomes.length).toFixed(4)
      : null,
  };
}

function getCategoryPerformance(db) {
  const rows = db.prepare(`
    SELECT
      sc.category,
      sc.overall_score,
      sc.verdict,
      o.relative_return_pct
    FROM token_scores sc
    JOIN token_outcomes o ON o.snapshot_id = sc.snapshot_id
    WHERE o.days_forward = 30
      AND sc.category IS NOT NULL
      AND sc.overall_score IS NOT NULL
      AND o.relative_return_pct IS NOT NULL
  `).all();

  // Group by category
  const groups = {};
  for (const row of rows) {
    if (!groups[row.category]) groups[row.category] = [];
    groups[row.category].push(row);
  }

  const result = [];
  for (const [category, items] of Object.entries(groups)) {
    if (items.length < 5) continue;

    const avgScore = items.reduce((s, r) => s + r.overall_score, 0) / items.length;
    const avgReturn = items.reduce((s, r) => s + r.relative_return_pct, 0) / items.length;

    const buyItems = items.filter(r => r.verdict && r.verdict.includes('BUY') && !r.verdict.includes('AVOID'));
    const avoidItems = items.filter(r => r.verdict && r.verdict.includes('AVOID'));
    const buyHits = buyItems.filter(r => r.relative_return_pct > 0).length;
    const avoidHits = avoidItems.filter(r => r.relative_return_pct < 0).length;

    const totalDirectional = buyItems.length + avoidItems.length;
    const totalHits = buyHits + avoidHits;
    const hitRate = totalDirectional > 0 ? +(totalHits / totalDirectional).toFixed(4) : null;

    result.push({
      category,
      count: items.length,
      avg_score: +avgScore.toFixed(2),
      avg_relative_return: +avgReturn.toFixed(2),
      hit_rate: hitRate,
    });
  }

  // Sort by count descending
  result.sort((a, b) => b.count - a.count);
  return result;
}

function getVerdictDistribution(db) {
  const rows = db.prepare(`
    SELECT verdict, COUNT(*) AS count
    FROM token_scores
    WHERE verdict IS NOT NULL
    GROUP BY verdict
    ORDER BY count DESC
  `).all();

  const distribution = {};
  for (const row of rows) {
    distribution[row.verdict] = row.count;
  }

  return distribution;
}

function getRecentScans(db, limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const rows = db.prepare(`
    SELECT
      sc.snapshot_id,
      s.project_name,
      s.snapshot_at,
      sc.overall_score,
      sc.verdict,
      sc.category,
      sc.confidence,
      s.price,
      s.price_change_24h
    FROM token_scores sc
    JOIN token_snapshots s ON s.id = sc.snapshot_id
    ORDER BY s.snapshot_at DESC
    LIMIT ?
  `).all(safeLimit);

  return rows;
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Calcola le metriche di accuratezza del sistema.
 * Ritorna un oggetto con tutte le metriche disponibili.
 * Se non ci sono abbastanza dati, le metriche sono null con status "insufficient_data".
 *
 * @param {import('better-sqlite3').Database} [dbOverride] - optional DB for testing
 */
export function calculateMetrics(dbOverride) {
  const db = dbOverride || getCalibrationDb();

  return {
    generated_at: new Date().toISOString(),
    coverage: getCoverageStats(db),
    hit_rates: getHitRates(db),
    correlation: getScoreCorrelation(db),
    breaker_protection: getBreakerProtection(db),
    category_performance: getCategoryPerformance(db),
    verdict_distribution: getVerdictDistribution(db),
    recent_scans: getRecentScans(db, 20),
  };
}

// Export helpers for testing
export { spearmanRank, toRanks };
