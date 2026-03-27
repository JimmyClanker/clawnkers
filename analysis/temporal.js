/**
 * temporal.js — Round 4: Temporal Analysis
 *
 * Compares current scan vs previous scans of the same project.
 * Detects trends, improvements, and degradation over time.
 */

import { safeNum } from '../utils/math.js';

function pctChange(prev, curr) {
  if (prev === null || curr === null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function trendDir(pct) {
  if (pct === null) return 'unknown';
  if (pct > 5) return 'improving';
  if (pct < -5) return 'declining';
  return 'stable';
}

/**
 * Analyze temporal delta between current and previous scan(s).
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {string} projectName
 * @param {object} currentRawData - current scan rawData
 * @param {object} currentScores - current scan scores
 * @returns {object|null} temporal_delta or null if no history
 */
export function analyzeTemporalDelta(db, projectName, currentRawData, currentScores) {
  if (!db) return null;

  let rows;
  try {
    rows = db.prepare(
      'SELECT scores_json, report_json, scanned_at FROM scan_history WHERE project_name = ? ORDER BY scanned_at DESC LIMIT 5'
    ).all(projectName);
  } catch {
    return null;
  }

  if (!rows || rows.length === 0) {
    return { has_history: false, scan_count: 0, deltas: [] };
  }

  // Parse the most recent previous scan
  let prevScores, prevReport;
  try {
    prevScores = rows[0].scores_json ? JSON.parse(rows[0].scores_json) : null;
    prevReport = rows[0].report_json ? JSON.parse(rows[0].report_json) : null;
  } catch {
    return { has_history: false, scan_count: rows.length, deltas: [] };
  }

  const prevRawData = prevReport?.raw_data ?? {};
  const prevMarket = prevRawData?.market ?? {};
  const prevOnchain = prevRawData?.onchain ?? {};
  const prevSocial = prevRawData?.social ?? {};

  const currMarket = currentRawData?.market ?? {};
  const currOnchain = currentRawData?.onchain ?? {};
  const currSocial = currentRawData?.social ?? {};

  // Build metric deltas
  const deltas = [];

  const prevDex = prevReport?.raw_data?.dex ?? {};
  const currDex = currentRawData?.dex ?? {};

  const metricPairs = [
    { metric: 'price', prev: safeNum(prevMarket.current_price ?? prevMarket.price), curr: safeNum(currMarket.current_price ?? currMarket.price), unit: '$' },
    { metric: 'market_cap', prev: safeNum(prevMarket.market_cap), curr: safeNum(currMarket.market_cap), unit: '$' },
    { metric: 'tvl', prev: safeNum(prevOnchain.tvl), curr: safeNum(currOnchain.tvl), unit: '$' },
    { metric: 'volume_24h', prev: safeNum(prevMarket.total_volume), curr: safeNum(currMarket.total_volume), unit: '$' },
    { metric: 'fees_7d', prev: safeNum(prevOnchain.fees_7d), curr: safeNum(currOnchain.fees_7d), unit: '$' },
    { metric: 'social_mentions', prev: safeNum(prevSocial.filtered_mentions ?? prevSocial.mentions), curr: safeNum(currSocial.filtered_mentions ?? currSocial.mentions), unit: '' },
    // Round 237 (AutoResearch nightly): new engagement metrics in temporal tracking
    { metric: 'holder_engagement_score', prev: safeNum(prevMarket.holder_engagement_score), curr: safeNum(currMarket.holder_engagement_score), unit: '' },
    { metric: 'dex_liquidity', prev: safeNum(prevDex.dex_liquidity_usd), curr: safeNum(currDex.dex_liquidity_usd), unit: '$' },
    { metric: 'reddit_activity_score', prev: safeNum(prevReport?.raw_data?.reddit?.reddit_activity_score), curr: safeNum(currentRawData?.reddit?.reddit_activity_score), unit: '' },
    // Round 382 (AutoResearch): add wash trading risk and article quality to temporal tracking
    { metric: 'github_commits_90d', prev: safeNum(prevReport?.raw_data?.github?.commits_90d), curr: safeNum(currentRawData?.github?.commits_90d), unit: '' },
    { metric: 'revenue_7d', prev: safeNum(prevOnchain.revenue_7d), curr: safeNum(currOnchain.revenue_7d), unit: '$' },
    { metric: 'buy_sell_ratio', prev: safeNum(prevDex.buy_sell_ratio), curr: safeNum(currDex.buy_sell_ratio), unit: '' },
  ];

  for (const { metric, prev, curr, unit } of metricPairs) {
    const change = pctChange(prev, curr);
    deltas.push({
      metric,
      previous: prev,
      current: curr,
      change_pct: change !== null ? parseFloat(change.toFixed(1)) : null,
      trend: trendDir(change),
      unit,
    });
  }

  // Score deltas
  const DIMS = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'distribution', 'risk', 'overall'];
  const scoreDeltas = [];
  for (const dim of DIMS) {
    const prev = safeNum(prevScores?.[dim]?.score ?? prevScores?.[dim]);
    const curr = safeNum(currentScores?.[dim]?.score ?? currentScores?.[dim]);
    const delta = prev !== null && curr !== null ? parseFloat((curr - prev).toFixed(2)) : null;
    scoreDeltas.push({
      dimension: dim,
      previous: prev,
      current: curr,
      delta,
      trend: delta !== null ? (delta > 0.3 ? 'improving' : delta < -0.3 ? 'declining' : 'stable') : 'unknown',
    });
  }

  // Red flag analysis
  const prevRedFlags = Array.isArray(prevReport?.red_flags) ? prevReport.red_flags : [];
  const currRedFlags = Array.isArray(currentRawData?.red_flags) ? currentRawData.red_flags : [];
  const prevFlagKeys = new Set(prevRedFlags.map(f => f.flag));
  const currFlagKeys = new Set(currRedFlags.map(f => f.flag));
  const newFlags = currRedFlags.filter(f => !prevFlagKeys.has(f.flag));
  const resolvedFlags = prevRedFlags.filter(f => !currFlagKeys.has(f.flag));

  // Verdict change
  const prevVerdict = prevReport?.verdict ?? null;
  const currVerdict = null; // not yet available at enrichment time, will be filled post-LLM

  // Time between scans
  const prevScanAt = rows[0].scanned_at;
  const hoursSinceLastScan = prevScanAt
    ? (Date.now() - new Date(prevScanAt).getTime()) / (1000 * 60 * 60)
    : null;

  // Generate narrative summary
  const narrativeParts = [];
  const significantMetrics = deltas.filter(d => d.change_pct !== null && Math.abs(d.change_pct) >= 10);
  if (significantMetrics.length > 0) {
    for (const d of significantMetrics) {
      const dir = d.change_pct > 0 ? 'grew' : 'declined';
      narrativeParts.push(`${d.metric} ${dir} ${Math.abs(d.change_pct).toFixed(1)}% since last scan`);
    }
  }
  if (newFlags.length > 0) {
    narrativeParts.push(`${newFlags.length} new red flag(s) emerged: ${newFlags.map(f => f.flag).join(', ')}`);
  }
  if (resolvedFlags.length > 0) {
    narrativeParts.push(`${resolvedFlags.length} red flag(s) resolved: ${resolvedFlags.map(f => f.flag).join(', ')}`);
  }

  const overallScoreDelta = scoreDeltas.find(d => d.dimension === 'overall');
  if (overallScoreDelta?.delta !== null && Math.abs(overallScoreDelta.delta) >= 0.5) {
    const dir = overallScoreDelta.delta > 0 ? 'improved' : 'dropped';
    narrativeParts.push(`Overall score ${dir} by ${Math.abs(overallScoreDelta.delta).toFixed(1)} points`);
  }

  return {
    has_history: true,
    scan_count: rows.length,
    previous_scan_at: prevScanAt,
    hours_since_last_scan: hoursSinceLastScan !== null ? parseFloat(hoursSinceLastScan.toFixed(1)) : null,
    deltas,
    score_deltas: scoreDeltas,
    new_red_flags: newFlags,
    resolved_red_flags: resolvedFlags,
    previous_verdict: prevVerdict,
    narrative: narrativeParts.length > 0
      ? narrativeParts.join('. ') + '.'
      : 'No significant changes since last scan.',
  };
}
