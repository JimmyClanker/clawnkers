/**
 * trend-reversal.js — Round 16 (AutoResearch batch)
 * Detects potential trend reversal patterns using multi-timeframe price data.
 * Pure algorithmic detection — no LLM required.
 */

function safeN(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/**
 * Detect trend reversal patterns.
 *
 * @param {object} rawData - raw collector output
 * @returns {{
 *   pattern: 'bullish_reversal'|'bearish_reversal'|'accumulation'|'distribution'|'none',
 *   confidence: 'high'|'medium'|'low',
 *   detail: string,
 *   signals: string[]
 * }}
 */
export function detectTrendReversal(rawData = {}) {
  const market = rawData.market ?? {};
  const dex = rawData.dex ?? {};
  const onchain = rawData.onchain ?? {};

  const c1h  = safeN(market.price_change_pct_1h);
  const c24h = safeN(market.price_change_pct_24h);
  const c7d  = safeN(market.price_change_pct_7d);
  const c30d = safeN(market.price_change_pct_30d);
  const volume = safeN(market.total_volume);
  const mcap   = safeN(market.market_cap);
  const atlDist = safeN(market.atl_distance_pct);
  const athDist = safeN(market.ath_distance_pct);
  const buySellRatio = safeN(dex.buy_sell_ratio);
  const tvl7d = safeN(onchain.tvl_change_7d);

  const signals = [];
  let bullishPoints = 0;
  let bearishPoints = 0;

  // 1. Recovering from prolonged downtrend
  if (c30d !== null && c7d !== null && c30d < -20 && c7d > 5) {
    signals.push(`Weekly bounce (+${c7d.toFixed(1)}%) after monthly downtrend (${c30d.toFixed(1)}%)`);
    bullishPoints += 2;
  }

  // 2. Short-term momentum reversal (1h green after 24h red)
  if (c1h !== null && c24h !== null && c1h > 3 && c24h < -5) {
    signals.push(`Intraday recovery (+${c1h.toFixed(1)}%/1h) despite negative 24h trend`);
    bullishPoints += 1;
  }

  // 3. Selling into ATL region then buyers stepping in
  if (atlDist !== null && atlDist < 30 && buySellRatio !== null && buySellRatio > 1.2) {
    signals.push(`Buy pressure (ratio ${buySellRatio.toFixed(2)}) near ATL (${atlDist.toFixed(1)}% above ATL)`);
    bullishPoints += 2;
  }

  // 4. TVL recovering while price still lagging
  if (tvl7d !== null && tvl7d > 10 && c7d !== null && c7d < 0) {
    signals.push(`TVL growing (+${tvl7d.toFixed(1)}%/7d) while price lags — smart money accumulation likely`);
    bullishPoints += 2;
  }

  // Round 156 (AutoResearch): Sparkline trend quality as reversal confirmation
  // A 'smooth_up' sparkline at ATL region = high-confidence bullish reversal confirmation
  // An 'erratic' sparkline at ATH region = distribution/confusion signal
  const sparklineTrend = rawData?.sparkline_trend;
  if (sparklineTrend?.trend_quality === 'smooth_up' && atlDist !== null && atlDist < 50) {
    signals.push(`Smooth 7d uptrend (consistency ${((sparklineTrend.consistency || 0) * 100).toFixed(0)}%) from low base — sustained buying pressure`);
    bullishPoints += 1;
  } else if (sparklineTrend?.trend_quality === 'smooth_down' && athDist !== null && athDist > -20) {
    signals.push(`Smooth 7d downtrend from near-ATH — orderly distribution pattern`);
    bearishPoints += 1;
  } else if (sparklineTrend?.trend_quality === 'erratic') {
    signals.push('Erratic 7-day price action — trend unclear, conflicting signals');
    // No point adjustment for erratic — just informational
  }

  // 5. Volume spike near ATL (accumulation)
  if (volume !== null && mcap !== null && mcap > 0 && volume / mcap > 0.2 && atlDist !== null && atlDist < 30) {
    signals.push(`High volume (${((volume / mcap) * 100).toFixed(0)}% of MCap) near ATL — accumulation pattern`);
    bullishPoints += 2;
  }

  // --- Bearish reversals ---
  // 6. Exhaustion near ATH with sell pressure
  if (athDist !== null && athDist > -10 && buySellRatio !== null && buySellRatio < 0.85) {
    signals.push(`Sell pressure (ratio ${buySellRatio.toFixed(2)}) near ATH — possible distribution`);
    bearishPoints += 2;
  }

  // 7. Rapid collapse from weekly high
  if (c7d !== null && c1h !== null && c7d > 20 && c1h < -5) {
    signals.push(`Sharp intraday drop (${c1h.toFixed(1)}%/1h) after strong week — exhaustion top`);
    bearishPoints += 2;
  }

  // 8. TVL declining with high volume (capital leaving)
  if (tvl7d !== null && tvl7d < -15 && volume !== null && mcap !== null && mcap > 0 && volume / mcap > 0.15) {
    signals.push(`TVL declining (${tvl7d.toFixed(1)}%/7d) with high sell volume — capital flight`);
    bearishPoints += 2;
  }

  // Round 446: momentum tier reversal — when price_momentum_tier was recently 'strong_downtrend'
  // and is now 'uptrend' or better, it signals a momentum regime change
  const momentumTier = rawData?.market?.price_momentum_tier ?? null;
  if (momentumTier === 'uptrend' || momentumTier === 'strong_uptrend') {
    if (c30d !== null && c30d < -15) {
      // Was in downtrend recently (30d negative) but momentum now reverting
      signals.push(`Momentum tier "${momentumTier}" despite ${c30d.toFixed(1)}% 30d price — regime flip from downtrend`);
      bullishPoints += 2;
    }
  }

  // Round 446: DEX price momentum burst with volume confirmation
  const dexM5 = safeN(rawData?.dex?.dex_price_change_m5);
  const dexH1 = safeN(rawData?.dex?.dex_price_change_h1);
  const dexH24 = safeN(rawData?.dex?.dex_price_change_h24);
  if (dexM5 !== null && dexH1 !== null && dexH24 !== null && dexM5 > 2 && dexH1 > 3 && dexH24 > 5 && c30d !== null && c30d < -10) {
    signals.push(`DEX intraday momentum burst (m5: +${dexM5.toFixed(1)}%, h1: +${dexH1.toFixed(1)}%, h24: +${dexH24.toFixed(1)}%) after 30d downtrend — potential reversal catalyst`);
    bullishPoints += 2;
  }

  // Determine pattern
  let pattern = 'none';
  let confidence = 'low';

  if (bullishPoints > 0 && bullishPoints > bearishPoints) {
    if (bullishPoints >= 4) { pattern = 'bullish_reversal'; confidence = 'high'; }
    else if (bullishPoints >= 2) { pattern = 'accumulation'; confidence = 'medium'; }
    else { pattern = 'accumulation'; confidence = 'low'; }
  } else if (bearishPoints > 0 && bearishPoints > bullishPoints) {
    if (bearishPoints >= 4) { pattern = 'bearish_reversal'; confidence = 'high'; }
    else { pattern = 'distribution'; confidence = bearishPoints >= 2 ? 'medium' : 'low'; }
  }

  const detail = signals.length > 0
    ? signals.join('. ') + '.'
    : 'No clear reversal pattern detected from available data.';

  return {
    pattern,
    confidence,
    detail,
    signals,
    bullish_points: bullishPoints,
    bearish_points: bearishPoints,
  };
}
