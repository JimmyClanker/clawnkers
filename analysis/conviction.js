/**
 * conviction.js — Round 5: Conviction Score
 *
 * Meta-score measuring HOW CONFIDENT WE ARE in the analysis itself.
 * Separate from the project score — this is about data quality and consistency.
 *
 * Output: 0-100 conviction score + reasoning.
 */

function safeN(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/**
 * Factor 1: Data completeness — how many collectors succeeded.
 * Max 25 points.
 */
function scoreCompleteness(rawData) {
  const collectors = rawData?.metadata?.collectors ?? {};
  const total = Object.keys(collectors).length || 1;
  const succeeded = Object.values(collectors).filter(c => c?.ok === true).length;
  const ratio = succeeded / total;

  return {
    score: Math.round(ratio * 25),
    detail: `${succeeded}/${total} collectors succeeded (${(ratio * 100).toFixed(0)}%)`,
  };
}

/**
 * Factor 2: Data freshness — cache age vs fresh.
 * Max 15 points.
 */
function scoreFreshness(rawData) {
  const collectors = rawData?.metadata?.collectors ?? {};
  const sources = Object.values(collectors);
  const freshCount = sources.filter(c => c?.source === 'fresh').length;
  const cacheCount = sources.filter(c => c?.source === 'cache').length;
  const staleCount = sources.filter(c => c?.source === 'stale-cache').length;
  const total = sources.length || 1;

  // Fresh = full points, cached = partial, stale = minimal
  const weighted = (freshCount * 1.0 + cacheCount * 0.7 + staleCount * 0.3) / total;

  return {
    score: Math.round(weighted * 15),
    detail: `${freshCount} fresh, ${cacheCount} cached, ${staleCount} stale`,
  };
}

/**
 * Factor 3: Cross-source agreement — do market, onchain, social tell the same story?
 * Max 25 points.
 */
function scoreCrossSourceAgreement(rawData, scores) {
  const dims = [
    scores?.market_strength?.score,
    scores?.onchain_health?.score,
    scores?.social_momentum?.score,
    scores?.development?.score,
  ].filter(v => v != null);

  if (dims.length < 2) return { score: 5, detail: 'Insufficient dimensions for cross-source analysis' };

  const avg = dims.reduce((s, v) => s + v, 0) / dims.length;
  const variance = dims.reduce((s, v) => s + (v - avg) ** 2, 0) / dims.length;
  const stddev = Math.sqrt(variance);

  // Low stddev = high agreement = high conviction
  // stddev 0 = perfect agreement (25 pts), stddev 3+ = poor agreement (5 pts)
  const agreement = Math.max(0, Math.min(25, Math.round(25 * (1 - stddev / 3.5))));

  const level = stddev < 1 ? 'strong agreement' : stddev < 2 ? 'moderate agreement' : 'weak agreement';

  return {
    score: agreement,
    detail: `Dimension stddev ${stddev.toFixed(2)} (${level})`,
  };
}

/**
 * Factor 4: Red flag severity — critical flags reduce conviction.
 * Max 20 points (starts at 20, deducted for flags).
 */
function scoreRedFlagImpact(enrichment) {
  const redFlags = enrichment?.redFlags ?? [];
  const criticalCount = redFlags.filter(f => f.severity === 'critical').length;
  const warningCount = redFlags.filter(f => f.severity === 'warning').length;

  const deduction = criticalCount * 5 + warningCount * 2;
  const score = Math.max(0, 20 - deduction);

  return {
    score,
    detail: `${criticalCount} critical, ${warningCount} warning flags (−${deduction} pts)`,
  };
}

/**
 * Factor 5: Score spread — high std dev = low conviction.
 * Max 15 points.
 */
function scoreSpread(scores) {
  const dimScores = [
    scores?.market_strength?.score,
    scores?.onchain_health?.score,
    scores?.social_momentum?.score,
    scores?.development?.score,
    scores?.tokenomics_health?.score,
    scores?.distribution?.score,
    scores?.risk?.score,
  ].filter(v => v != null);

  if (dimScores.length < 3) return { score: 3, detail: 'Insufficient dimensions for spread analysis' };

  const avg = dimScores.reduce((s, v) => s + v, 0) / dimScores.length;
  const variance = dimScores.reduce((s, v) => s + (v - avg) ** 2, 0) / dimScores.length;
  const stddev = Math.sqrt(variance);

  // Low spread = high conviction
  const score = Math.max(0, Math.min(15, Math.round(15 * (1 - stddev / 3.5))));

  return {
    score,
    detail: `Score spread stddev ${stddev.toFixed(2)} across ${dimScores.length} dimensions`,
  };
}

/**
 * Get conviction label from score.
 */
function convictionLabel(score) {
  if (score >= 80) return 'High';
  if (score >= 60) return 'Moderate';
  if (score >= 40) return 'Low';
  return 'Very Low';
}

/**
 * Calculate conviction score.
 *
 * @param {object} rawData - raw collector output
 * @param {object} scores - calculateScores() result
 * @param {object} enrichment - enrichment results (redFlags, etc.)
 * @returns {{ score: number, label: string, factors: object, reasoning: string }}
 */
export function calculateConviction(rawData, scores, enrichment = {}) {
  const f1 = scoreCompleteness(rawData);
  const f2 = scoreFreshness(rawData);
  const f3 = scoreCrossSourceAgreement(rawData, scores);
  const f4 = scoreRedFlagImpact(enrichment);
  const f5 = scoreSpread(scores);

  // Round 233 (AutoResearch nightly): P/TVL micro-bonus — undervalued assets with data support get +3 conviction pts
  const ptvlBonus = (() => {
    const ptvl = rawData?.ptvl_ratio;
    const tvl = safeN(rawData?.onchain?.tvl ?? 0);
    if (ptvl == null || tvl < 5_000_000) return 0; // only applies to protocols with real TVL
    if (ptvl < 0.5) return 3;  // deep value with TVL = high conviction opportunity
    if (ptvl < 1.0) return 2;  // undervalued
    return 0;
  })();

  // Round 236 (AutoResearch): 52-week range conviction factor
  // Near 52w high = price action confirms fundamentals (+3); near 52w low = divergence penalty (-2)
  const range52wBonus = (() => {
    const vs52w = rawData?.market?.price_vs_52w;
    if (!vs52w) return 0;
    if (vs52w.tier === 'near_high') return 3;   // price confirms bullish data
    if (vs52w.tier === 'near_low') return -2;   // price contradicts potentially bullish data
    return 0;
  })();

  // Round 237 (AutoResearch nightly): holder engagement bonus — active community = higher conviction in social signals
  const holderEngBonus = (() => {
    const engScore = safeN(rawData?.market?.holder_engagement_score ?? null, null);
    if (engScore === null) return 0;
    if (engScore >= 70) return 3;   // Very active holder community
    if (engScore >= 40) return 1;   // Moderate engagement
    if (engScore < 15) return -1;   // Low engagement reduces conviction
    return 0;
  })();

  // Round 237b (AutoResearch nightly): sell wall risk reduces conviction
  const sellWallConvPenalty = (() => {
    const swRisk = rawData?.dex?.sell_wall_risk;
    if (swRisk === 'high') return -3;
    if (swRisk === 'elevated') return -1;
    return 0;
  })();

  const total = Math.min(100, Math.max(0, f1.score + f2.score + f3.score + f4.score + f5.score + ptvlBonus + range52wBonus + holderEngBonus + sellWallConvPenalty));
  const label = convictionLabel(total);

  const reasoning = [
    `Data completeness: ${f1.detail} (${f1.score}/25)`,
    `Freshness: ${f2.detail} (${f2.score}/15)`,
    `Cross-source: ${f3.detail} (${f3.score}/25)`,
    `Red flags: ${f4.detail} (${f4.score}/20)`,
    `Score spread: ${f5.detail} (${f5.score}/15)`,
  ].join('. ');

  return {
    score: total,
    label,
    factors: {
      completeness: f1,
      freshness: f2,
      cross_source_agreement: f3,
      red_flag_impact: f4,
      score_spread: f5,
    },
    reasoning,
  };
}
