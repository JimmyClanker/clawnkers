/**
 * trade-setup.js — Round 25
 * Generates an actionable trade setup based on market data and scores.
 */

function safeN(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function round(v, decimals = 6) {
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
}

function formatPrice(price) {
  if (price === null) return null;
  if (price >= 1000) return round(price, 2);
  if (price >= 1) return round(price, 4);
  if (price >= 0.01) return round(price, 6);
  return round(price, 8);
}

/**
 * Generate an actionable trade setup.
 *
 * @param {object} rawData - raw collector output
 * @param {object} scores  - calculateScores() result
 * @returns {{
 *   entry_zone: { low: number|null, high: number|null },
 *   stop_loss: number|null,
 *   take_profit_targets: Array<{ label: string, price: number, pct_gain: number }>,
 *   risk_reward_ratio: number|null,
 *   setup_quality: 'strong'|'moderate'|'weak',
 *   notes: string[]
 * }}
 */
export function generateTradeSetup(rawData, scores) {
  const market = rawData?.market ?? {};
  const onchain = rawData?.onchain ?? {};

  const price = safeN(market.current_price ?? market.price);
  const ath = safeN(market.ath);
  const atl = safeN(market.atl);
  const overallScore = safeN(scores?.overall?.score, 0);

  const notes = [];

  if (price === null) {
    return {
      entry_zone: { low: null, high: null },
      stop_loss: null,
      take_profit_targets: [],
      risk_reward_ratio: null,
      setup_quality: 'weak',
      notes: ['No price data available — trade setup cannot be generated.'],
    };
  }

  // Entry zone: ±5% around current price
  const entryLow = formatPrice(price * 0.95);
  const entryHigh = formatPrice(price * 1.05);

  // Stop loss: tighter of ATL proximity or -15%
  let stopLoss;
  const stopAt15pct = price * 0.85;
  if (atl !== null && atl > 0 && atl < price) {
    // If ATL is within 15% of current price, use ATL-based stop (5% below ATL)
    const atlStop = atl * 0.95;
    stopLoss = atlStop > stopAt15pct ? atlStop : stopAt15pct;
    if (atlStop > stopAt15pct) {
      notes.push(`Stop loss set near ATL ($${formatPrice(atl)}) + 5% buffer.`);
    }
  } else {
    stopLoss = stopAt15pct;
    notes.push('Stop loss set at -15% from current price.');
  }
  stopLoss = formatPrice(stopLoss);

  // Take profit targets
  const tp1Price = formatPrice(price * 1.20);  // +20%
  const tp2Price = formatPrice(price * 1.50);  // +50%
  let tp3Price;
  if (ath !== null && ath > price * 1.5) {
    tp3Price = formatPrice(ath);
    notes.push(`TP3 set at ATH ($${formatPrice(ath)}).`);
  } else {
    tp3Price = formatPrice(price * 2.0);       // +100%
    notes.push('TP3 set at +100% (ATH not significantly above current price).');
  }

  const takeProfitTargets = [
    { label: 'TP1 (conservative)', price: tp1Price, pct_gain: 20 },
    { label: 'TP2 (moderate)', price: tp2Price, pct_gain: 50 },
    { label: 'TP3 (aggressive)', price: tp3Price, pct_gain: round(((tp3Price - price) / price) * 100, 1) },
  ];

  // Risk/reward using TP1 as base
  const risk = price - stopLoss;       // how much we lose if stopped out
  const reward = tp1Price - price;     // how much we gain at TP1
  const rrRatio = risk > 0 ? round(reward / risk, 2) : null;

  // Setup quality
  let setupQuality;
  if (overallScore >= 7 && rrRatio !== null && rrRatio >= 1.5) {
    setupQuality = 'strong';
  } else if (overallScore >= 5 && rrRatio !== null && rrRatio >= 1) {
    setupQuality = 'moderate';
  } else {
    setupQuality = 'weak';
  }

  // Round 25: ATH/ATL context notes
  const athDistancePct = ath != null && ath > 0 && price > 0
    ? ((price - ath) / ath) * 100
    : null;
  const atlDistancePct = atl != null && atl > 0 && price > 0
    ? ((price - atl) / atl) * 100
    : null;
  if (athDistancePct !== null) {
    if (athDistancePct > -5) notes.push(`Price is very close to ATH ($${formatPrice(ath)}) — breakout zone.`);
    else if (athDistancePct < -80) notes.push(`Price is ${Math.abs(athDistancePct).toFixed(0)}% below ATH ($${formatPrice(ath)}) — deep drawdown.`);
  }
  if (atlDistancePct !== null && atlDistancePct < 20) {
    notes.push(`Price is only ${atlDistancePct.toFixed(1)}% above ATL ($${formatPrice(atl)}) — near all-time-low risk.`);
  }

  // Round 63: Risk score label for human-readable summaries
  const riskLabel = overallScore >= 7.5
    ? 'low risk'
    : overallScore >= 5.5
      ? 'moderate risk'
      : overallScore >= 4
        ? 'elevated risk'
        : 'high risk';

  // Round 63: Recommended position size hint (% of portfolio)
  const positionSizeHint = overallScore >= 7.5 ? '3-5%' : overallScore >= 5.5 ? '1-3%' : '0.5-1%';

  return {
    entry_zone: { low: entryLow, high: entryHigh },
    stop_loss: stopLoss,
    take_profit_targets: takeProfitTargets,
    risk_reward_ratio: rrRatio,
    setup_quality: setupQuality,
    risk_label: riskLabel,
    position_size_hint: positionSizeHint,
    notes,
  };
}
