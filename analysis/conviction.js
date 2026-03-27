/**
 * conviction.js — Round 5: Conviction Score
 *
 * Meta-score measuring HOW CONFIDENT WE ARE in the analysis itself.
 * Separate from the project score — this is about data quality and consistency.
 *
 * Output: 0-100 conviction score + reasoning.
 */

import { safeNumber } from '../utils/math.js';

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
    const tvl = safeNumber(rawData?.onchain?.tvl ?? 0);
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
    const engScore = safeNumber(rawData?.market?.holder_engagement_score ?? null, null);
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

  // Round 381 (AutoResearch): wash trading risk reduces conviction on market/DEX signals
  // When wash trading is suspected, volume and price signals are unreliable
  const washTradingPenalty = (() => {
    const washRisk = rawData?.dex?.wash_trading_risk;
    if (washRisk === 'high') return -4;     // Volume data highly unreliable
    if (washRisk === 'elevated') return -2; // Moderate concern
    return 0;
  })();

  // Round 381 (AutoResearch): recent ATH momentum boosts conviction
  // A token near/at its ATH has strong market validation — price confirms thesis
  const athConvictionBonus = (() => {
    const daysSinceAth = rawData?.market?.days_since_ath;
    if (daysSinceAth == null) return 0;
    if (daysSinceAth <= 14) return 4;  // Within 2 weeks of ATH = very high conviction momentum signal
    if (daysSinceAth <= 30) return 2;  // Within a month = still strong
    if (daysSinceAth <= 90) return 1;  // Near ATH zone
    return 0;
  })();

  // Round 382 (AutoResearch): Article quality boosts social conviction
  // When coverage comes from tier-1 sources (Bloomberg, CoinDesk, etc.), social signals are more reliable
  const articleQualityBonus = (() => {
    const qual = safeNumber(rawData?.social?.avg_article_quality_score ?? null, null);
    if (qual === null) return 0;
    if (qual >= 1.4) return 3;    // Tier-1 dominated coverage = high credibility
    if (qual >= 1.2) return 1;    // Above average source quality
    if (qual < 0.8) return -2;    // Low quality / blog noise = low credibility signal
    return 0;
  })();

  // Round 382 (AutoResearch): organic volume spike boosts conviction (no wash trading + high volume = real demand)
  const organicVolumeBonus = (() => {
    const washRisk = rawData?.dex?.wash_trading_risk;
    if (washRisk && washRisk !== 'low') return 0; // Cannot claim organic if wash trading suspected
    const vol = safeNumber(rawData?.market?.total_volume ?? 0);
    const mcap = safeNumber(rawData?.market?.market_cap ?? 0);
    if (mcap <= 0 || vol <= 0) return 0;
    const velPct = (vol / mcap) * 100;
    if (velPct >= 50) return 3;   // Very high organic activity = strong market conviction
    if (velPct >= 20) return 1;   // Elevated organic activity
    return 0;
  })();

  // Round 383 (AutoResearch): Inflation-conviction penalty
  // High annual inflation (>50%/yr) reduces conviction because fundamentals are structurally
  // degrading — even if current metrics look good, supply dilution is working against holders.
  const inflationConvPenalty = (() => {
    const inflation = safeNumber(rawData?.tokenomics?.inflation_rate ?? null, null);
    if (inflation === null) return 0;
    if (inflation > 100) return -5;  // Hyperinflationary — fundamentals will deteriorate
    if (inflation > 50) return -3;   // Very high inflation — moderate conviction penalty
    if (inflation > 30) return -1;   // High inflation — mild penalty
    if (inflation < 0) return 2;     // Deflationary — slight conviction boost
    return 0;
  })();

  // Round 383 (AutoResearch): Low float + momentum convergence boost
  // When circulating supply is low AND price momentum is strong, the setup is unusually
  // high-conviction because supply constraints amplify demand signals.
  const lowFloatMomentumBonus = (() => {
    const pctCirc = safeNumber(rawData?.tokenomics?.pct_circulating ?? null, null);
    const momentumTier = rawData?.market?.price_momentum_tier;
    if (pctCirc === null || !momentumTier) return 0;
    if (pctCirc < 20 && (momentumTier === 'strong_uptrend' || momentumTier === 'uptrend')) return 3;
    if (pctCirc < 35 && momentumTier === 'strong_uptrend') return 2;
    return 0;
  })();

  const total = Math.min(100, Math.max(0, f1.score + f2.score + f3.score + f4.score + f5.score + ptvlBonus + range52wBonus + holderEngBonus + sellWallConvPenalty + washTradingPenalty + athConvictionBonus + articleQualityBonus + organicVolumeBonus + inflationConvPenalty + lowFloatMomentumBonus));
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
