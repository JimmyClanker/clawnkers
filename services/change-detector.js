import { safeNum } from '../utils/math.js';
/**
 * change-detector.js — Round 24
 * Detects what changed between the current scan and the previous one.
 */


function changePct(previous, current) {
  if (previous === null || current === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function direction(pct) {
  if (pct === null) return 'unknown';
  if (pct > 0) return 'up';
  if (pct < 0) return 'down';
  return 'flat';
}

function isSignificant(pct, threshold = 10) {
  return pct !== null && Math.abs(pct) >= threshold;
}

/**
 * Detect changes between the current scan and the previous scan stored in scan_history.
 *
 * @param {object} db          - better-sqlite3 database instance
 * @param {string} projectName
 * @param {object} currentData - { rawData, scores, verdict }
 * @returns {{ has_previous: boolean, changes: Array<{metric, previous, current, change_pct, direction, significant}> }}
 */
export function detectChanges(db, projectName, currentData) {
  // Query the most recent previous scan (exclude the current one, which may not be stored yet)
  let previousRow;
  try {
    previousRow = db
      .prepare(
        'SELECT scores_json, report_json, scanned_at FROM scan_history WHERE project_name = ? ORDER BY scanned_at DESC LIMIT 1'
      )
      .get(projectName);
  } catch {
    return { has_previous: false, changes: [] };
  }

  if (!previousRow) {
    return { has_previous: false, changes: [] };
  }

  let prevScores, prevReport;
  try {
    prevScores = previousRow.scores_json ? JSON.parse(previousRow.scores_json) : null;
    prevReport = previousRow.report_json ? JSON.parse(previousRow.report_json) : null;
  } catch {
    return { has_previous: false, changes: [] };
  }

  const changes = [];

  // ── Market metrics ──────────────────────────────────────────────
  const prevMarket = prevReport?.raw_data?.market ?? {};
  const currMarket = currentData?.rawData?.market ?? {};

  const metricPairs = [
    { metric: 'price', prev: safeNum(prevMarket.current_price ?? prevMarket.price), curr: safeNum(currMarket.current_price ?? currMarket.price) },
    { metric: 'market_cap', prev: safeNum(prevMarket.market_cap), curr: safeNum(currMarket.market_cap) },
    { metric: 'volume_24h', prev: safeNum(prevMarket.total_volume ?? prevMarket.volume_24h), curr: safeNum(currMarket.total_volume ?? currMarket.volume_24h) },
  ];

  // ── Onchain metrics ─────────────────────────────────────────────
  const prevOnchain = prevReport?.raw_data?.onchain ?? {};
  const currOnchain = currentData?.rawData?.onchain ?? {};
  metricPairs.push(
    { metric: 'tvl', prev: safeNum(prevOnchain.tvl), curr: safeNum(currOnchain.tvl) },
    { metric: 'fees_7d', prev: safeNum(prevOnchain.fees_7d), curr: safeNum(currOnchain.fees_7d) },
  );

  // ── Round 17: DEX metrics ──────────────────────────────────────
  const prevDex = prevReport?.raw_data?.dex ?? {};
  const currDex = currentData?.rawData?.dex ?? {};
  metricPairs.push(
    { metric: 'dex_liquidity', prev: safeNum(prevDex.dex_liquidity_usd), curr: safeNum(currDex.dex_liquidity_usd) },
    { metric: 'dex_volume_24h', prev: safeNum(prevDex.dex_volume_24h), curr: safeNum(currDex.dex_volume_24h) },
    // Round 382 (AutoResearch): Track buy/sell ratio changes (distribution phase detection)
    { metric: 'buy_sell_ratio', prev: safeNum(prevDex.buy_sell_ratio), curr: safeNum(currDex.buy_sell_ratio) },
  );

  // Round 382 (AutoResearch): Detect wash trading risk state changes
  const prevWashRisk = prevDex?.wash_trading_risk ?? null;
  const currWashRisk = currDex?.wash_trading_risk ?? null;
  if (prevWashRisk !== currWashRisk && (prevWashRisk != null || currWashRisk != null)) {
    const WASH_SEVERITY = { high: 3, elevated: 2, low: 1, null: 0 };
    const prevSev = WASH_SEVERITY[prevWashRisk] ?? 0;
    const currSev = WASH_SEVERITY[currWashRisk] ?? 0;
    changes.push({
      metric: 'wash_trading_risk',
      previous: prevWashRisk,
      current: currWashRisk,
      change_pct: null,
      direction: currSev > prevSev ? 'worsened' : currSev < prevSev ? 'improved' : 'flat',
      significant: Math.abs(currSev - prevSev) >= 2,
    });
  }

  for (const { metric, prev, curr } of metricPairs) {
    const pct = changePct(prev, curr);
    changes.push({
      metric,
      previous: prev,
      current: curr,
      change_pct: pct !== null ? Math.round(pct * 100) / 100 : null,
      direction: direction(pct),
      significant: isSignificant(pct),
    });
  }

  // ── Score changes ───────────────────────────────────────────────
  const DIMENSIONS = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'overall'];
  for (const dim of DIMENSIONS) {
    const prevScore = safeNum(prevScores?.[dim]?.score ?? prevScores?.[dim]);
    const currScore = safeNum(currentData?.scores?.[dim]?.score ?? currentData?.scores?.[dim]);
    const pct = changePct(prevScore, currScore);
    changes.push({
      metric: `score_${dim}`,
      previous: prevScore,
      current: currScore,
      change_pct: pct !== null ? Math.round(pct * 100) / 100 : null,
      direction: direction(pct),
      significant: isSignificant(pct, 10),
    });
  }

  // ── Verdict change ──────────────────────────────────────────────
  const prevVerdict = prevReport?.verdict ?? null;
  const currVerdict = currentData?.verdict ?? null;
  changes.push({
    metric: 'verdict',
    previous: prevVerdict,
    current: currVerdict,
    change_pct: null,
    direction: prevVerdict !== currVerdict ? 'changed' : 'flat',
    significant: prevVerdict !== currVerdict,
  });

  // Round 14: compute momentum direction from the significant changes
  const significantChanges = changes.filter((c) => c.significant);
  const scoreDimChanges = significantChanges.filter((c) => c.metric.startsWith('score_'));
  const upCount = scoreDimChanges.filter((c) => c.direction === 'up').length;
  const downCount = scoreDimChanges.filter((c) => c.direction === 'down').length;
  let scoreMomentum = 'neutral';
  if (upCount > downCount + 1) scoreMomentum = 'improving';
  else if (downCount > upCount + 1) scoreMomentum = 'deteriorating';

  // Round 14: highlight if verdict changed direction (upgrade vs downgrade)
  const verdictChange = changes.find((c) => c.metric === 'verdict' && c.significant);
  const VERDICT_RANK = { 'STRONG BUY': 5, 'BUY': 4, 'HOLD': 3, 'AVOID': 2, 'STRONG AVOID': 1 };
  let verdictDirection = null;
  if (verdictChange) {
    const prevRank = VERDICT_RANK[verdictChange.previous] ?? 0;
    const currRank = VERDICT_RANK[verdictChange.current] ?? 0;
    if (currRank > prevRank) verdictDirection = 'upgrade';
    else if (currRank < prevRank) verdictDirection = 'downgrade';
  }

  // Round 74: Overall score delta (absolute, not percent)
  const prevOverallScore = safeNum(prevScores?.overall?.score ?? prevScores?.overall);
  const currOverallScore = safeNum(currentData?.scores?.overall?.score ?? currentData?.scores?.overall);
  const overallScoreDelta = prevOverallScore != null && currOverallScore != null
    ? parseFloat((currOverallScore - prevOverallScore).toFixed(2))
    : null;

  // Round 10 (AutoResearch nightly): Track red flag count changes between scans
  const prevRedFlags = Array.isArray(prevReport?.red_flags) ? prevReport.red_flags.length : 0;
  const currRedFlags = Array.isArray(currentData?.rawData?.red_flags) ? currentData.rawData.red_flags.length : 0;
  const prevCriticalFlags = Array.isArray(prevReport?.red_flags) ? prevReport.red_flags.filter((f) => f.severity === 'critical').length : 0;
  const currCriticalFlags = Array.isArray(currentData?.rawData?.red_flags) ? currentData.rawData.red_flags.filter((f) => f.severity === 'critical').length : 0;
  const flagChange = {
    metric: 'red_flag_count',
    previous: prevRedFlags,
    current: currRedFlags,
    change: currRedFlags - prevRedFlags,
    critical_change: currCriticalFlags - prevCriticalFlags,
    direction: currRedFlags < prevRedFlags ? 'improved' : currRedFlags > prevRedFlags ? 'worsened' : 'flat',
    significant: Math.abs(currRedFlags - prevRedFlags) >= 2 || Math.abs(currCriticalFlags - prevCriticalFlags) >= 1,
  };
  changes.push(flagChange);

  // Round 47 (AutoResearch): velocity_acceleration — compare this delta to the previous delta
  // Positive acceleration = score improving faster; negative = losing momentum
  let velocityAcceleration = null;
  let accelerationLabel = 'stable';
  try {
    const rows = db.prepare(
      "SELECT scores_json FROM scan_history WHERE project_name = ? ORDER BY scanned_at DESC LIMIT 3"
    ).all(currentData.projectName ?? currentData.project_name ?? '');
    if (rows.length >= 3) {
      const s0 = safeNum(JSON.parse(rows[0].scores_json ?? '{}')?.overall?.score);
      const s1 = safeNum(JSON.parse(rows[1].scores_json ?? '{}')?.overall?.score);
      const s2 = safeNum(JSON.parse(rows[2].scores_json ?? '{}')?.overall?.score);
      if (s0 != null && s1 != null && s2 != null) {
        const delta1 = s0 - s1; // most recent change
        const delta2 = s1 - s2; // prior change
        velocityAcceleration = parseFloat((delta1 - delta2).toFixed(2));
        if (velocityAcceleration > 0.3) accelerationLabel = 'accelerating';
        else if (velocityAcceleration < -0.3) accelerationLabel = 'decelerating';
      }
    }
  } catch { /* db query failed — skip */ }

  return {
    has_previous: true,
    previous_scan_at: previousRow.scanned_at,
    changes,
    significant_changes: significantChanges,
    score_momentum: scoreMomentum,
    verdict_direction: verdictDirection,
    overall_score_delta: overallScoreDelta,
    velocity_acceleration: velocityAcceleration,
    acceleration_label: accelerationLabel,
    flag_change: flagChange,
  };
}
