import { safeNum } from '../utils/math.js';
/**
 * momentum.js — Round 19
 * Computes momentum direction for each scoring dimension.
 */


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
  const change7d  = safeNum(market.price_change_pct_7d);
  const change30d = safeNum(market.price_change_pct_30d);
  let marketMomentum;
  if (change7d != null && change30d != null) {
    // If recent 7d is stronger than 30d context, momentum improving
    marketMomentum = direction(change7d, change30d, 2);
  } else if (previousScanData) {
    const prevScore = safeNum(pm.price_change_pct_24h);
    const currScore = safeNum(market.price_change_pct_24h);
    marketMomentum = direction(currScore, prevScore, 1);
  } else {
    marketMomentum = change7d != null
      ? (change7d > 2 ? 'improving' : change7d < -2 ? 'declining' : 'stable')
      : 'stable';
  }

  // ── Onchain: TVL 7d vs 30d ────────────────────────────────────────────────
  const tvl7d  = safeNum(onchain.tvl_change_7d);
  const tvl30d = safeNum(onchain.tvl_change_30d);
  let onchainMomentum;
  if (tvl7d != null && tvl30d != null) {
    onchainMomentum = direction(tvl7d, tvl30d, 3);
  } else if (previousScanData) {
    onchainMomentum = direction(safeNum(onchain.tvl_change_7d), safeNum(po.tvl_change_7d), 3);
  } else {
    onchainMomentum = tvl7d != null
      ? (tvl7d > 3 ? 'improving' : tvl7d < -3 ? 'declining' : 'stable')
      : 'stable';
  }

  // ── Social: sentiment trend ───────────────────────────────────────────────
  const currSentiment = safeNum(social.sentiment_score);
  const prevSentiment = previousScanData ? safeNum(ps.sentiment_score) : null;
  let socialMomentum = direction(currSentiment, prevSentiment, 0.1);
  // Round 383 (AutoResearch): supplement social momentum with Reddit sentiment_momentum
  // Reddit provides a within-week acceleration/deceleration signal not captured by Exa sentiment
  const redditSentMom = rawData?.reddit?.sentiment_momentum;
  if (redditSentMom === 'improving' && socialMomentum !== 'improving') {
    socialMomentum = 'improving'; // Reddit acceleration upgrades stable → improving
  } else if (redditSentMom === 'degrading' && socialMomentum !== 'declining') {
    socialMomentum = 'declining'; // Reddit deceleration downgrades stable → declining
  }

  // ── Development: use commit_trend directly ────────────────────────────────
  const commitTrend = github.commit_trend;
  let devMomentum;
  if (commitTrend === 'accelerating') devMomentum = 'improving';
  else if (commitTrend === 'decelerating' || commitTrend === 'inactive') devMomentum = 'declining';
  else if (previousScanData) {
    devMomentum = direction(safeNum(github.commits_30d), safeNum(pg.commits_30d), 2);
  } else {
    devMomentum = 'stable';
  }

  // ── Tokenomics: circulating supply trend (more circulating = healthier) ───
  const currCirc = safeNum(tokenomics.pct_circulating);
  const prevCirc = previousScanData ? safeNum(pt.pct_circulating) : null;
  const tokenomicsMomentum = direction(currCirc, prevCirc, 1);

  // ── Round 19: DEX liquidity trend ────────────────────────────────────────
  const dex = rawData.dex ?? {};
  const pd  = (prev.dex ?? {});
  const currDexLiq = safeNum(dex.dex_liquidity_usd);
  const prevDexLiq = previousScanData ? safeNum(pd.dex_liquidity_usd) : null;
  // Also use 24h price change direction from DEX as signal when no prev scan
  let dexMomentum;
  if (currDexLiq != null && prevDexLiq != null) {
    dexMomentum = direction(currDexLiq, prevDexLiq, currDexLiq * 0.05); // 5% threshold
  } else {
    const dexChange24h = safeNum(dex.dex_price_change_h24);
    dexMomentum = dexChange24h != null
      ? (dexChange24h > 2 ? 'improving' : dexChange24h < -2 ? 'declining' : 'stable')
      : 'stable';
  }

  // ── Round 61: Social velocity — compare current mentions to expected baseline ─
  const currentMentions = safeNum(social.filtered_mentions ?? social.mentions);
  const prevMentions = previousScanData ? safeNum(ps.filtered_mentions ?? ps.mentions) : null;
  let socialVelocity = null;
  if (currentMentions != null && prevMentions != null && prevMentions > 0) {
    const velocityPct = ((currentMentions - prevMentions) / prevMentions) * 100;
    socialVelocity = parseFloat(velocityPct.toFixed(1));
  }

  // ── Overall: majority vote ────────────────────────────────────────────────
  const dims = [marketMomentum, onchainMomentum, socialMomentum, devMomentum, tokenomicsMomentum, dexMomentum];
  const improving = dims.filter((d) => d === 'improving').length;
  const declining = dims.filter((d) => d === 'declining').length;
  const overallMomentum = improving > declining + 1
    ? 'improving'
    : declining > improving + 1
      ? 'declining'
      : 'stable';

  // Round 25 (AutoResearch nightly): Price-volume divergence signal
  // High volume + neutral/down price = potential accumulation (bullish divergence)
  // Low volume + up price = potential fake rally (bearish divergence)
  const m = rawData.market ?? {};
  const mcap = safeNum(m.market_cap);
  const vol24h = safeNum(m.total_volume);
  const c24h = safeNum(m.price_change_pct_24h);
  let priceVolDivergence = 'none';
  if (mcap > 0 && vol24h > 0 && c24h !== null) {
    const volMcapRatio = vol24h / mcap;
    if (volMcapRatio > 0.25 && Math.abs(c24h) < 3) {
      priceVolDivergence = 'bullish_accumulation'; // High vol, flat price = silent accumulation
    } else if (volMcapRatio < 0.02 && c24h > 5) {
      priceVolDivergence = 'bearish_low_vol_rally'; // Low vol rally = fragile, not conviction
    } else if (volMcapRatio > 0.3 && c24h < -5) {
      priceVolDivergence = 'panic_selling'; // High vol dump
    }
  }

  // Round 57 (AutoResearch): momentum_alignment_score — 0-100 measuring how many dims are aligned
  // All improving = 100, all declining = 0, mixed = proportional
  const dimDirections = [marketMomentum, onchainMomentum, socialMomentum, devMomentum, tokenomicsMomentum, dexMomentum];
  const improvingCount = dimDirections.filter((d) => d === 'improving').length;
  const decliningCount = dimDirections.filter((d) => d === 'declining').length;
  const totalDims = dimDirections.length;
  const momentumAlignmentScore = Math.round((improvingCount / totalDims) * 100);
  const momentumAlignmentLabel = improvingCount > decliningCount * 2 ? 'strongly_bullish'
    : improvingCount > decliningCount ? 'mildly_bullish'
    : decliningCount > improvingCount * 2 ? 'strongly_bearish'
    : decliningCount > improvingCount ? 'mildly_bearish'
    : 'neutral';

  // Round 453: momentum_score (0-100) — weighted composite replacing binary improving/declining
  // Weights: market (25) + onchain (20) + social (15) + dev (15) + dex (15) + tokenomics (10)
  const dimWeights = { market: 25, onchain: 20, social: 15, development: 15, dex: 15, tokenomics: 10 };
  const dimDirs = {
    market: marketMomentum, onchain: onchainMomentum, social: socialMomentum,
    development: devMomentum, dex: dexMomentum, tokenomics: tokenomicsMomentum,
  };
  let momentumScore = 0;
  for (const [dim, dir] of Object.entries(dimDirs)) {
    const weight = dimWeights[dim] ?? 10;
    if (dir === 'improving') momentumScore += weight;
    else if (dir === 'stable') momentumScore += weight * 0.5;
    // declining = 0
  }
  momentumScore = Math.round(momentumScore);
  const momentumScoreLabel = momentumScore >= 75 ? 'strongly_bullish'
    : momentumScore >= 55 ? 'bullish'
    : momentumScore >= 40 ? 'neutral'
    : momentumScore >= 25 ? 'bearish'
    : 'strongly_bearish';

  // Round 700 (AutoResearch batch): Fear & Greed macro context adjustment
  // When F&G is extreme (>80 greed or <20 fear), it signals macro regime that affects all token momentum
  // This is a cross-asset signal — not project-specific, but contextualizes the momentum reading
  const fearGreed = rawData.fear_greed ?? {};
  const fgValue = safeNum(fearGreed.value ?? null);
  let macroMomentumOverlay = 'neutral';
  if (fgValue != null) {
    if (fgValue >= 75) macroMomentumOverlay = 'extreme_greed';      // Risky — market overbought
    else if (fgValue >= 60) macroMomentumOverlay = 'greed';         // Cautious optimism
    else if (fgValue <= 20) macroMomentumOverlay = 'extreme_fear';  // Potential buy zone
    else if (fgValue <= 40) macroMomentumOverlay = 'fear';          // Negative macro sentiment
    else macroMomentumOverlay = 'neutral';
  }

  // Momentum score adjustment for macro context
  // In extreme greed: discount positive momentum signals (overbought risk)
  // In extreme fear: discount negative momentum signals (oversold opportunity)
  let macroBiasAdj = 0;
  if (macroMomentumOverlay === 'extreme_greed') macroBiasAdj = -5;   // Caution in euphoria
  else if (macroMomentumOverlay === 'extreme_fear') macroBiasAdj = +5; // Opportunity in panic
  const momentumScoreAdjusted = Math.max(0, Math.min(100, momentumScore + macroBiasAdj));

  return {
    market:     { direction: marketMomentum },
    onchain:    { direction: onchainMomentum },
    social:     { direction: socialMomentum, velocity_pct: socialVelocity },
    development: { direction: devMomentum },
    tokenomics: { direction: tokenomicsMomentum },
    dex:        { direction: dexMomentum },
    overall:    { direction: overallMomentum },
    macro_momentum_overlay: macroMomentumOverlay,
    fear_greed_value: fgValue,
    momentum_score_adjusted: momentumScoreAdjusted,
    price_vol_divergence: priceVolDivergence,
    momentum_alignment_score: momentumAlignmentScore,
    momentum_alignment_label: momentumAlignmentLabel,
    momentum_score: momentumScore,
    momentum_score_label: momentumScoreLabel,
    // Round 468: dex_divergence_strength — when dex momentum diverges from market momentum
    // strong dex + declining market = potential reversal; strong market + declining dex = potential top
    dex_market_divergence: (() => {
      if (dexMomentum === 'improving' && marketMomentum === 'declining') return 'dex_leading_reversal';
      if (dexMomentum === 'declining' && marketMomentum === 'improving') return 'market_overextended';
      if (dexMomentum === marketMomentum) return 'aligned';
      return 'mixed';
    })(),
    // Round 233 (AutoResearch nightly): momentum_confidence — how reliable is the momentum signal?
    // Confidence is higher when: more dims available, prev data exists for comparison, no divergence
    momentum_confidence: (() => {
      const hasPrev = previousScanData != null;
      const noDivergence = priceVolDivergence === 'none';
      const alignmentStrength = Math.abs(improvingCount - decliningCount) / totalDims; // 0 = evenly split
      // Base from prev data availability + alignment strength
      const base = hasPrev ? 60 : 35;
      const alignBonus = Math.round(alignmentStrength * 30);
      const divergencePenalty = !noDivergence ? 10 : 0;
      return Math.max(0, Math.min(100, base + alignBonus - divergencePenalty));
    })(),
  };
}
