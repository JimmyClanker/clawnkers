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
 */
function probabilityTP1(overallScore) {
  if (overallScore > 7) return 0.60;
  if (overallScore >= 5) return 0.40;
  return 0.25;
}

/**
 * Probability of hitting TP2 (roughly half of TP1 probability, adjusted for score).
 */
function probabilityTP2(overallScore) {
  if (overallScore > 7) return 0.35;
  if (overallScore >= 5) return 0.20;
  return 0.10;
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

  const pTP1 = probabilityTP1(overallScore);
  const pTP2 = probabilityTP2(overallScore);

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

  return {
    rr_ratio: rrRatio,
    probability_tp1: pTP1,
    probability_tp2: pTP2,
    kelly_fraction: kellyFraction,
    position_size_suggestion: positionSizeSuggestion,
    expected_value: expectedValue,
    notes,
  };
}
