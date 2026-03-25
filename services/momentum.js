/**
 * momentum.js — Round 19
 * Computes momentum direction for each scoring dimension.
 */

function safeN(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/**
 * Determine momentum direction given two values (current vs reference).
 * @param {number|null} current
 * @param {number|null} previous
 * @param {number} threshold - minimum delta to be considered improving/declining
 * @returns {'improving'|'stable'|'declining'}
 */
function direction(current, previous, threshold = 0.3) {
  if (current == null || previous == null) return 'stable';
  const delta = current - previous;
  if (delta > threshold) return 'improving';
  if (delta < -threshold) return 'declining';
  return 'stable';
}

/**
 * Calculate momentum indicators for each scoring dimension.
 *
 * @param {object} rawData         - current scan raw collector data
 * @param {object|null} previousScanData - previous scan raw data (optional)
 * @returns {object} { market, onchain, social, development, tokenomics, overall }
 */
export function calculateMomentum(rawData = {}, previousScanData = null) {
  const market     = rawData.market     ?? {};
  const onchain    = rawData.onchain    ?? {};
  const social     = rawData.social     ?? {};
  const github     = rawData.github     ?? {};
  const tokenomics = rawData.tokenomics ?? {};

  const prev = previousScanData ?? {};
  const pm   = prev.market     ?? {};
  const po   = prev.onchain    ?? {};
  const ps   = prev.social     ?? {};
  const pg   = prev.github     ?? {};
  const pt   = prev.tokenomics ?? {};

  // ── Market: 7d vs 30d price change direction ──────────────────────────────
  const change7d  = safeN(market.price_change_pct_7d);
  const change30d = safeN(market.price_change_pct_30d);
  let marketMomentum;
  if (change7d != null && change30d != null) {
    // If recent 7d is stronger than 30d context, momentum improving
    marketMomentum = direction(change7d, change30d, 2);
  } else if (previousScanData) {
    const prevScore = safeN(pm.price_change_pct_24h);
    const currScore = safeN(market.price_change_pct_24h);
    marketMomentum = direction(currScore, prevScore, 1);
  } else {
    marketMomentum = change7d != null
      ? (change7d > 2 ? 'improving' : change7d < -2 ? 'declining' : 'stable')
      : 'stable';
  }

  // ── Onchain: TVL 7d vs 30d ────────────────────────────────────────────────
  const tvl7d  = safeN(onchain.tvl_change_7d);
  const tvl30d = safeN(onchain.tvl_change_30d);
  let onchainMomentum;
  if (tvl7d != null && tvl30d != null) {
    onchainMomentum = direction(tvl7d, tvl30d, 3);
  } else if (previousScanData) {
    onchainMomentum = direction(safeN(onchain.tvl_change_7d), safeN(po.tvl_change_7d), 3);
  } else {
    onchainMomentum = tvl7d != null
      ? (tvl7d > 3 ? 'improving' : tvl7d < -3 ? 'declining' : 'stable')
      : 'stable';
  }

  // ── Social: sentiment trend ───────────────────────────────────────────────
  const currSentiment = safeN(social.sentiment_score);
  const prevSentiment = previousScanData ? safeN(ps.sentiment_score) : null;
  const socialMomentum = direction(currSentiment, prevSentiment, 0.1);

  // ── Development: use commit_trend directly ────────────────────────────────
  const commitTrend = github.commit_trend;
  let devMomentum;
  if (commitTrend === 'accelerating') devMomentum = 'improving';
  else if (commitTrend === 'decelerating' || commitTrend === 'inactive') devMomentum = 'declining';
  else if (previousScanData) {
    devMomentum = direction(safeN(github.commits_30d), safeN(pg.commits_30d), 2);
  } else {
    devMomentum = 'stable';
  }

  // ── Tokenomics: circulating supply trend (more circulating = healthier) ───
  const currCirc = safeN(tokenomics.pct_circulating);
  const prevCirc = previousScanData ? safeN(pt.pct_circulating) : null;
  const tokenomicsMomentum = direction(currCirc, prevCirc, 1);

  // ── Overall: majority vote ────────────────────────────────────────────────
  const dims = [marketMomentum, onchainMomentum, socialMomentum, devMomentum, tokenomicsMomentum];
  const improving = dims.filter((d) => d === 'improving').length;
  const declining = dims.filter((d) => d === 'declining').length;
  const overallMomentum = improving > declining + 1
    ? 'improving'
    : declining > improving + 1
      ? 'declining'
      : 'stable';

  return {
    market:     { direction: marketMomentum },
    onchain:    { direction: onchainMomentum },
    social:     { direction: socialMomentum },
    development: { direction: devMomentum },
    tokenomics: { direction: tokenomicsMomentum },
    overall:    { direction: overallMomentum },
  };
}
