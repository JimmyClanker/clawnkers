/**
 * change-detector.js — Round 24
 * Detects what changed between the current scan and the previous one.
 */

function safeN(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

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
    { metric: 'price', prev: safeN(prevMarket.current_price ?? prevMarket.price), curr: safeN(currMarket.current_price ?? currMarket.price) },
    { metric: 'market_cap', prev: safeN(prevMarket.market_cap), curr: safeN(currMarket.market_cap) },
    { metric: 'volume_24h', prev: safeN(prevMarket.total_volume ?? prevMarket.volume_24h), curr: safeN(currMarket.total_volume ?? currMarket.volume_24h) },
  ];

  // ── Onchain metrics ─────────────────────────────────────────────
  const prevOnchain = prevReport?.raw_data?.onchain ?? {};
  const currOnchain = currentData?.rawData?.onchain ?? {};
  metricPairs.push(
    { metric: 'tvl', prev: safeN(prevOnchain.tvl), curr: safeN(currOnchain.tvl) },
    { metric: 'fees_7d', prev: safeN(prevOnchain.fees_7d), curr: safeN(currOnchain.fees_7d) },
  );

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
    const prevScore = safeN(prevScores?.[dim]?.score ?? prevScores?.[dim]);
    const currScore = safeN(currentData?.scores?.[dim]?.score ?? currentData?.scores?.[dim]);
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

  return {
    has_previous: true,
    previous_scan_at: previousRow.scanned_at,
    changes,
    significant_changes: changes.filter((c) => c.significant),
  };
}
