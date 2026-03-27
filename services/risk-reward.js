import { safeNum } from '../utils/math.js';
/**
 * risk-reward.js — Round 26
 * Provides risk/reward assessment with probability estimates and Kelly criterion sizing.
 */


function round(v, decimals = 4) {
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
}

/**
 * Probability of hitting TP1 based on overall score.
 * Round 22: adjusted by data confidence — low confidence reduces TP1 probability.
 */
function probabilityTP1(overallScore, confidence = 100) {
  let base;
  if (overallScore > 7) base = 0.60;
  else if (overallScore >= 5) base = 0.40;
  else base = 0.25;
  // Confidence discount: at 0% confidence → 50% of base; at 100% confidence → full base
  const confidenceMultiplier = 0.5 + (confidence / 100) * 0.5;
  return round(base * confidenceMultiplier, 4);
}

/**
 * Probability of hitting TP2 (roughly half of TP1 probability, adjusted for score).
 * Round 22: also confidence-adjusted.
 */
function probabilityTP2(overallScore, confidence = 100) {
  let base;
  if (overallScore > 7) base = 0.35;
  else if (overallScore >= 5) base = 0.20;
  else base = 0.10;
  const confidenceMultiplier = 0.5 + (confidence / 100) * 0.5;
  return round(base * confidenceMultiplier, 4);
}

/**
 * Kelly criterion: fraction = (b*p - q) / b
 * b = net odds (reward/risk), p = win probability, q = 1-p
 */
function kellyCriterion(b, p) {
  if (b <= 0 || p <= 0 || p >= 1) return 0;
  const q = 1 - p;
  const fraction = (b * p - q) / b;
  return Math.max(0, round(fraction, 4));
}

/**
 * Assess risk/reward for a trade.
 *
 * @param {object} rawData    - raw collector output
 * @param {object} scores     - calculateScores() result
 * @param {object} tradeSetup - result of generateTradeSetup()
 * @returns {{
 *   rr_ratio: number|null,
 *   probability_tp1: number,
 *   probability_tp2: number,
 *   kelly_fraction: number,
 *   position_size_suggestion: 'full'|'half'|'quarter'|'skip',
 *   expected_value: number|null,
 *   notes: string[]
 * }}
 */
export function assessRiskReward(rawData, scores, tradeSetup) {
  const overallScore = safeNum(scores?.overall?.score, 0);
  const rrRatio = safeNum(tradeSetup?.risk_reward_ratio);
  const notes = [];

  // Round 22: pass confidence to probability functions
  const confidence = safeNum(scores?.overall?.overall_confidence, 100);
  const pTP1 = probabilityTP1(overallScore, confidence);
  const pTP2 = probabilityTP2(overallScore, confidence);
  if (confidence < 60) {
    notes.push(`Low data confidence (${confidence}%) — probabilities adjusted downward.`);
  }

  // Kelly criterion based on TP1
  // b = rrRatio (reward relative to 1 unit of risk)
  const kellyFraction = rrRatio !== null ? kellyCriterion(rrRatio, pTP1) : 0;

  // Expected value (EV) per unit risked using TP1 probability
  // EV = p * reward - (1-p) * risk = p * (rrRatio) - (1-p) * 1
  let expectedValue = null;
  if (rrRatio !== null) {
    expectedValue = round(pTP1 * rrRatio - (1 - pTP1) * 1, 4);
  }

  // Position size suggestion
  let positionSizeSuggestion;
  if (expectedValue !== null && expectedValue <= 0) {
    positionSizeSuggestion = 'skip';
    notes.push(`Negative EV (${expectedValue}) — no edge in this trade at current score.`);
  } else if (kellyFraction >= 0.20) {
    positionSizeSuggestion = 'full';
    notes.push(`Kelly fraction ${(kellyFraction * 100).toFixed(1)}% — strong edge, full position appropriate.`);
  } else if (kellyFraction >= 0.10) {
    positionSizeSuggestion = 'half';
    notes.push(`Kelly fraction ${(kellyFraction * 100).toFixed(1)}% — moderate edge, half position.`);
  } else if (kellyFraction > 0) {
    positionSizeSuggestion = 'quarter';
    notes.push(`Kelly fraction ${(kellyFraction * 100).toFixed(1)}% — thin edge, quarter position only.`);
  } else {
    positionSizeSuggestion = 'skip';
    notes.push('Kelly criterion returns 0 — no positive edge detected.');
  }

  notes.push(`Overall score ${overallScore.toFixed(1)}/10 → TP1 probability ${(pTP1 * 100).toFixed(0)}%, TP2 probability ${(pTP2 * 100).toFixed(0)}%.`);

  // Round 65: Add EV label for quick human parsing
  let evLabel = 'neutral';
  if (expectedValue !== null) {
    if (expectedValue >= 0.3) evLabel = 'strong positive EV';
    else if (expectedValue >= 0.1) evLabel = 'positive EV';
    else if (expectedValue >= 0) evLabel = 'marginal EV';
    else if (expectedValue >= -0.2) evLabel = 'slightly negative EV';
    else evLabel = 'negative EV';
  }

  // Round 65: Half-Kelly sizing suggestion (more conservative, common in practice)
  const halfKellyFraction = round(kellyFraction / 2, 4);

  // Round 20 (AutoResearch nightly): volatility-adjusted EV — discount EV when market is in high-vol regime
  const volatility = rawData?.volatility;
  let volAdjustedEv = expectedValue;
  if (volatility && expectedValue != null) {
    const cautionMult = volatility.caution_multiplier ?? 1.0;
    volAdjustedEv = round(expectedValue * cautionMult, 4);
    if (volatility.regime !== 'calm') {
      notes.push(`Volatility regime "${volatility.regime}" (caution ${cautionMult}) → vol-adjusted EV: ${volAdjustedEv}.`);
    }
  }

  // Round 155 (AutoResearch): DEX volume momentum quality adjustment
  // Accelerating volume = higher conviction on TP1 (demand building); decelerating = lower
  const dexVolMomentum = rawData?.dex?.volume_momentum;
  if (dexVolMomentum === 'accelerating' && expectedValue !== null && expectedValue > 0) {
    volAdjustedEv = round(volAdjustedEv * 1.1, 4);
    notes.push('DEX volume accelerating intraday — EV adjusted upward 10%.');
  } else if (dexVolMomentum === 'decelerating' && expectedValue !== null) {
    volAdjustedEv = round(volAdjustedEv * 0.9, 4);
    notes.push('DEX volume decelerating intraday — EV adjusted downward 10%.');
  }

  // Round 236 (AutoResearch): 52-week range EV adjustment
  // Near 52w low + negative EV = structural bear trap risk; near 52w high = momentum confirmation
  const vs52w = rawData?.market?.price_vs_52w;
  if (vs52w && expectedValue !== null) {
    if (vs52w.tier === 'near_low') {
      volAdjustedEv = round(volAdjustedEv * 0.85, 4);
      notes.push(`Price near 52-week low (${vs52w.pct_from_52w_high.toFixed(1)}% from 52w high) — structural weakness risk, EV adjusted down 15%.`);
    } else if (vs52w.tier === 'near_high' && expectedValue > 0) {
      volAdjustedEv = round(volAdjustedEv * 1.08, 4);
      notes.push(`Price near 52-week high — momentum confirmation, EV adjusted up 8%.`);
    }
  }

  // Round 382 (AutoResearch): Wash trading risk EV discount
  // When wash trading is detected, volume and price signals are unreliable → reduce position size conviction
  const washRisk = rawData?.dex?.wash_trading_risk;
  if (washRisk === 'high' && expectedValue !== null) {
    volAdjustedEv = round(volAdjustedEv * 0.75, 4);
    notes.push('⚠️ Wash trading risk HIGH — volume data unreliable, EV discounted 25%. Use limit orders only.');
    if (positionSizeSuggestion === 'full') positionSizeSuggestion = 'half';
    else if (positionSizeSuggestion === 'half') positionSizeSuggestion = 'quarter';
  } else if (washRisk === 'elevated' && expectedValue !== null) {
    volAdjustedEv = round(volAdjustedEv * 0.88, 4);
    notes.push('Wash trading risk ELEVATED — treat volume signals with caution, EV discounted 12%.');
  }

  // Round 381 (AutoResearch): ATH recency EV adjustment
  // Recent ATH (< 30d) = strong momentum confirmation → boost EV slightly
  // Very old ATH (> 2yr, >80% below) = structural headwind → penalize EV
  const daysSinceAth = rawData?.market?.days_since_ath;
  const athDistancePct = safeNum(rawData?.market?.ath_distance_pct, 0);
  if (daysSinceAth != null && expectedValue !== null) {
    if (daysSinceAth <= 30 && expectedValue > 0) {
      volAdjustedEv = round(volAdjustedEv * 1.05, 4);
      notes.push(`ATH set ${daysSinceAth}d ago — recent price discovery, EV boosted 5%.`);
    } else if (daysSinceAth > 730 && athDistancePct < -80) {
      volAdjustedEv = round(volAdjustedEv * 0.90, 4);
      notes.push(`ATH set ${Math.round(daysSinceAth / 365 * 10) / 10}yr ago, ${Math.abs(athDistancePct).toFixed(0)}% below — long-term structural headwind, EV adjusted down 10%.`);
    }
  }

  // Round 458: score_confidence_adjustment — data confidence directly impacts EV reliability
  // When confidence is high (>=80%), scores are reliable → don't penalize
  // When confidence is low (<40%), scores may be wrong → penalize EV
  // (Note: this is different from the probabilityTP1/TP2 adjustment which already does this for probabilities)
  // Here we directly adjust vol_adjusted_ev for the confidence in the underlying data
  if (expectedValue !== null && confidence < 40) {
    volAdjustedEv = round(volAdjustedEv * 0.80, 4);
    notes.push(`Very low data confidence (${confidence}%) — scores may be unreliable, EV penalized 20%.`);
  } else if (expectedValue !== null && confidence >= 85) {
    volAdjustedEv = round(volAdjustedEv * 1.05, 4);
    notes.push(`High data confidence (${confidence}%) — signals reliable, EV boosted 5%.`);
  }

  // Round 454: momentum_score adjustment — use weighted momentum_score to adjust EV
  // momentum_score 0-100 from calculateMomentum — high score = higher probability of TP hits
  const momentumScore = safeNum(rawData?.momentum?.momentum_score, null);
  if (momentumScore !== null && expectedValue !== null) {
    // Normalize to -0.15 to +0.15 multiplier (50 = neutral, 75+ = +10%, 25- = -10%)
    const momentumAdjust = 1 + ((momentumScore - 50) / 50) * 0.15;
    if (momentumScore >= 70) {
      volAdjustedEv = round(volAdjustedEv * momentumAdjust, 4);
      notes.push(`Momentum score ${momentumScore}/100 — strong momentum, EV adjusted +${((momentumAdjust - 1) * 100).toFixed(1)}%.`);
    } else if (momentumScore <= 30) {
      volAdjustedEv = round(volAdjustedEv * momentumAdjust, 4);
      notes.push(`Momentum score ${momentumScore}/100 — weak momentum, EV adjusted ${((momentumAdjust - 1) * 100).toFixed(1)}%.`);
    }
  }

  // Round 448: trend_reversal_adjustment — bullish reversal pattern from trend-reversal.js
  const trendReversal = rawData?.trend_reversal;
  if (trendReversal && expectedValue !== null) {
    if (trendReversal.pattern === 'bullish_reversal' && trendReversal.confidence === 'high') {
      volAdjustedEv = round(volAdjustedEv * 1.12, 4);
      notes.push(`High-confidence bullish reversal pattern detected — EV boosted 12%.`);
    } else if (trendReversal.pattern === 'accumulation' && trendReversal.confidence !== 'low') {
      volAdjustedEv = round(volAdjustedEv * 1.06, 4);
      notes.push(`Accumulation pattern detected — EV boosted 6%.`);
    } else if (trendReversal.pattern === 'bearish_reversal' && trendReversal.confidence === 'high') {
      volAdjustedEv = round(volAdjustedEv * 0.80, 4);
      notes.push(`High-confidence bearish reversal pattern — EV reduced 20%. Consider waiting for confirmation.`);
      if (positionSizeSuggestion === 'full') positionSizeSuggestion = 'half';
    } else if (trendReversal.pattern === 'distribution') {
      volAdjustedEv = round(volAdjustedEv * 0.90, 4);
      notes.push(`Distribution pattern detected — EV reduced 10%. Smart money may be exiting.`);
    }
  }

  // Round 465: supply_unlock_ev_adjustment — upcoming unlock = headwind for price targets
  const supplyUnlock465 = rawData?.supply_unlock ?? rawData?.onchain?.supply_unlock ?? null;
  if (supplyUnlock465 && expectedValue !== null) {
    const unlockPct = safeNum(supplyUnlock465.pct_of_supply_30d ?? supplyUnlock465.unlock_pct ?? 0);
    const daysToUnlock = safeNum(supplyUnlock465.days_to_next_unlock ?? 999);
    if (unlockPct >= 10 && daysToUnlock <= 14) {
      volAdjustedEv = round(volAdjustedEv * 0.75, 4);
      notes.push(`⚠️ Large supply unlock ${unlockPct.toFixed(0)}% in ${daysToUnlock}d — significant EV discount 25%.`);
      if (positionSizeSuggestion === 'full') positionSizeSuggestion = 'half';
    } else if (unlockPct >= 5 && daysToUnlock <= 30) {
      volAdjustedEv = round(volAdjustedEv * 0.88, 4);
      notes.push(`Supply unlock ${unlockPct.toFixed(0)}% in ${daysToUnlock}d — EV discounted 12% for unlock headwind.`);
    }
  }

  // Round 443: signal_count_multiplier — more strong alpha signals = higher EV confidence
  // Each strong alpha signal beyond 2 boosts EV by 3% (max +15%)
  const alphaSignalsCount = safeNum(rawData?._alpha_signals_count, 0);
  const strongSignalsCount = safeNum(rawData?._strong_signals_count, 0);
  if (expectedValue !== null && expectedValue > 0 && strongSignalsCount >= 3) {
    const extraStrong = Math.min(5, strongSignalsCount - 2);
    const signalBoost = 1 + (extraStrong * 0.03);
    volAdjustedEv = round(volAdjustedEv * signalBoost, 4);
    notes.push(`${strongSignalsCount} strong alpha signals — EV boosted +${((signalBoost - 1) * 100).toFixed(0)}% for signal convergence.`);
  } else if (expectedValue !== null && alphaSignalsCount === 0 && strongSignalsCount === 0) {
    volAdjustedEv = round(volAdjustedEv * 0.90, 4);
    notes.push('No alpha signals detected — EV discounted 10% for lack of confirmation.');
  }

  return {
    rr_ratio: rrRatio,
    probability_tp1: pTP1,
    probability_tp2: pTP2,
    kelly_fraction: kellyFraction,
    half_kelly_fraction: halfKellyFraction,
    position_size_suggestion: positionSizeSuggestion,
    expected_value: expectedValue,
    vol_adjusted_ev: volAdjustedEv,
    ev_label: evLabel,
    notes,
  };
}
