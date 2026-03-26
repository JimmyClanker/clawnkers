/**
 * risk-reward.js — Round 26
 * Provides risk/reward assessment with probability estimates and Kelly criterion sizing.
 */

function safeN(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

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
  const overallScore = safeN(scores?.overall?.score, 0);
  const rrRatio = safeN(tradeSetup?.risk_reward_ratio);
  const notes = [];

  // Round 22: pass confidence to probability functions
  const confidence = safeN(scores?.overall?.overall_confidence, 100);
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
