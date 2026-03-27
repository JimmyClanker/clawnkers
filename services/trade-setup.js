import { safeNum } from '../utils/math.js';
/**
 * trade-setup.js — Round 25
 * Generates an actionable trade setup based on market data and scores.
 */


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

  const price = safeNum(market.current_price ?? market.price);
  const ath = safeNum(market.ath);
  const atl = safeNum(market.atl);
  const overallScore = safeNum(scores?.overall?.score, 0);
  const priceChange7d = Math.abs(safeNum(market.price_change_pct_7d, 0));

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

  // Entry zone: volatility-adjusted (base ±5%, expand if 7d volatility >20%)
  let entrySpread = 0.05; // default 5%
  if (priceChange7d > 20) {
    entrySpread = 0.08; // expand to ±8% for volatile tokens
    notes.push(`Entry zone expanded to ±8% due to high 7d volatility (${priceChange7d.toFixed(1)}%).`);
  } else if (priceChange7d < 5) {
    entrySpread = 0.03; // tighten to ±3% for stable tokens
    notes.push(`Entry zone tightened to ±3% due to low 7d volatility (${priceChange7d.toFixed(1)}%).`);
  }

  // Round 442: anchor entry zone to nearest ATH/ATL Fibonacci support level when available
  // If price is between ATL and ATH, find the nearest Fibonacci support below current price
  let fibSupportLevel = null;
  if (ath !== null && atl !== null && ath > atl && price > atl && price < ath) {
    const range = ath - atl;
    const fibLevels = [0.236, 0.382, 0.5, 0.618, 0.786].map(f => atl + range * f);
    // Find highest fib level below current price (= nearest support)
    const belowPrice = fibLevels.filter(f => f < price);
    if (belowPrice.length > 0) {
      fibSupportLevel = belowPrice[belowPrice.length - 1];
      const fibPct = Math.abs(price - fibSupportLevel) / price;
      // Only use fib support if it's within 15% of current price
      if (fibPct <= 0.15) {
        notes.push(`Entry low anchored to Fibonacci support $${formatPrice(fibSupportLevel)} (${(fibPct * 100).toFixed(1)}% below price).`);
      } else {
        fibSupportLevel = null; // too far, don't use
      }
    }
  }

  const entryLow = fibSupportLevel !== null
    ? formatPrice(Math.min(price * (1 - entrySpread), fibSupportLevel))
    : formatPrice(price * (1 - entrySpread));
  const entryHigh = formatPrice(price * (1 + entrySpread));

  // Stop loss: volatility-adjusted (base -15%, wider for volatile tokens)
  let stopPct = 0.15; // default -15%
  if (priceChange7d > 30) {
    stopPct = 0.25; // -25% for highly volatile tokens
    notes.push(`Stop loss widened to -25% due to high volatility (${priceChange7d.toFixed(1)}% 7d).`);
  } else if (priceChange7d < 10) {
    stopPct = 0.10; // -10% for stable tokens
    notes.push(`Stop loss tightened to -10% due to low volatility (${priceChange7d.toFixed(1)}% 7d).`);
  } else {
    notes.push('Stop loss set at -15% from current price (normal volatility).');
  }

  let stopLoss = price * (1 - stopPct);

  // Override with ATL-based stop if ATL is closer and within volatility-adjusted range
  if (atl !== null && atl > 0 && atl < price) {
    const atlStop = atl * 0.95; // 5% buffer below ATL
    if (atlStop > stopLoss) {
      stopLoss = atlStop;
      notes.push(`Stop loss adjusted to ATL-based level ($${formatPrice(atl)} - 5%).`);
    }
  }

  // Round 447: Fibonacci support stop loss — find the nearest Fibonacci level below entry as stop
  // If a Fibonacci level is between current stop and current price, use it as a tighter stop
  if (ath !== null && atl !== null && ath > atl && price > atl) {
    const range = ath - atl;
    // Key support levels below price (from entry low perspective)
    const fibSupports = [0.236, 0.382, 0.5, 0.618, 0.786].map(f => atl + range * f).filter(f => f < stopLoss);
    if (fibSupports.length > 0) {
      // Use the highest fib support below current stop as a more precise stop level
      const fibStop = fibSupports[fibSupports.length - 1] * 0.98; // 2% buffer below fib
      if (fibStop > stopLoss * 0.95 && fibStop < price * 0.95) { // within 5% of original stop, not too close to price
        stopLoss = fibStop;
        notes.push(`Stop loss refined to Fibonacci support level $${formatPrice(fibStop)} (2% buffer below fib).`);
      }
    }
  }
  stopLoss = formatPrice(stopLoss);

  // Take profit targets: Fibonacci-based if ATH/ATL available, else % gains
  let tp1Price, tp2Price, tp3Price;
  if (ath !== null && atl !== null && ath > atl && price >= atl && price < ath) {
    // Use Fibonacci retracement levels from ATL→ATH
    const range = ath - atl;
    const fib0382 = atl + range * 0.382;
    const fib0618 = atl + range * 0.618;
    const fib1000 = atl + range * 1.0; // ATH
    
    // TP1: 38.2% or +20%, whichever is closer to current price but above it
    tp1Price = (fib0382 > price && fib0382 < price * 1.5) ? formatPrice(fib0382) : formatPrice(price * 1.20);
    // TP2: 61.8% or +50%
    tp2Price = (fib0618 > price && fib0618 < price * 2.0) ? formatPrice(fib0618) : formatPrice(price * 1.50);
    // TP3: ATH
    tp3Price = formatPrice(fib1000);
    notes.push(`TP targets set using Fibonacci levels (ATL $${formatPrice(atl)} → ATH $${formatPrice(ath)}).`);
  } else {
    // Fallback to % gains
    tp1Price = formatPrice(price * 1.20);  // +20%
    tp2Price = formatPrice(price * 1.50);  // +50%
    if (ath !== null && ath > price * 1.5) {
      tp3Price = formatPrice(ath);
      notes.push(`TP3 set at ATH ($${formatPrice(ath)}).`);
    } else {
      tp3Price = formatPrice(price * 2.0);       // +100%
      notes.push('TP3 set at +100% (ATH not available or not significantly above).');
    }
  }

  const takeProfitTargets = [
    { label: 'TP1 (conservative)', price: tp1Price, pct_gain: round(((tp1Price - price) / price) * 100, 1) },
    { label: 'TP2 (moderate)', price: tp2Price, pct_gain: round(((tp2Price - price) / price) * 100, 1) },
    { label: 'TP3 (aggressive)', price: tp3Price, pct_gain: round(((tp3Price - price) / price) * 100, 1) },
  ];

  // Risk/reward using TP1 as base
  const risk = price - stopLoss;       // how much we lose if stopped out
  const reward = tp1Price - price;     // how much we gain at TP1
  const rrRatio = risk > 0 ? round(reward / risk, 2) : null;

  // Setup quality: 0-100 score + label
  let setupQualityScore = 0;
  
  // Base: overall score (0-10 → 0-40 points)
  setupQualityScore += Math.min(40, overallScore * 4);
  
  // R/R ratio contribution (0-30 points)
  if (rrRatio !== null) {
    if (rrRatio >= 3.0) setupQualityScore += 30;
    else if (rrRatio >= 2.0) setupQualityScore += 25;
    else if (rrRatio >= 1.5) setupQualityScore += 20;
    else if (rrRatio >= 1.0) setupQualityScore += 15;
    else if (rrRatio >= 0.5) setupQualityScore += 5;
  }
  
  // Volatility fit (0-15 points): reward normal volatility, penalize extremes
  if (priceChange7d >= 10 && priceChange7d <= 30) {
    setupQualityScore += 15; // sweet spot
  } else if (priceChange7d < 5) {
    setupQualityScore += 5; // too stable, low opportunity
  } else if (priceChange7d > 50) {
    setupQualityScore += 0; // too volatile, high risk
  } else {
    setupQualityScore += 10; // acceptable
  }
  
  // ATH/ATL context (0-15 points)
  const athDistancePct = ath != null && ath > 0 && price > 0 ? ((price - ath) / ath) * 100 : null;
  const atlDistancePct = atl != null && atl > 0 && price > 0 ? ((price - atl) / atl) * 100 : null;
  if (athDistancePct !== null && athDistancePct > -20 && athDistancePct < 0) {
    setupQualityScore += 15; // near ATH breakout zone
  } else if (atlDistancePct !== null && atlDistancePct < 30) {
    setupQualityScore += 0; // too close to ATL, risky
  } else if (athDistancePct !== null && athDistancePct < -50) {
    setupQualityScore += 10; // deep value territory
  } else {
    setupQualityScore += 8; // normal range
  }
  
  setupQualityScore = Math.min(100, Math.max(0, Math.round(setupQualityScore)));
  
  let setupQuality;
  if (setupQualityScore >= 70) {
    setupQuality = 'strong';
  } else if (setupQualityScore >= 40) {
    setupQuality = 'moderate';
  } else {
    setupQuality = 'weak';
  }

  // Round 236 (AutoResearch): realized_vol_90d annotation — educate user on structural volatility
  const realizedVol90d = safeNum(rawData?.market?.realized_vol_90d, null);
  if (realizedVol90d !== null) {
    const volTier = realizedVol90d > 200 ? 'extreme' : realizedVol90d > 100 ? 'high' : realizedVol90d > 50 ? 'moderate' : 'low';
    notes.push(`90-day realized volatility: ${realizedVol90d.toFixed(0)}% annualized (${volTier}) — size positions accordingly.`);
    // For high realized vol assets, widen TP gap to capture larger moves
    if (realizedVol90d > 150 && takeProfitTargets.length > 0) {
      notes.push('High realized volatility suggests wider TP targets may be needed to avoid premature exit.');
    }
  }

  // Round 25: ATH/ATL context notes (already calculated for quality score)
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

  // Round 463: partial_take_profit_strategy — how much to take off at each TP level
  // Based on RR ratio and setup quality: better setups = let more ride to TP3
  let tp1TakePct, tp2TakePct, tp3TakePct;
  if (rrRatio !== null && rrRatio >= 3.0) {
    // Excellent RR: take small at TP1, let most ride
    tp1TakePct = 25; tp2TakePct = 35; tp3TakePct = 40;
  } else if (rrRatio !== null && rrRatio >= 2.0) {
    // Good RR: balanced distribution
    tp1TakePct = 33; tp2TakePct = 34; tp3TakePct = 33;
  } else if (rrRatio !== null && rrRatio >= 1.5) {
    // Moderate RR: take more early
    tp1TakePct = 40; tp2TakePct = 40; tp3TakePct = 20;
  } else {
    // Weak RR or unknown: take most at TP1
    tp1TakePct = 60; tp2TakePct = 30; tp3TakePct = 10;
  }
  const partialTakeProfitStrategy = {
    tp1_take_pct: tp1TakePct,
    tp2_take_pct: tp2TakePct,
    tp3_take_pct: tp3TakePct,
    rationale: rrRatio !== null
      ? `RR ${rrRatio.toFixed(2)} → ${rrRatio >= 3.0 ? 'let winners run' : rrRatio >= 2.0 ? 'balanced distribution' : 'take profits early'}`
      : 'no price data — take profits conservatively',
  };

  // Round 450: entry_timing_score — 0-100 composite score for entry timing quality
  // Components: score quality (30pts) + RR ratio (25pts) + volatility fit (25pts) + proximity to support (20pts)
  let entryTimingScore = 0;
  // Score quality: 0-30 pts
  entryTimingScore += Math.min(30, overallScore * 3);
  // RR ratio: 0-25 pts
  if (rrRatio !== null) {
    entryTimingScore += rrRatio >= 3.0 ? 25 : rrRatio >= 2.0 ? 20 : rrRatio >= 1.5 ? 15 : rrRatio >= 1.0 ? 10 : 5;
  }
  // Volatility fit: sweet spot is 10-30% 7d change — enough momentum without being overextended
  if (priceChange7d >= 10 && priceChange7d <= 30) {
    entryTimingScore += 25;
  } else if (priceChange7d >= 5 && priceChange7d < 10) {
    entryTimingScore += 18;
  } else if (priceChange7d > 30 && priceChange7d <= 50) {
    entryTimingScore += 12; // overextended, less ideal
  } else if (priceChange7d < 5) {
    entryTimingScore += 8; // too quiet, lower opportunity
  } else {
    entryTimingScore += 3; // > 50% in 7d = likely overextended
  }
  // Proximity to support (fib or ATL): entry near support = better timing
  if (fibSupportLevel !== null) {
    const distToSupport = (price - fibSupportLevel) / price;
    entryTimingScore += distToSupport < 0.05 ? 20 : distToSupport < 0.1 ? 15 : 10;
  } else {
    entryTimingScore += 10; // no fib support available, neutral score
  }
  entryTimingScore = Math.min(100, Math.max(0, Math.round(entryTimingScore)));
  const entryTimingLabel = entryTimingScore >= 75 ? 'excellent' : entryTimingScore >= 55 ? 'good' : entryTimingScore >= 35 ? 'fair' : 'poor';

  return {
    entry_zone: { low: entryLow, high: entryHigh },
    stop_loss: stopLoss,
    take_profit_targets: takeProfitTargets,
    risk_reward_ratio: rrRatio,
    setup_quality: setupQuality,
    setup_quality_score: setupQualityScore,
    risk_label: riskLabel,
    position_size_hint: positionSizeHint,
    entry_timing_score: entryTimingScore,
    entry_timing_label: entryTimingLabel,
    partial_take_profit_strategy: partialTakeProfitStrategy,
    notes,
  };
}
