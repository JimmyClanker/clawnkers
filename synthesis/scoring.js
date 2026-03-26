import { applyCircuitBreakers } from '../scoring/circuit-breakers.js';
import { detectRedFlags } from '../services/red-flags.js';
import { getCategoryWeights } from '../scoring/category-weights.js';
import { safeNumber } from '../utils/math.js';

function clampScore(value) {
  return Math.min(10, Math.max(1, Number(value.toFixed(1))));
}

// ─── Round 18: confidence helper ─────────────────────────────────────────────
/**
 * Calculate per-dimension data confidence (0–100%).
 * @param {object} rawData - raw collector data
 * @returns {object} confidence per dimension + overall_confidence
 */
export function calculateConfidence(rawData = {}) {
  const market     = rawData.market     ?? {};
  const onchain    = rawData.onchain    ?? {};
  const social     = rawData.social     ?? {};
  const github     = rawData.github     ?? {};
  const tokenomics = rawData.tokenomics ?? {};

  // Market — Round 137: graduated scoring (5 fields, 20pts each)
  let marketConf;
  if (market.error) marketConf = 20;
  else {
    marketConf = 0;
    if (market.current_price != null && Number(market.current_price) > 0) marketConf += 25;
    if (market.total_volume != null && Number(market.total_volume) > 0) marketConf += 20;
    if (market.market_cap != null && Number(market.market_cap) > 0) marketConf += 25;
    if (market.price_change_pct_24h != null) marketConf += 15;
    if (market.market_cap_rank != null) marketConf += 15;
    if (marketConf === 0) marketConf = 10; // minimal: price data available but zero
  }

  // Onchain — Round 138: graduated (4 key fields)
  let onchainConf;
  if (onchain.error) onchainConf = 0;
  else {
    onchainConf = 0;
    if (onchain.tvl != null) onchainConf += 30;
    if (onchain.fees_7d != null || onchain.fees_30d != null) onchainConf += 25;
    if (onchain.revenue_7d != null || onchain.revenue_30d != null) onchainConf += 25;
    if (onchain.tvl_change_7d != null) onchainConf += 20;
    onchainConf = Math.min(100, onchainConf);
  }

  // Social — Round 138: graduated (volume + sentiment + narratives)
  const mentions = safeNumber(social.filtered_mentions ?? social.mentions);
  let socialConf;
  if (social.error) socialConf = 15;
  else {
    socialConf = 0;
    if (mentions > 50) socialConf += 40;
    else if (mentions > 10) socialConf += 30;
    else if (mentions >= 1) socialConf += 15;
    if (social.sentiment_score != null || social.sentiment_counts != null) socialConf += 30;
    if (Array.isArray(social.key_narratives) && social.key_narratives.length > 0) socialConf += 20;
    if (social.bot_filtered_count != null) socialConf += 10; // has quality filtering
    // Round 237 (AutoResearch nightly): reddit_activity_score boosts social confidence
    // When reddit data is high quality (upvote-weighted, recent), it adds to signal confidence
    const redditActivity = rawData?.reddit?.reddit_activity_score;
    if (redditActivity != null && redditActivity >= 30) socialConf += 10;
    socialConf = Math.min(100, Math.max(10, socialConf));
  }

  // Dev — Round 139: graduated (4 key fields)
  let devConf;
  if (github.error) devConf = 0;
  else {
    devConf = 0;
    if (github.commits_90d != null) devConf += 30;
    if (github.contributors != null) devConf += 25;
    if (github.stars != null) devConf += 20;
    if (github.last_commit != null) devConf += 15;
    if (github.forks != null) devConf += 10;
    devConf = Math.min(100, devConf);
  }

  // Tokenomics — graduated: +20 per field
  let tokenomicsConf;
  if (tokenomics.error) tokenomicsConf = 20;
  else {
    tokenomicsConf = 20; // base
    if (tokenomics.pct_circulating != null) tokenomicsConf += 30;
    if (tokenomics.inflation_rate != null) tokenomicsConf += 25;
    if (tokenomics.token_distribution != null) tokenomicsConf += 25;
    tokenomicsConf = Math.min(100, tokenomicsConf);
  }

  // Round 123 (AutoResearch): Holder data confidence
  const holders = rawData.holders ?? rawData.holderData ?? {};
  let holderConf;
  if (holders.error) holderConf = 0;
  else if (holders.top10_concentration != null && holders.holder_count != null) holderConf = 100;
  else if (holders.top10_concentration != null || holders.concentration_pct != null) holderConf = 60;
  else if (Object.keys(holders).length > 0) holderConf = 30;
  else holderConf = 0;

  // Round 123 (AutoResearch): DEX data confidence
  const dex = rawData.dex ?? rawData.dexData ?? {};
  let dexConf;
  if (dex.error) dexConf = 0;
  else if ((dex.dex_liquidity_usd != null || dex.liquidity != null) && dex.buy_sell_ratio != null) dexConf = 100;
  else if (dex.dex_liquidity_usd != null || dex.liquidity != null) dexConf = 60;
  else if (Object.keys(dex).length > 0) dexConf = 30;
  else dexConf = 0;

  // overall_confidence: weighted average of 7 dimensions
  const overall_confidence = Math.round(
    (marketConf * 0.20 + onchainConf * 0.20 + socialConf * 0.15 + devConf * 0.15 +
     tokenomicsConf * 0.15 + holderConf * 0.10 + dexConf * 0.05)
  );

  return {
    market: marketConf,
    onchain: onchainConf,
    social: socialConf,
    development: devConf,
    tokenomics: tokenomicsConf,
    holders: holderConf,
    dex: dexConf,
    overall_confidence,
  };
}

// ─── Round 233 (AutoResearch nightly): P/TVL ratio scoring supplement ─────────────
/**
 * Compute a P/TVL (price-to-TVL) score adjustment for onchain health.
 * P/TVL < 1.0 suggests the market cap is below locked value (potentially undervalued).
 * P/TVL > 5.0 suggests high speculation premium relative to TVL.
 * @param {number|null} mcap
 * @param {number|null} tvl
 * @returns {{ adjustment: number, ptvl: number|null, label: string }}
 */
export function computePTVLAdjustment(mcap, tvl) {
  if (!mcap || !tvl || tvl <= 0) return { adjustment: 0, ptvl: null, label: 'n/a' };
  const ptvl = mcap / tvl;
  let adjustment = 0;
  let label;
  if (ptvl < 0.5) { adjustment = 0.6; label: 'deep_value'; label = 'deep_value'; }
  else if (ptvl < 1.0) { adjustment = 0.3; label = 'undervalued'; }
  else if (ptvl < 2.0) { adjustment = 0; label = 'fair_value'; }
  else if (ptvl < 5.0) { adjustment = -0.2; label = 'premium'; }
  else { adjustment = -0.5; label = 'highly_speculative'; }
  return { adjustment, ptvl: parseFloat(ptvl.toFixed(3)), label };
}

// ─── Round 150 (AutoResearch): Sparkline momentum quality — reward smooth uptrends ──
/**
 * Compute sparkline trend quality from 7d price array.
 * Returns: { trend_quality: 'smooth_up'|'smooth_down'|'erratic'|'flat'|null, consistency: 0-1 }
 */
export function computeSparklineTrend(sparkline = []) {
  if (!Array.isArray(sparkline) || sparkline.length < 4) return { trend_quality: null, consistency: null };
  const prices = sparkline.map(Number).filter(Number.isFinite);
  if (prices.length < 4) return { trend_quality: null, consistency: null };
  let ups = 0; let downs = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) ups++;
    else if (prices[i] < prices[i - 1]) downs++;
  }
  const total = prices.length - 1;
  const consistency = Math.max(ups, downs) / total;
  const netChange = (prices[prices.length - 1] - prices[0]) / prices[0];
  let trend_quality;
  if (consistency >= 0.75 && netChange > 0.05) trend_quality = 'smooth_up';
  else if (consistency >= 0.75 && netChange < -0.05) trend_quality = 'smooth_down';
  else if (consistency < 0.55) trend_quality = 'erratic';
  else trend_quality = 'flat';
  return { trend_quality, consistency: parseFloat(consistency.toFixed(3)) };
}

// Round 50 (AutoResearch): Stablecoin detection — skip momentum penalties for stable assets
const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'FRAX', 'LUSD', 'USDD', 'FDUSD', 'PYUSD', 'USDE', 'USDX', 'SUSD', 'EURS', 'TUSD', 'GUSD', 'USDP', 'CRVUSD', 'GHO', 'MATIC_USDT', 'USDN']);

function isStablecoin(market = {}) {
  const sym = (market.symbol || '').toUpperCase();
  if (STABLECOIN_SYMBOLS.has(sym)) return true;
  // Heuristic: current price within 3% of $1 and ATH within $1.10
  const price = Number(market.current_price ?? market.price ?? 0);
  const ath = Number(market.ath ?? 0);
  if (price > 0 && Math.abs(price - 1.0) < 0.03 && ath > 0 && ath < 1.15) return true;
  return false;
}

function scoreMarketStrength(market = {}) {
  const volume = safeNumber(market.total_volume);
  const marketCap = safeNumber(market.market_cap);
  const fdv = safeNumber(market.fully_diluted_valuation);
  const ratio = marketCap > 0 ? volume / marketCap : 0;
  const fdvOverhang = marketCap > 0 && fdv > 0 ? fdv / marketCap : 1;

  // Use pre-computed ATH distance if available, fall back to calculation
  const athDistancePct = market.ath_distance_pct != null
    ? safeNumber(market.ath_distance_pct)
    : null;

  // Weighted momentum: recent signals weight more than older ones
  const change1h = safeNumber(market.price_change_pct_1h);
  const change24h = safeNumber(market.price_change_pct_24h);
  const change7d = safeNumber(market.price_change_pct_7d);
  const change30d = safeNumber(market.price_change_pct_30d);
  // Weighted composite momentum (24h most relevant for current signal)
  // Round 144 (AutoResearch): only count timeframes with actual data (non-null)
  // When all price_change fields are null/0, momentum contribution should be neutral (0)
  const momentumFields = [
    { v: market.price_change_pct_1h, w: 0.1 },
    { v: market.price_change_pct_24h, w: 0.4 },
    { v: market.price_change_pct_7d, w: 0.3 },
    { v: market.price_change_pct_30d, w: 0.2 },
  ];
  const activeMomentumFields = momentumFields.filter(({ v }) => v != null);
  let momentum;
  if (activeMomentumFields.length === 0) {
    momentum = 0; // no data → neutral, don't penalize
  } else {
    const totalW = activeMomentumFields.reduce((a, { w }) => a + w, 0);
    momentum = activeMomentumFields.reduce((a, { v, w }) => a + safeNumber(v) * (w / totalW), 0);
  }

  // Trend consistency bonus: all timeframes positive = strong trend confirmation
  // Round 145 (AutoResearch): only count non-null fields for trend consistency
  const trendFields = [
    market.price_change_pct_1h != null ? change1h : null,
    market.price_change_pct_24h != null ? change24h : null,
    market.price_change_pct_7d != null ? change7d : null,
    market.price_change_pct_30d != null ? change30d : null,
  ].filter((v) => v != null);
  const positiveTrends = trendFields.filter((c) => c > 0).length;
  const trendConsistency = trendFields.length > 0 ? positiveTrends / trendFields.length : 0.5; // neutral when no data

  let raw = 4;
  raw += Math.min(ratio * 20, 3);
  raw += Math.max(Math.min(momentum / 10, 2.5), -2);
  raw += (trendConsistency - 0.5) * 0.6; // ±0.3 bonus for all green / all red

  if (fdvOverhang > 1.1) {
    raw -= Math.min((fdvOverhang - 1.1) * 0.7, 1.5);
  }

  if (athDistancePct != null) {
    if (athDistancePct > -15) raw += 0.5;  // Near ATH = price strength
    else if (athDistancePct > -40) raw += 0.1; // Still in reasonable range
    // Round 142 (AutoResearch): Smoother ATH distance penalty — avoid cliff effect at -80%
    // Old: binary cliff at -80. New: linear gradient from -50% to -95%, max penalty capped at -1.5
    if (athDistancePct < -50) {
      // Linear: -50% = 0 penalty, -95% = full penalty (1.5 pts)
      const penaltyRaw = (Math.abs(athDistancePct) - 50) / 45; // 0 at -50%, 1 at -95%
      raw -= Math.min(penaltyRaw * 1.5, 1.5);
    }
  }

  // Round 231 (AutoResearch nightly): ATH recency bonus — recent ATH = momentum confirmation
  // Tokens setting new ATHs in last 30d signal strong demand; old ATHs penalize structurally broken assets
  const athRecency = market.ath_recency;
  if (athRecency === 'recent_ath') raw += 0.5;        // ATH within 30 days = price discovery phase
  else if (athRecency === 'near_ath') raw += 0.25;    // ATH within 90 days = still in strong range
  else if (athRecency === 'old_ath') raw -= 0.15;     // ATH over 1 year ago = structural underperformance

  // Round 6: price_momentum_tier bonus — reward consistent multi-TF trends
  const momentumTier = market.price_momentum_tier;
  if (momentumTier === 'strong_uptrend') raw += 0.4;
  else if (momentumTier === 'uptrend') raw += 0.2;
  else if (momentumTier === 'strong_downtrend') raw -= 0.4;
  else if (momentumTier === 'downtrend') raw -= 0.2;

  // Round 236 (AutoResearch): price_momentum_score (0-100) — fine-grained composite momentum
  // This is a sigmoid-normalized composite that's more nuanced than tier labels
  const priceMomentumScore = safeNumber(market.price_momentum_score ?? null);
  if (priceMomentumScore !== null) {
    // Map 0-100 score to ±0.3 adjustment (centered at 50)
    const momentumAdj = ((priceMomentumScore - 50) / 100) * 0.6;
    raw += momentumAdj;
  }

  // Round 150 (AutoResearch): Sparkline trend quality bonus — smooth uptrend = sustained momentum
  const sparklineTrend = computeSparklineTrend(market.sparkline_7d);
  if (sparklineTrend.trend_quality === 'smooth_up') raw += 0.35;
  else if (sparklineTrend.trend_quality === 'smooth_down') raw -= 0.35;
  else if (sparklineTrend.trend_quality === 'erratic') raw -= 0.15; // erratic = lower predictability

  // Round 10: Price range position — where in ATL-ATH range is the price?
  const priceRangePos = market.price_range_position != null ? safeNumber(market.price_range_position) : null;
  if (priceRangePos !== null) {
    if (priceRangePos >= 0.8) raw += 0.3;         // Near ATH — momentum confirmation
    else if (priceRangePos >= 0.5) raw += 0.1;    // Upper half — constructive
    else if (priceRangePos <= 0.1) raw -= 0.6;    // Near ATL — capitulation risk
    else if (priceRangePos <= 0.25) raw -= 0.3;   // Lower quartile — bearish structure
  }

  // Round 13: Time-decay factor — very new projects get a small uncertainty penalty
  let isNewProject = false;
  let age_months = null;
  const genesisDate = market.genesis_date;
  if (genesisDate) {
    const ageMs = Date.now() - new Date(genesisDate).getTime();
    age_months = ageMs / (1000 * 60 * 60 * 24 * 30.44);
    isNewProject = age_months < 3;
    if (age_months < 1) {
      raw -= 1.0; // Very new: significant uncertainty
    } else if (age_months < 3) {
      raw -= 0.5; // New: mild uncertainty penalty
    } else if (age_months > 24) {
      raw += 0.2; // Proven longevity bonus (2+ years)
    }
    // No bonus for age — longevity is already captured in momentum history
  }

  // Round 34: twitter/telegram followers as social proof for market strength
  const twitterFollowers = safeNumber(market.twitter_followers ?? 0);
  const telegramUsers = safeNumber(market.telegram_channel_user_count ?? 0);
  const totalCommunitySize = twitterFollowers + telegramUsers;
  if (totalCommunitySize > 500_000) raw += 0.4;
  else if (totalCommunitySize > 100_000) raw += 0.2;
  else if (totalCommunitySize > 10_000) raw += 0.1;

  // Round 34: market cap rank bonus — top 100 = institutional attention
  const marketCapRank = safeNumber(market.market_cap_rank ?? 0);
  if (marketCapRank > 0 && marketCapRank <= 20) raw += 0.5;
  else if (marketCapRank > 0 && marketCapRank <= 100) raw += 0.2;

  // Round 58: Exchange count — more CEX listings = legitimacy + liquidity
  const exchangeCount = safeNumber(market.exchange_count ?? 0);
  if (exchangeCount >= 20) raw += 0.4;
  else if (exchangeCount >= 10) raw += 0.2;
  else if (exchangeCount >= 5) raw += 0.1;

  // Round 236 (AutoResearch): 52-week range position bonus
  // Near 52w high = price discovery, institutional attention; near 52w low = structural weakness
  const vs52w = market.price_vs_52w;
  if (vs52w?.tier === 'near_high') raw += 0.3;    // within 10% of 52w high = momentum leader
  else if (vs52w?.tier === 'near_low') raw -= 0.3; // within 40% of 52w low = structural weakness

  // Round 234 (AutoResearch): Volume trend bonus — increasing volume over 7d is bullish confirmation
  const volumeTrend7d = market.volume_trend_7d;
  if (volumeTrend7d === 'increasing') raw += 0.25;
  else if (volumeTrend7d === 'decreasing') raw -= 0.2;

  // Round 234b (AutoResearch): Price vs MA7 bonus — being above the 7-day MA with margin confirms trend
  const priceVsMa7 = market.price_vs_ma7;
  if (priceVsMa7?.above_ma7 && priceVsMa7.pct_vs_ma7 > 5) raw += 0.3;
  else if (priceVsMa7?.above_ma7 === false && priceVsMa7?.pct_vs_ma7 < -5) raw -= 0.3;

  // Round 124 (AutoResearch): Empty data guard — no price, no volume, no market cap → neutral 5.0
  // Prevents spurious scoring when all market signals are absent
  const hasAnyMarketData = (market.current_price != null && safeNumber(market.current_price) > 0) ||
    (market.market_cap != null && safeNumber(market.market_cap) > 0) ||
    (market.total_volume != null && safeNumber(market.total_volume) > 0);
  if (!hasAnyMarketData) {
    return {
      score: 5.0,
      market_efficiency_score: 0,
      is_new_project: false,
      is_stablecoin: false,
      age_months: null,
      reasoning: 'No market data available — defaulting to neutral 5.0 (no price, volume, or market cap).',
    };
  }

  // Round 50 (AutoResearch): Stablecoin guard — raw score override for stable assets
  // Stablecoins should never score high on price momentum (they're supposed to be flat)
  const stablecoin = isStablecoin(market);
  if (stablecoin) {
    return {
      score: 5.0,
      market_efficiency_score: 50,
      is_new_project: false,
      is_stablecoin: true,
      age_months: null,
      reasoning: 'Stablecoin detected — market strength scoring replaced with neutral 5.0 (price momentum metrics not applicable to pegged assets).',
    };
  }

  // Round R3 (AutoResearch batch): DEX pressure micro-adjustment for market strength
  // Incorporates real-time buy/sell ratio from DexScreener into market momentum
  // This supplements the risk score's DEX analysis with a lighter market signal
  // Note: data accessed via closure on market (no direct dex param needed here)

  // Round 39 (AutoResearch): market_efficiency_score — how efficiently the market prices the asset
  // Measures: liquidity depth (vol/mcap), listing quality, trend confirmation, info efficiency
  const meComponents = [
    ratio > 0 ? Math.min(ratio / 0.2, 1) * 30 : 0,         // volume-to-mcap liquidity (0-30)
    trendConsistency * 20,                                    // multi-TF trend confirmation (0-20)
    exchangeCount >= 10 ? 20 : exchangeCount >= 5 ? 12 : exchangeCount >= 2 ? 5 : 0, // listing quality (0-20)
    marketCapRank > 0 && marketCapRank <= 100 ? 15 : marketCapRank > 0 && marketCapRank <= 500 ? 8 : 0, // rank (0-15)
    totalCommunitySize > 100_000 ? 10 : totalCommunitySize > 10_000 ? 5 : 0, // community signal (0-10)
    fdvOverhang < 2 ? 5 : fdvOverhang < 5 ? 2 : 0,          // FDV transparency (0-5)
  ];
  const marketEfficiencyScore = Math.round(Math.min(100, meComponents.reduce((a, b) => a + b, 0)));

  return {
    score: clampScore(raw),
    market_efficiency_score: marketEfficiencyScore,
    is_new_project: isNewProject,
    age_months: age_months != null ? parseFloat(age_months.toFixed(1)) : null,
    reasoning: `Volume/MC ratio ${ratio.toFixed(2)}, weighted momentum ${momentum.toFixed(2)}%, trend consistency ${(trendConsistency * 100).toFixed(0)}%, FDV/MC ${fdvOverhang.toFixed(2)}, ATH distance ${athDistancePct == null ? 'n/a' : `${athDistancePct.toFixed(1)}%`}${age_months != null ? `, age ${age_months.toFixed(1)} months${isNewProject ? ' (new project penalty applied)' : ''}` : ''}, market_efficiency ${marketEfficiencyScore}.`,
  };
}

function scoreOnchainHealth(onchain = {}, rawData = {}) {
  // Round 135 (AutoResearch): No onchain data guard
  // Many tokens have no onchain data (not DeFi protocols, no TVL).
  // Instead of 4.0 base which implies "below average", return neutral 5.0 (N/A, not applicable).
  const hasOnchainData = onchain && !onchain.error && (
    onchain.tvl != null ||
    onchain.fees_7d != null ||
    onchain.fees_30d != null ||
    onchain.tvl_change_7d != null
  );
  if (!hasOnchainData) {
    return {
      score: 5.0,
      onchain_maturity_score: 0,
      protocol_age_tier: 'unknown',
      reasoning: 'No onchain data available — defaulting to neutral 5.0 (not applicable for non-DeFi tokens).',
    };
  }

  // Round 125 (AutoResearch): cap TVL changes to ±200% to prevent extreme outliers
  // (e.g. new protocols with 10000% TVL gain, or protocol exploit with -99% in 7d)
  const trend7d = Math.max(-200, Math.min(200, safeNumber(onchain.tvl_change_7d)));
  const trend30d = Math.max(-200, Math.min(200, safeNumber(onchain.tvl_change_30d)));
  // Use fees_7d; fall back to fees_30d / 4 if only monthly data available
  const fees = onchain.fees_7d != null
    ? safeNumber(onchain.fees_7d)
    : safeNumber(onchain.fees_30d) / 4;
  const revenue = onchain.revenue_7d != null
    ? safeNumber(onchain.revenue_7d)
    : safeNumber(onchain.revenue_30d) / 4;

  let raw = 4;
  // Round 149 (AutoResearch): Zero fees penalty for established DeFi protocols
  // A protocol with significant TVL but zero fees = no value capture → token has no fundamental backing
  const tvlForFees = safeNumber(onchain.tvl ?? 0);
  const feesCheck = onchain.fees_7d != null ? safeNumber(onchain.fees_7d) : (safeNumber(onchain.fees_30d) / 4);
  if (tvlForFees > 10_000_000 && feesCheck === 0) {
    raw -= 1.5; // Significant TVL but zero fee generation = speculative/mercenary capital
  } else if (tvlForFees > 1_000_000 && feesCheck === 0) {
    raw -= 0.7; // Smaller TVL, still concerning
  }

  // Scale trend contribution: ±200% maps to ±2 points (25 divisor kept but capped input)
  raw += Math.max(Math.min((trend7d + trend30d) / 25, 3), -2);
  raw += fees > 0 ? Math.min(Math.log10(fees + 1), 2) : 0;
  raw += revenue > 0 ? Math.min(Math.log10(revenue + 1), 1.5) : 0;

  // Round 18: multichain bonus — reward protocols deployed on multiple chains
  const chainCount = Array.isArray(onchain.chains) ? onchain.chains.length : 0;
  let multichainBonus = 0;
  if (chainCount >= 5) multichainBonus = 0.6;
  else if (chainCount >= 3) multichainBonus = 0.3;
  else if (chainCount >= 2) multichainBonus = 0.15;
  raw += multichainBonus;

  // Round 233 (AutoResearch nightly): P/TVL supplement — undervalued protocols get boost
  const ptvlResult = computePTVLAdjustment(
    safeNumber(rawData?.market?.market_cap ?? null),
    safeNumber(onchain.tvl ?? null)
  );
  if (ptvlResult.adjustment !== 0) {
    raw += ptvlResult.adjustment;
  }

  // Round 232 (AutoResearch nightly): chain TVL concentration penalty
  // A protocol on 3+ chains but with 95%+ on one chain is effectively single-chain
  const chainTvlDominance = safeNumber(onchain.chain_tvl_dominance_pct ?? null);
  if (chainTvlDominance !== null && chainCount >= 2) {
    if (chainTvlDominance > 95) raw -= 0.2;    // almost entirely on one chain despite multi-chain claim
    else if (chainTvlDominance < 60) raw += 0.15; // genuinely diversified across chains
  }

  // Round 18: active users signal (if available)
  const activeUsers = safeNumber(onchain.active_users_24h);
  if (activeUsers > 10000) raw += 0.5;
  else if (activeUsers > 1000) raw += 0.25;

  // Round 7: TVL stickiness adjustment
  const tvlStickiness = onchain.tvl_stickiness;
  // Round 238 (AutoResearch): 'growing' TVL stickiness gets highest bonus (actively attracting capital)
  if (tvlStickiness === 'growing') raw += 0.6;   // > sticky: actively growing capital = strong signal
  else if (tvlStickiness === 'sticky') raw += 0.4;
  else if (tvlStickiness === 'fleeing') raw -= 0.5;

  // Round 218 (AutoResearch): revenue trend — improving revenue is a bullish fundamental signal
  const revenueTrend = onchain.revenue_trend;
  if (revenueTrend === 'improving') raw += 0.3;
  else if (revenueTrend === 'declining') raw -= 0.3;

  // Round 234 (AutoResearch): fee_revenue_acceleration — monetizing TVL more efficiently over time
  const feeRevAcc = onchain.fee_revenue_acceleration;
  if (feeRevAcc === 'accelerating') raw += 0.45;  // Growing revenue faster than TVL = expanding margins
  else if (feeRevAcc === 'growing') raw += 0.2;
  else if (feeRevAcc === 'declining') raw -= 0.25;

  // Round 235 (AutoResearch): daily_fee_rate_annualized bonus — high annualized fee rate signals productive protocol
  const dailyFeeRate = safeNumber(onchain.daily_fee_rate_annualized ?? 0);
  if (dailyFeeRate > 5) raw += 0.4;       // >5% annualized = highly productive (top tier DeFi)
  else if (dailyFeeRate > 1) raw += 0.2;  // 1-5% = healthy fee generation
  else if (dailyFeeRate > 0.1) raw += 0.05; // 0.1-1% = moderate fee generation

  // Round 236 (AutoResearch): TVL efficiency per active user — protocols with high TVL but few users
  // may have mercenary capital. High TVL per-user with high fees = product-market fit.
  const tvlForEff = safeNumber(onchain.tvl ?? 0);
  const activeUsersForEff = safeNumber(onchain.active_addresses_7d ?? onchain.active_users_24h ?? 0);
  if (tvlForEff > 0 && activeUsersForEff > 1000) {
    const tvlPerUser = tvlForEff / activeUsersForEff;
    // High TVL/user ($100K+) = power users, institutional capital = sticky
    if (tvlPerUser > 100_000) raw += 0.3;
    else if (tvlPerUser > 10_000) raw += 0.15;
    else if (tvlPerUser < 100) raw -= 0.1; // very low TVL/user = shallow capital per user
  }

  // Round 237 (AutoResearch nightly): revenue_per_active_user signal
  // High revenue per user (>$1/user/day) = product-market fit; low = activity without monetization
  const revenuePerUser = safeNumber(onchain.revenue_per_active_user ?? null);
  if (revenuePerUser > 0) {
    if (revenuePerUser >= 1.0) raw += 0.4;          // $1+/user/day = strong product-market fit
    else if (revenuePerUser >= 0.1) raw += 0.2;     // $0.10-$1 = moderate
    else if (revenuePerUser >= 0.01) raw += 0.05;   // $0.01-$0.10 = emerging
    else raw -= 0.1;                                  // <$0.01 = very low monetization
  }

  // Round 57: Active addresses as a usage signal
  const activeAddresses7d = safeNumber(onchain.active_addresses_7d ?? onchain.unique_users_7d ?? 0);
  if (activeAddresses7d > 50_000) raw += 0.6;
  else if (activeAddresses7d > 10_000) raw += 0.3;
  else if (activeAddresses7d > 1_000) raw += 0.1;

  // Round 57: revenue-to-fees ratio — value capture quality
  const revenueToFees = onchain.fees_7d > 0 ? revenue / fees : null;
  let revCapture = 0;
  if (revenueToFees !== null) {
    if (revenueToFees >= 0.5) { revCapture = 0.4; }  // protocol keeps 50%+ = very healthy
    else if (revenueToFees >= 0.2) { revCapture = 0.2; }
    else if (revenueToFees > 0) { revCapture = 0.05; } // at least generating some revenue
    raw += revCapture;
  }

  // Round 6 (AutoResearch batch): protocol maturity tier bonus
  const maturity = onchain.protocol_maturity;
  if (maturity === 'tier1') raw += 0.6;
  else if (maturity === 'tier2') raw += 0.35;
  else if (maturity === 'tier3') raw += 0.15;
  // 'emerging' → no bonus, not penalized

  // Round 55 (AutoResearch): protocol_age_tier — classify protocol by age for context
  // Uses tokenomics launch_date if available (passed via rawData in outer calculateScores)
  // Here we rely on what's available in onchain context
  const tvlForAge = safeNumber(onchain.tvl ?? 0);
  const feesForAge = safeNumber(onchain.fees_7d ?? 0);
  // Estimate maturity tier from TVL and fees patterns (no direct date in onchain)
  let protocolAgeTier = 'unknown';
  const maturityFromField = onchain.protocol_maturity;
  if (maturityFromField) {
    // Map existing maturity field to age tier
    const ageMap = { tier1: 'mature', tier2: 'established', tier3: 'growing', emerging: 'early' };
    protocolAgeTier = ageMap[maturityFromField] ?? 'unknown';
  } else if (tvlForAge > 1_000_000_000 && feesForAge > 1_000_000) {
    protocolAgeTier = 'mature';
  } else if (tvlForAge > 100_000_000) {
    protocolAgeTier = 'established';
  } else if (tvlForAge > 10_000_000) {
    protocolAgeTier = 'growing';
  } else if (tvlForAge > 0) {
    protocolAgeTier = 'early';
  }

  // Round 37 (AutoResearch): onchain_maturity_score — normalized 0-100 sustainability composite
  const tvl = safeNumber(onchain.tvl ?? 0);
  const omComponents = [
    fees > 0 ? Math.min(Math.log10(fees) / 6, 1) * 25 : 0,  // fee generation (0-25)
    Math.max(0, Math.min((trend7d + 15) / 30, 1)) * 20,      // TVL stability 7d (0-20)
    Math.max(0, Math.min((trend30d + 20) / 40, 1)) * 15,     // TVL stability 30d (0-15)
    // Round 238: 'growing' gets full 15 (attracting capital), 'sticky' = 13, 'moderate' = 8, 'fleeing' = 0
    tvlStickiness === 'growing' ? 15 : tvlStickiness === 'sticky' ? 13 : tvlStickiness === 'moderate' ? 8 : tvlStickiness === 'fleeing' ? 0 : 7.5, // stickiness (0-15)
    chainCount >= 5 ? 10 : chainCount >= 3 ? 6 : chainCount >= 2 ? 3 : 0, // chain diversification (0-10)
    activeAddresses7d > 10_000 ? 10 : activeAddresses7d > 1_000 ? 5 : activeAddresses7d > 100 ? 2 : 0, // active users (0-10)
    revenueToFees !== null && revenueToFees > 0 ? Math.min(revenueToFees * 10, 5) : 0, // value capture (0-5)
  ];
  const onchainMaturityScore = Math.round(Math.min(100, omComponents.reduce((a, b) => a + b, 0)));

  return {
    score: clampScore(raw),
    onchain_maturity_score: onchainMaturityScore,
    protocol_age_tier: protocolAgeTier,
    reasoning: `7-day TVL change ${trend7d.toFixed(2)}%, 30-day TVL change ${trend30d.toFixed(2)}%, 7-day fees $${fees.toLocaleString('en-US', { maximumFractionDigits: 0 })}, chains ${chainCount}${multichainBonus > 0 ? ` (+${multichainBonus} multichain bonus)` : ''}${tvlStickiness ? `, capital stickiness ${tvlStickiness}` : ''}${activeAddresses7d > 0 ? `, active addresses (7d) ${activeAddresses7d.toLocaleString('en-US')}` : ''}${revenueToFees !== null ? `, revenue capture ${(revenueToFees * 100).toFixed(0)}%` : ''}${maturity ? `, maturity ${maturity}` : ''}, onchain_maturity_score ${onchainMaturityScore}, protocol_age_tier ${protocolAgeTier}.`,
  };
}

// Round 29 (AutoResearch batch): narrative momentum adjustment — called from calculateScores
function applyNarrativeMomentumBonus(socialScore, narrativeMomentum = null) {
  if (!narrativeMomentum) return socialScore;
  const { narrative_alignment, narrative_count } = narrativeMomentum;
  let adj = 0;
  if (narrative_alignment === 'bullish') {
    adj = narrative_count >= 3 ? 0.5 : narrative_count >= 2 ? 0.3 : 0.15;
  } else if (narrative_alignment === 'bearish') {
    adj = -0.3;
  }
  return Math.min(10, Math.max(1, parseFloat((socialScore + adj).toFixed(1))));
}

function scoreSocialMomentum(social = {}) {
  // Use filtered mentions (bot-filtered) if available, fall back to raw mentions
  const rawMentions = safeNumber(social.mentions);
  const filteredMentions = social.filtered_mentions != null
    ? safeNumber(social.filtered_mentions)
    : rawMentions;
  const bullish = safeNumber(social?.sentiment_counts?.bullish);
  const bearish = safeNumber(social?.sentiment_counts?.bearish);
  const neutral = safeNumber(social?.sentiment_counts?.neutral);
  const narratives = Array.isArray(social.key_narratives) ? social.key_narratives.length : 0;
  const totalSignals = bullish + bearish + neutral;
  const confidence = totalSignals > 0 ? Math.min(totalSignals / 6, 1) : 0;

  // Use normalized sentiment score if available
  const sentimentScore = social.sentiment_score != null
    ? safeNumber(social.sentiment_score) // -1 to +1
    : totalSignals > 0 ? (bullish - bearish) / totalSignals : 0;

  // Bot filter ratio: if many items were filtered, discount signal quality
  const botFilteredCount = safeNumber(social.bot_filtered_count);
  const botRatio = rawMentions > 0 ? botFilteredCount / rawMentions : 0;
  const signalQualityMultiplier = Math.max(0.5, 1 - botRatio);

  // Round 10 (AutoResearch batch): institutional and upgrade mentions boost
  const institutionalMentions = safeNumber(social.institutional_mentions ?? 0);
  const upgradeMentions = safeNumber(social.upgrade_mentions ?? 0);
  const partnershipMentions = safeNumber(social.partnership_mentions ?? 0);

  let raw = 4;
  raw += Math.min(Math.log2(filteredMentions + 1) * 0.9, 2.5) * signalQualityMultiplier;
  raw += Math.max(Math.min(sentimentScore * 2.5 * confidence, 2), -2);
  raw += Math.min(narratives * 0.25, 1.5);

  // Institutional mention bonus (authoritative signal)
  if (institutionalMentions >= 3) raw += 0.4;
  else if (institutionalMentions >= 1) raw += 0.2;

  // Upgrade/mainnet mentions (catalyst forward-looking signal)
  if (upgradeMentions >= 2) raw += 0.3;
  else if (upgradeMentions >= 1) raw += 0.15;

  // Partnership mentions
  if (partnershipMentions >= 3) raw += 0.25;
  else if (partnershipMentions >= 1) raw += 0.1;

  // Round 236 (AutoResearch): listing mentions boost — exchange listings are major catalysts
  const listingMentions = safeNumber(social.listing_mentions ?? 0);
  if (listingMentions >= 5) raw += 0.4;
  else if (listingMentions >= 2) raw += 0.2;
  else if (listingMentions >= 1) raw += 0.1;

  // Round 232 (AutoResearch nightly): community_score bonus from market collector
  // Higher community score (CoinGecko-derived: twitter + telegram + reddit) = established community
  const communityScore = safeNumber(social.community_score ?? 0);
  if (communityScore >= 70) raw += 0.4;
  else if (communityScore >= 40) raw += 0.2;
  else if (communityScore >= 20) raw += 0.1;

  // Round 237 (AutoResearch nightly): competitor_content_ratio penalty
  // When most social coverage is framing this project in competitor context (not primary coverage),
  // the signal quality is reduced — scale down the raw score slightly
  const competitorContentRatio = safeNumber(social.competitor_content_ratio ?? null);
  if (competitorContentRatio !== null && competitorContentRatio > 0.5) {
    // Scale penalty: 50% = 0, 100% = -0.4
    const penalty = (competitorContentRatio - 0.5) * 0.8;
    raw -= Math.min(penalty, 0.4);
  }

  // Round 48 (AutoResearch): social_health_index — 0-100 normalized composite
  // Measures community health: volume, sentiment quality, narrative depth, engagement quality
  const shiComponents = [
    Math.min(Math.log2(filteredMentions + 1) / Math.log2(200), 1) * 30,      // mention volume (0-30)
    Math.max(0, (sentimentScore + 1) / 2) * 25,                               // sentiment quality (0-25)
    Math.min(narratives / 4, 1) * 20,                                         // narrative depth (0-20)
    signalQualityMultiplier * 15,                                              // signal quality / bot ratio (0-15)
    (institutionalMentions >= 2 ? 1 : institutionalMentions >= 1 ? 0.5 : 0) * 10, // institutional (0-10)
  ];
  const socialHealthIndex = Math.round(Math.min(100, shiComponents.reduce((a, b) => a + b, 0)));

  return {
    score: clampScore(raw),
    social_health_index: socialHealthIndex,
    reasoning: `Filtered mentions ${filteredMentions} (${botFilteredCount} bots filtered), sentiment score ${sentimentScore.toFixed(2)}, confidence ${confidence.toFixed(2)}, signal quality ${(signalQualityMultiplier * 100).toFixed(0)}%, narratives ${narratives}${institutionalMentions > 0 ? `, institutional ${institutionalMentions}` : ''}${upgradeMentions > 0 ? `, upgrades ${upgradeMentions}` : ''}, social_health_index ${socialHealthIndex}.`,
  };
}

function scoreDevelopment(github = {}) {
  // Round 126 (AutoResearch): when no github data at all (error or empty), return 3.0 (unknown/slightly negative)
  // rather than 4.0 - which unfairly rewards missing data with a near-neutral score.
  // 3.0 signals "we don't know, but absence of evidence on dev activity is mildly concerning"
  const hasGithubData = !github.error && (
    github.contributors != null || github.commits_90d != null ||
    github.stars != null || github.forks != null
  );
  if (!hasGithubData) {
    return {
      score: 3.0,
      dev_quality_index: 0,
      reasoning: 'No GitHub data available — development activity unverifiable. Score defaulted to 3.0 (unknown/mildly negative).',
    };
  }

  const contributors = safeNumber(github.contributors);
  const commits90d = safeNumber(github.commits_90d);
  const stars = safeNumber(github.stars);
  const forks = safeNumber(github.forks);
  const openIssues = safeNumber(github.open_issues);
  const lastCommitDate = github?.last_commit?.date ? new Date(github.last_commit.date) : null;
  const daysSinceCommit = lastCommitDate && !Number.isNaN(lastCommitDate.getTime())
    ? (Date.now() - lastCommitDate.getTime()) / 86400000
    : null;
  const issuePressure = commits90d > 0 ? openIssues / commits90d : openIssues > 0 ? openIssues : 0;

  // Commit trend bonus/penalty (new field from improved github collector)
  const commitTrend = github.commit_trend;
  const commits30d = safeNumber(github.commits_30d);
  const commits30dPrev = safeNumber(github.commits_30d_prev);

  let raw = 4;
  raw += Math.min(contributors / 5, 2.5);
  raw += Math.min(commits90d / 30, 2.5);
  raw += stars > 0 ? Math.min(Math.log10(stars + 1), 1) : 0;
  raw += forks > 0 ? Math.min(Math.log10(forks + 1) * 0.5, 0.8) : 0;

  if (daysSinceCommit != null) {
    if (daysSinceCommit <= 7) raw += 0.8;
    else if (daysSinceCommit <= 14) raw += 0.4;
    else if (daysSinceCommit > 180) raw -= Math.min((daysSinceCommit - 180) / 90, 1.2);
  }

  if (issuePressure > 1.5) {
    raw -= Math.min((issuePressure - 1.5) * 0.25, 0.8);
  }

  // Commit trend adjustment
  if (commitTrend === 'accelerating') raw += 0.5;
  else if (commitTrend === 'decelerating') raw -= 0.4;
  else if (commitTrend === 'inactive') raw -= 1.0;

  // Round 29: CI bonus — having CI workflows = professional dev practice
  if (github.has_ci === true) raw += 0.3;
  // Round 238 (AutoResearch): test suite bonus — having explicit test workflows = higher code quality
  if (github.has_test_suite === true) raw += 0.2;  // additional 0.2 on top of CI bonus

  // Round R17 (AutoResearch batch): Issue health signal — healthy issue tracker = active maintenance
  const issueHealthSignal = github.issue_health_signal;
  if (issueHealthSignal === 'healthy') raw += 0.15;
  else if (issueHealthSignal === 'critical') raw -= 0.25; // too many issues relative to stars = backlog problem
  // No adjustment for 'moderate' or null

  // Round 157 (AutoResearch): Issue resolution rate — high close rate = responsive team
  const issueResolutionRate = safeNumber(github.issue_resolution_rate ?? null);
  if (issueResolutionRate > 0) {
    if (issueResolutionRate >= 80) raw += 0.25;      // 80%+ resolved = excellent team responsiveness
    else if (issueResolutionRate >= 60) raw += 0.1;  // 60-80% = decent
    else if (issueResolutionRate < 30) raw -= 0.15;  // <30% = backlog crisis
  }

  // Round 25 (AutoResearch batch): repo health tier bonus
  const repoHealthTier = github.repo_health_tier;
  if (repoHealthTier === 'excellent') raw += 0.4;
  else if (repoHealthTier === 'good') raw += 0.2;
  else if (repoHealthTier === 'poor') raw -= 0.3;

  // Round 33: Star velocity — rapidly growing star count is a health indicator
  // Use watchers as a proxy if forks are very few (niche but real)
  const watchers = safeNumber(github.watchers ?? 0);
  if (stars > 0 && watchers > 0) {
    const watcherStarRatio = watchers / stars;
    if (watcherStarRatio > 0.5 && watchers > 50) raw += 0.2; // many watchers = active maintainer interest
  }

  // Round 33: multi-language repos signal broader ecosystem integration
  const languageCount = typeof github.languages === 'object' ? Object.keys(github.languages ?? {}).length : 0;
  if (languageCount >= 4) raw += 0.15; // polyglot repo = more integrations

  // Round 216 (AutoResearch): use commit_frequency (commits/week) as a smoothed dev pace signal
  // Normalizes for repo age — a 5-year-old protocol with 3 commits/week is different from a new one
  const commitFreq = safeNumber(github.commit_frequency ?? null);
  if (commitFreq > 0) {
    if (commitFreq >= 10) raw += 0.3;      // very active: 10+ commits/week
    else if (commitFreq >= 5) raw += 0.15; // active: 5-10 commits/week
    else if (commitFreq < 0.5) raw -= 0.2; // stale: less than 1 commit per 2 weeks
  }

  // Round 216 (AutoResearch): contributor bus factor penalty
  const busFactor = github.contributor_bus_factor;
  if (busFactor === 'critical') raw -= 0.5; // single dev dominance
  else if (busFactor === 'high') raw -= 0.25;

  // Round 237 (AutoResearch nightly): bus_factor_score (0-100) provides more granular adjustment
  // Supplements the label-based penalty with a continuous score
  const busFactorScore = safeNumber(github.bus_factor_score ?? null);
  if (busFactorScore !== null) {
    // Below 40 = heavily concentrated; above 70 = well distributed
    if (busFactorScore < 30 && busFactor == null) raw -= 0.4; // only apply if label not already used
    else if (busFactorScore > 70 && !busFactor) raw += 0.2;   // distributed team bonus
  }

  // Round 234 (AutoResearch): contributor growth rate bonus
  const contribGrowthRate = github.contributor_growth_rate;
  if (contribGrowthRate === 'growing') raw += 0.3;  // growing team = expanding capacity
  else if (contribGrowthRate === 'shrinking') raw -= 0.3;

  // Round 235 (AutoResearch): commit consistency score bonus
  const commitConsistency = safeNumber(github.commit_consistency_score ?? null);
  if (commitConsistency !== null) {
    if (commitConsistency >= 80) raw += 0.3;       // Very consistent — healthy sustained activity
    else if (commitConsistency >= 60) raw += 0.15;
    else if (commitConsistency < 30) raw -= 0.25;  // Erratic/burst pattern — reliability risk
  }

  // Round 36 (AutoResearch): dev_quality_index — normalized 0-100 composite quality signal
  // Combines all available dev signals into a single normalized score for external consumers
  const dqComponents = [
    Math.min(contributors / 20, 1) * 20,              // contributor breadth (0-20)
    Math.min(commits90d / 100, 1) * 20,               // commit velocity (0-20)
    stars > 0 ? Math.min(Math.log10(stars) / 4, 1) * 15 : 0, // traction (0-15)
    daysSinceCommit != null ? Math.max(0, 1 - daysSinceCommit / 180) * 15 : 7.5, // freshness (0-15)
    github.has_ci ? 8 : 0,                             // CI/CD (0-8)
    repoHealthTier === 'excellent' ? 8 : repoHealthTier === 'good' ? 5 : repoHealthTier === 'moderate' ? 2 : 0, // repo health (0-8)
    languageCount >= 4 ? 4 : languageCount >= 2 ? 2 : 0, // ecosystem breadth (0-4)
    github.license ? 3 : 0,                            // license (0-3)
    // Round 233 (AutoResearch nightly): issue_health_score supplement (0-7)
    github.issue_health_score != null ? Math.round(github.issue_health_score / 100 * 7) : 3,
  ];
  const devQualityIndex = Math.round(dqComponents.reduce((a, b) => a + b, 0));

  return {
    score: clampScore(raw),
    dev_quality_index: Math.min(100, devQualityIndex),
    reasoning: `Contributors ${contributors}, commits (90d) ${commits90d.toLocaleString('en-US')}, commits (last 30d vs prior 30d) ${commits30d.toLocaleString('en-US')}/${commits30dPrev.toLocaleString('en-US')} (trend: ${commitTrend || 'n/a'}), stars ${stars.toLocaleString('en-US')}, forks ${forks.toLocaleString('en-US')}, watchers ${watchers.toLocaleString('en-US')}, languages ${languageCount}, issue pressure ${issuePressure.toFixed(2)}, days since last commit ${daysSinceCommit == null ? 'n/a' : daysSinceCommit.toFixed(0)}${github.has_ci ? ', CI ✓' : ''}, dev_quality_index ${Math.min(100, devQualityIndex)}.`,
  };
}

function scoreTokenomicsRisk(tokenomics = {}) {
  // Round 129 (AutoResearch): No tokenomics data guard → neutral 5.0 (unknown)
  // Note: tokenomics may have an error field AND still carry partial data (fallback values).
  // We check for actual numerical fields, not the error flag, to avoid discarding valid fallbacks.
  const hasTokenomicsData = tokenomics && (
    tokenomics.pct_circulating != null ||
    tokenomics.inflation_rate != null ||
    tokenomics.token_distribution != null
  );
  if (!hasTokenomicsData) {
    return {
      score: 5.0,
      tokenomics_risk_score: 50,
      reasoning: 'No tokenomics data available — defaulting to neutral 5.0.',
    };
  }
  // Cap at 100 — CoinGecko sometimes reports circulating > total due to rounding
  const pctCirculating = Math.min(safeNumber(tokenomics.pct_circulating), 100);
  const inflation = safeNumber(tokenomics.inflation_rate);
  const hasDistribution = tokenomics.token_distribution ? 1 : 0;
  const hasRoiData = tokenomics.roi_data ? 1 : 0;
  const unlockOverhangPct = tokenomics.unlock_overhang_pct != null
    ? safeNumber(tokenomics.unlock_overhang_pct)
    : null;
  const dilutionRisk = tokenomics.dilution_risk;

  // Base 5 (midpoint of 1-10), consistent with other scoring dimensions
  let raw = 5;
  if (pctCirculating > 0) {
    // Reward high circulating supply (less unlock risk), max +2.5 at 100%
    raw += Math.min(pctCirculating / 40, 2.5);
  } else {
    raw -= 1;
  }

  raw -= Math.min(Math.max(inflation, 0) / 10, 3);
  raw += hasDistribution ? 0.5 : -0.5;
  raw += hasRoiData ? 0.3 : 0;

  // Additional dilution risk penalty using unlock overhang
  if (dilutionRisk === 'high') raw -= 1.0;
  else if (dilutionRisk === 'medium') raw -= 0.4;
  // 'low' → no penalty (already captured in pctCirculating bonus)

  // Round 41 (AutoResearch): tokenomics_risk_score — normalized 0-100 risk metric
  // 100 = safe tokenomics, 0 = extreme risk (inverse of typical "risk" labeling)
  const trsComponents = [
    pctCirculating > 0 ? Math.min(pctCirculating / 100, 1) * 35 : 0,      // circulating pct (0-35)
    inflation < 5 ? 25 : inflation < 15 ? 15 : inflation < 30 ? 5 : 0,    // inflation penalty (0-25)
    hasDistribution ? 15 : 0,                                               // has distribution data (0-15)
    dilutionRisk === 'low' ? 15 : dilutionRisk === 'medium' ? 8 : 0,       // dilution risk (0-15)
    unlockOverhangPct !== null && unlockOverhangPct < 20 ? 10 : unlockOverhangPct !== null && unlockOverhangPct < 50 ? 5 : 0, // unlock safety (0-10)
  ];
  const tokenomicsRiskScore = Math.round(Math.min(100, trsComponents.reduce((a, b) => a + b, 0)));

  return {
    score: clampScore(raw),
    tokenomics_risk_score: tokenomicsRiskScore,
    reasoning: `Circulating supply ${pctCirculating.toFixed(2)}%, unlock overhang ${unlockOverhangPct != null ? `${unlockOverhangPct.toFixed(1)}%` : 'n/a'} (${dilutionRisk || 'unknown'} dilution risk), inflation ${inflation.toFixed(2)}%, distribution ${hasDistribution ? 'available' : 'missing'}, tokenomics_risk_score ${tokenomicsRiskScore}/100 (higher=safer).`,
  };
}

function scoreDistribution(tokenomics = {}, market = {}) {
  // Round 131 (AutoResearch): No data guard → neutral 5.0
  const hasDistributionData = tokenomics && (
    tokenomics.pct_circulating != null ||
    tokenomics.token_distribution != null ||
    (market.fully_diluted_valuation != null && market.market_cap != null)
  );
  if (!hasDistributionData) {
    return {
      score: 5.0,
      reasoning: 'No distribution data available — defaulting to neutral 5.0.',
    };
  }

  const dist = tokenomics.token_distribution;
  const pctCirculating = Math.min(safeNumber(tokenomics.pct_circulating), 100);
  const unlockOverhang = tokenomics.unlock_overhang_pct != null ? safeNumber(tokenomics.unlock_overhang_pct) : null;
  const dilutionRisk = tokenomics.dilution_risk;
  const mcap = safeNumber(market.market_cap);
  const fdv = safeNumber(market.fully_diluted_valuation || market.fdv);

  let raw = 5;
  const parts = [];

  // FDV/MCap ratio — high ratio = lots of tokens not yet in circulation
  if (fdv > 0 && mcap > 0) {
    const fdvRatio = fdv / mcap;
    if (fdvRatio <= 1.2) { raw += 2; parts.push(`FDV/MCap ${fdvRatio.toFixed(2)} (excellent)`); }
    else if (fdvRatio <= 2) { raw += 1; parts.push(`FDV/MCap ${fdvRatio.toFixed(2)} (good)`); }
    else if (fdvRatio <= 5) { raw -= 0.5; parts.push(`FDV/MCap ${fdvRatio.toFixed(2)} (moderate dilution risk)`); }
    else { raw -= 1.5; parts.push(`FDV/MCap ${fdvRatio.toFixed(2)} (high dilution risk)`); }
  } else {
    parts.push('FDV/MCap n/a');
  }

  // Circulating supply ratio
  if (pctCirculating > 80) { raw += 1; parts.push(`${pctCirculating.toFixed(0)}% circulating (low risk)`); }
  else if (pctCirculating > 50) { parts.push(`${pctCirculating.toFixed(0)}% circulating`); }
  else if (pctCirculating > 0) { raw -= 1; parts.push(`${pctCirculating.toFixed(0)}% circulating (high unlock risk)`); }

  // Unlock overhang
  if (unlockOverhang != null) {
    if (unlockOverhang > 40) { raw -= 1; parts.push(`unlock overhang ${unlockOverhang.toFixed(0)}% (dangerous)`); }
    else if (unlockOverhang > 20) { raw -= 0.5; parts.push(`unlock overhang ${unlockOverhang.toFixed(0)}%`); }
    else { raw += 0.5; parts.push(`unlock overhang ${unlockOverhang.toFixed(0)}% (safe)`); }
  }

  // Dilution risk tier
  if (dilutionRisk === 'high') raw -= 0.5;
  else if (dilutionRisk === 'low') raw += 0.3;

  // Distribution data availability bonus
  if (dist) { raw += 0.3; parts.push('distribution data available'); }

  return {
    score: clampScore(raw),
    reasoning: parts.join(', ') || 'No distribution data available.',
  };
}

// ─── Round 11: Risk score ─────────────────────────────────────────────────────
/**
 * Composite risk score (1–10 where 10 = LOW risk / safest).
 * Components: volatility, liquidity depth, concentration risk, age risk.
 */
function scoreRisk(market = {}, onchain = {}, tokenomics = {}, dexData = {}, holderData = {}) {
  // Round 134 (AutoResearch): Empty risk data guard
  // When all risk-relevant fields are absent, return neutral 5.0 instead of optimistic 6.0
  const hasRiskData = (
    (market.price_change_pct_24h != null || market.price_change_pct_7d != null) ||
    (dexData.dex_liquidity_usd != null || dexData.liquidity != null) ||
    (holderData.top10_concentration != null || holderData.concentration_pct != null) ||
    market.genesis_date != null
  );
  if (!hasRiskData) {
    return {
      score: 5.0,
      liquidity_risk_score: 0,
      reasoning: 'No risk data available — defaulting to neutral 5.0 (unknown risk profile).',
    };
  }

  let raw = 6; // Start slightly above midpoint (assume moderate risk by default)

  // 1. Volatility risk: large price swings = higher risk
  const change24h = Math.abs(safeNumber(market.price_change_pct_24h));
  const change7d  = Math.abs(safeNumber(market.price_change_pct_7d));
  // Round 147 (AutoResearch): cap inputs at 200% to prevent astronomical volatility
  // from dominating the entire risk score (e.g. +10000% pump doesn't need extra scoring)
  const cappedChange24h = Math.min(change24h, 200);
  const cappedChange7d = Math.min(change7d, 200);
  const volatility = (cappedChange24h * 0.6) + (cappedChange7d * 0.4);
  if (volatility > 100) raw -= 3.0; // extreme: likely exploit or severe pump/dump
  else if (volatility > 30) raw -= 2.5;
  else if (volatility > 15) raw -= 1.5;
  else if (volatility > 7)  raw -= 0.7;
  else if (volatility < 3)  raw += 0.5; // Very stable = lower risk

  // Round 156 (AutoResearch): 90-day realized annualized volatility supplement
  // High realized vol = structural risk; low realized vol = mature, stable asset
  const realizedVol90d = safeNumber(market.realized_vol_90d ?? null);
  if (realizedVol90d > 0) {
    if (realizedVol90d > 300) raw -= 0.8;       // annualized >300% = extreme structural volatility
    else if (realizedVol90d > 150) raw -= 0.4;  // annualized >150% = high
    else if (realizedVol90d < 40) raw += 0.3;   // annualized <40% = mature/stable
  }

  // 2. Liquidity depth: use DEX data if available, otherwise volume/mcap proxy
  const dexLiquidity = safeNumber(dexData.liquidity ?? dexData.total_liquidity ?? dexData.dex_liquidity_usd);
  const mcap   = safeNumber(market.market_cap);
  const volume = safeNumber(market.total_volume);
  if (dexLiquidity > 0) {
    const liqScore = Math.min(Math.log10(dexLiquidity + 1), 7);
    raw += (liqScore - 4) * 0.3; // ±0.9 range
  } else if (mcap > 0 && volume > 0) {
    const volRatio = volume / mcap;
    if (volRatio > 0.1) raw += 0.5;
    else if (volRatio < 0.01) raw -= 0.8; // Very illiquid
  }

  // Round 234 (AutoResearch): liquidity_depth_score supplement — composite DEX quality signal
  const liqDepthScore = safeNumber(dexData.liquidity_depth_score ?? null);
  if (liqDepthScore > 0) {
    // Map 0-100 score to ±0.5 adjustment (centered at 50)
    const liqAdj = ((liqDepthScore - 50) / 100) * 1.0;
    raw += liqAdj;
  }

  // 3. Concentration risk: whale concentration = higher risk (lower score)
  const topConcentration = safeNumber(
    holderData.top10_concentration ?? holderData.concentration_pct ?? 0
  );
  if (topConcentration > 60) raw -= 2;
  else if (topConcentration > 40) raw -= 1;
  else if (topConcentration > 20) raw -= 0.4;
  else if (topConcentration > 0 && topConcentration <= 15) raw += 0.5; // Well distributed

  // 4. Age risk: very new projects carry more uncertainty
  const genesisDate = market.genesis_date ?? tokenomics.genesis_date;
  if (genesisDate) {
    const ageMonths = (Date.now() - new Date(genesisDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonths < 2)  raw -= 1.5;
    else if (ageMonths < 6)  raw -= 0.8;
    else if (ageMonths > 36) raw += 0.5; // Battle-tested
  }

  // 5. FDV/MCap extreme ratio = token unlock risk
  const fdv = safeNumber(market.fully_diluted_valuation ?? market.fdv);
  if (fdv > 0 && mcap > 0) {
    const fdvRatio = fdv / mcap;
    if (fdvRatio > 10) raw -= 1.5;
    else if (fdvRatio > 5) raw -= 0.7;
  }

  // Round 12 (AutoResearch batch): DEX liquidity category bonus/penalty
  const liquidityCategory = dexData.liquidity_category;
  if (liquidityCategory === 'deep') raw += 0.6;
  else if (liquidityCategory === 'adequate') raw += 0.3;
  else if (liquidityCategory === 'shallow') raw -= 0.2;
  else if (liquidityCategory === 'very_shallow') raw -= 0.8;

  // Round 24: revenue_efficiency bonus — protocols generating fees relative to TVL are less risky
  const revEfficiency = safeNumber(onchain.revenue_efficiency ?? 0);
  if (revEfficiency > 100) raw += 0.5;   // >$100/week per $1M TVL = good efficiency
  else if (revEfficiency > 20) raw += 0.2;

  // Round 5: DEX buy/sell pressure — net buy pressure = lower risk, sell pressure = higher risk
  const pressureSignal = dexData.pressure_signal;
  const buySellRatio = safeNumber(dexData.buy_sell_ratio ?? 1);
  if (pressureSignal === 'buy_pressure') {
    raw += Math.min((buySellRatio - 1) * 0.5, 0.5); // max +0.5 for strong buy pressure
  } else if (pressureSignal === 'sell_pressure') {
    raw -= Math.min((1 - buySellRatio) * 0.8, 0.8); // max -0.8 for strong sell pressure
  }

  // Round R28 (AutoResearch batch): Micro-cap extreme volatility risk
  // Small market caps amplify volatility; a $2M mcap with 50% daily swings is existential
  if (mcap > 0 && mcap < 5_000_000 && volatility > 20) {
    raw -= 0.8; // Additional penalty: micro-cap + high volatility = extreme risk
  }

  // Round R28: Volume spike risk — abnormal volume relative to 7d avg = manipulation signal
  const vol7dAvgR = safeNumber(market.volume_7d_avg ?? 0);
  if (vol7dAvgR > 0 && volume > 0 && volume > vol7dAvgR * 8) {
    raw -= 0.5; // Sudden volume spike = wash trading or exit pump risk
  }

  // Round 217 (AutoResearch): volume_spike_flag from market collector — tiered risk penalties
  const volumeSpikeFlag = market.volume_spike_flag;
  if (volumeSpikeFlag === 'extreme_spike') raw -= 0.6; // 5x+ avg = very suspicious
  else if (volumeSpikeFlag === 'spike') raw -= 0.3;    // 3-5x avg = caution
  // 'elevated' is borderline — no penalty, just informational

  // Round 58 (AutoResearch): liquidity_risk_score — 0-100 normalized (higher = safer/more liquid)
  const lrsComponents = [
    dexLiquidity > 0 ? Math.min(Math.log10(dexLiquidity + 1) / 8, 1) * 40 : (mcap > 0 && volume / mcap > 0.05 ? 15 : 5), // liquidity depth (0-40)
    topConcentration > 0 ? Math.max(0, (1 - topConcentration / 100)) * 30 : 15, // holder diversification (0-30)
    volatility < 5 ? 20 : volatility < 15 ? 12 : volatility < 30 ? 5 : 0, // volatility penalty (0-20)
    liquidityCategory === 'deep' ? 10 : liquidityCategory === 'adequate' ? 6 : liquidityCategory === 'shallow' ? 2 : 0, // DEX category (0-10)
  ];
  const liquidityRiskScore = Math.round(Math.min(100, lrsComponents.reduce((a, b) => a + b, 0)));

  return {
    score: clampScore(raw),
    liquidity_risk_score: liquidityRiskScore,
    reasoning: `Volatility ${volatility.toFixed(1)}%, liquidity ${dexLiquidity > 0 ? `$${dexLiquidity.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `volume/market cap ${mcap > 0 ? (volume / mcap).toFixed(3) : 'n/a'}`}, concentration ${topConcentration > 0 ? `${topConcentration.toFixed(1)}%` : 'n/a'}, revenue efficiency ${revEfficiency > 0 ? `$${revEfficiency.toFixed(0)}/$1M TVL/week` : 'n/a'}${pressureSignal ? `, DEX ${pressureSignal} (buy/sell ratio: ${buySellRatio.toFixed(2)})` : ''}, liquidity_risk_score ${liquidityRiskScore}/100.`,
  };
}

// ─── Round 17: Sector-relative scoring ───────────────────────────────────────
/**
 * Adjust dimension scores relative to sector medians.
 * Returns each dimension with both raw_score and sector_adjusted_score.
 *
 * @param {object} scores           - calculateScores() result
 * @param {object} sectorComparison - { tvl_median, mcap_median, ... }
 */
export function applySectorRelativeScoring(scores, sectorComparison = {}) {
  const adjusted = {};
  const sc = sectorComparison;

  for (const [dim, val] of Object.entries(scores)) {
    if (dim === 'overall' || typeof val !== 'object' || val.score == null) {
      adjusted[dim] = val;
      continue;
    }

    let adjustment = 0;

    if (dim === 'onchain_health') {
      const tvl = safeNumber(sc.project_tvl ?? sc.tvl);
      const tvlMedian = safeNumber(sc.tvl_median);
      if (tvl > 0 && tvlMedian > 0) {
        const ratio = tvl / tvlMedian;
        if (ratio >= 2)      adjustment = Math.min((ratio - 1) * 0.5, 1.0); // Up to +1.0
        else if (ratio < 0.5) adjustment = Math.max((ratio - 1) * 0.5, -0.5); // Down to -0.5
      }
    }

    if (dim === 'market_strength') {
      const mcap = safeNumber(sc.project_mcap ?? sc.mcap);
      const mcapMedian = safeNumber(sc.mcap_median);
      if (mcap > 0 && mcapMedian > 0 && mcap < mcapMedian) {
        const ratio = mcap / mcapMedian;
        adjustment = Math.max((ratio - 1) * 0.4, -0.4); // Slight penalty up to -0.4
      }
    }

    adjusted[dim] = {
      ...val,
      raw_score: val.score,
      sector_adjusted_score: clampScore(val.score + adjustment),
      sector_adjustment: parseFloat(adjustment.toFixed(2)),
    };
  }

  if (scores.overall) {
    adjusted.overall = scores.overall;
  }

  return adjusted;
}

function collectorCompleteness(data = {}) {
  const sections = ['market', 'onchain', 'social', 'github', 'tokenomics'];
  const ok = sections.filter((key) => data?.[key] && !data[key].error).length;
  return ok / sections.length;
}

// Use empty object only when a collector truly has no usable data.
// Some collectors return partial data plus an `error` string (e.g. tokenomics
// fallback values when Messari is unavailable). We should still score those.
function safeCollector(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const hasUsableData = Object.entries(raw).some(([key, value]) => {
    if (key === 'error' || key === 'project_name') return false;
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  });

  return hasUsableData ? raw : {};
}

// ─── Round 9: Reddit sentiment supplement ────────────────────────────────────
/**
 * Adjust social momentum score using Reddit post count and sentiment.
 * Small adjustment (+/-0.5) to avoid over-weighting uncurated posts.
 */
function applyRedditSupplement(socialScore, reddit = {}) {
  if (!reddit || reddit.error) return socialScore;
  const postCount = Number(reddit.post_count ?? 0);
  const sentiment = reddit.sentiment;
  if (postCount === 0) return socialScore;
  let adj = 0;
  if (sentiment === 'bullish' && postCount >= 5) adj = 0.4;
  else if (sentiment === 'bullish' && postCount >= 2) adj = 0.2;
  else if (sentiment === 'bearish' && postCount >= 5) adj = -0.4;
  else if (sentiment === 'bearish' && postCount >= 2) adj = -0.2;
  return Math.min(10, Math.max(1, parseFloat((socialScore + adj).toFixed(1))));
}

export function calculateScores(data) {
  const market_strength   = scoreMarketStrength(safeCollector(data?.market));
  const onchain_health    = scoreOnchainHealth(safeCollector(data?.onchain), data);
  const social_momentum   = scoreSocialMomentum(safeCollector(data?.social));
  const development       = scoreDevelopment(safeCollector(data?.github));
  const tokenomics_health = scoreTokenomicsRisk(safeCollector(data?.tokenomics));
  const distribution      = scoreDistribution(safeCollector(data?.tokenomics), safeCollector(data?.market));

  // Round 237 (AutoResearch nightly): DEX sell wall risk penalty for distribution score
  // Active distribution on DEX combined with high unlock risk = compounded negative pressure on holders
  const dexSellWallRisk = data?.dex?.sell_wall_risk;
  if (dexSellWallRisk === 'high') {
    distribution.score = clampScore(distribution.score - 0.6);
    distribution.reasoning += ' | DEX sell_wall_risk HIGH: organized exit pattern detected (-0.6).';
  } else if (dexSellWallRisk === 'elevated') {
    distribution.score = clampScore(distribution.score - 0.3);
    distribution.reasoning += ' | DEX sell_wall_risk ELEVATED: moderate distribution pressure (-0.3).';
  }

  // Round 237b (AutoResearch nightly): reddit_activity_score supplement to social momentum
  // A high reddit_activity_score (upvote-weighted, recency-adjusted) = stronger community signal
  const redditActivityScore = safeNumber(data?.reddit?.reddit_activity_score ?? null);
  if (redditActivityScore !== null && redditActivityScore > 0) {
    // Map 0-100 activity score to ±0.2 adjustment (centered at 40)
    const redditAdj = ((redditActivityScore - 40) / 100) * 0.4;
    social_momentum.score = clampScore(social_momentum.score + redditAdj);
  }

  // Round 9: Reddit supplement to social momentum
  social_momentum.score = applyRedditSupplement(social_momentum.score, data?.reddit);

  // Round 14 (AutoResearch nightly): news momentum supplement to social score
  const newsMom = data?.social?.news_momentum;
  if (newsMom === 'accelerating') {
    social_momentum.score = Math.min(10, parseFloat((social_momentum.score + 0.3).toFixed(1)));
  } else if (newsMom === 'declining') {
    social_momentum.score = Math.max(1, parseFloat((social_momentum.score - 0.15).toFixed(1)));
  }

  // Round 29 (AutoResearch batch): narrative momentum supplement
  social_momentum.score = applyNarrativeMomentumBonus(social_momentum.score, data?.narrative_momentum ?? null);

  // Round 31 (AutoResearch): X/Twitter social supplement — KOL-weighted sentiment
  // x_social provides higher-quality data (real Twitter search via Grok) vs Exa web mentions
  const xSocial = data?.x_social ?? {};
  if (!xSocial.error && xSocial.sentiment_score != null) {
    const xSentScore = safeNumber(xSocial.sentiment_score); // -1 to +1
    const xVolume = xSocial.mention_volume; // 'high' | 'medium' | 'low' | 'none'
    const xKolSentiment = xSocial.kol_sentiment; // 'bullish' | 'bearish' | 'neutral' | 'mixed'

    // Volume weight: more mentions = more reliable signal
    const xVolumeWeight = xVolume === 'high' ? 1.0 : xVolume === 'medium' ? 0.7 : xVolume === 'low' ? 0.4 : 0;

    // Base X sentiment adjustment (max ±0.5 from x_social)
    const xSentAdj = xSentScore * 0.5 * xVolumeWeight;

    // KOL bonus: if KOL sentiment aligns with overall sentiment, amplify slightly
    let kolBonus = 0;
    if (xKolSentiment === 'bullish' && xSentScore > 0.3) kolBonus = 0.15;
    else if (xKolSentiment === 'bearish' && xSentScore < -0.3) kolBonus = -0.15;

    social_momentum.score = clampScore(social_momentum.score + xSentAdj + kolBonus);
    social_momentum.reasoning += ` | X/Twitter: sentiment ${xSentScore.toFixed(2)}, volume ${xVolume ?? 'n/a'}, KOL ${xKolSentiment ?? 'n/a'} (adj ${(xSentAdj + kolBonus).toFixed(2)}).`;
  }

  // Round 11: Risk as 7th dimension
  const risk = scoreRisk(
    safeCollector(data?.market),
    safeCollector(data?.onchain),
    safeCollector(data?.tokenomics),
    data?.dex ?? data?.dexData ?? {},
    data?.holders ?? data?.holderData ?? {}
  );

  const completeness = collectorCompleteness(data);

  // Round 18: Confidence per dimension
  const confidence = calculateConfidence(data ?? {});
  market_strength.confidence   = confidence.market;
  onchain_health.confidence    = confidence.onchain;
  social_momentum.confidence   = confidence.social;
  development.confidence       = confidence.development;
  tokenomics_health.confidence = confidence.tokenomics;
  distribution.confidence      = confidence.tokenomics; // shares tokenomics data source
  risk.confidence              = Math.round((confidence.market + confidence.onchain + confidence.tokenomics) / 3);

  // Round (Pipeline): Confidence-weighted scoring — low confidence pulls toward neutral (5.0)
  // adjusted = score * (confidence/100) + 5.0 * (1 - confidence/100)
  const NEUTRAL = 5.0;
  const applyConfidenceWeight = (dim) => {
    if (dim.confidence == null || dim.score == null) return;
    const conf = dim.confidence / 100; // 0-1
    dim.raw_score = dim.score;
    dim.score = clampScore(dim.score * conf + NEUTRAL * (1 - conf));
    dim.confidence_label = dim.confidence < 30 ? 'Unreliable'
      : dim.confidence < 60 ? 'Low'
      : dim.confidence < 80 ? 'Moderate'
      : 'High';
  };

  applyConfidenceWeight(market_strength);
  applyConfidenceWeight(onchain_health);
  applyConfidenceWeight(social_momentum);
  applyConfidenceWeight(development);
  applyConfidenceWeight(tokenomics_health);
  applyConfidenceWeight(distribution);
  applyConfidenceWeight(risk);

  // 7-dimension weights (Round 11): original 6 each reduced ~1.5%, new risk at 10%
  // Kept as documentation/backward-compat reference — actual calculation uses category-adaptive weights.
  const WEIGHTS = {
    market:      0.19, // Price/liquidity is a primary reality check, so market structure gets top billing.
    onchain:     0.19, // For onchain projects, sustained usage/capital retention deserves equal weight to market action.
    social:      0.12, // Social matters for reflexivity, but we keep it lower because narrative is noisier/manipulable.
    development: 0.16, // Shipping velocity is a strong medium-term signal, especially when market data is early/noisy.
    tokenomics:  0.14, // Supply mechanics materially affect upside/downside, but should not dominate alone.
    distribution: 0.14, // Holder/unlock structure deserves separate weight because concentration can break otherwise good projects.
    risk:        0.10, // Explicit risk check tempers bullish dimensions without overwhelming the composite score.
  };

  // Phase 3: Category-adaptive weighting
  const categoryResult = getCategoryWeights(data);
  const W = categoryResult.weights;

  let overallValue =
    market_strength.score   * W.market +
    onchain_health.score    * W.onchain +
    social_momentum.score   * W.social +
    development.score       * W.development +
    tokenomics_health.score * W.tokenomics +
    distribution.score      * W.distribution +
    risk.score              * W.risk;

  // Penalize when data is incomplete — max -2 points when all collectors fail
  if (completeness < 1) {
    const penalty = (1 - completeness) * 2;
    overallValue = Math.max(1, overallValue - penalty);
  }

  // Round 54: confidence-weighted regression to mean — low confidence pulls score toward 5.5
  // Prevents extreme scores (1 or 10) from appearing authoritative with sparse data
  const overallConf = confidence.overall_confidence;
  if (overallConf < 60) {
    const regressionStrength = (60 - overallConf) / 60; // 0 at 60% conf, 1 at 0% conf
    const NEUTRAL = 5.5;
    overallValue = overallValue + (NEUTRAL - overallValue) * regressionStrength * 0.4; // max 40% pull toward neutral
  }

  const weightStr = Object.entries(W)
    .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
    .join(', ');

  // Round 22 (AutoResearch nightly): Score anomaly detection — flag unusual score spread
  const allDimScores = [
    market_strength.score, onchain_health.score, social_momentum.score,
    development.score, tokenomics_health.score, distribution.score, risk.score
  ].filter(Number.isFinite);
  const dimMean = allDimScores.reduce((a, b) => a + b, 0) / allDimScores.length;
  const dimVariance = allDimScores.reduce((s, v) => s + (v - dimMean) ** 2, 0) / allDimScores.length;
  const dimStddev = Math.sqrt(dimVariance);
  // High std dev (>2) = wildly uneven performance across dimensions — signals fragility
  const scoreAnomaly = dimStddev > 2.5 ? 'high_variance' : dimStddev > 1.5 ? 'moderate_variance' : 'normal';

  // Circuit breakers — cap score based on structural risks (post-processing)
  const redFlagsForBreakers = typeof detectRedFlags === 'function'
    ? detectRedFlags(data)
    : [];
  const breakerResult = applyCircuitBreakers(
    overallValue,
    data,
    {
      market_strength,
      onchain_health,
      social_momentum,
      development,
      tokenomics_health,
      distribution,
      risk,
      overall: { completeness: Math.round(completeness * 100) },
    },
    redFlagsForBreakers
  );

  // Se lo score è stato cappato, usa il valore cappato
  if (breakerResult.capped) {
    overallValue = breakerResult.score;
  }

  return {
    market_strength,
    onchain_health,
    social_momentum,
    development,
    tokenomics_health,
    distribution,
    risk,
    overall: {
      score: clampScore(overallValue),
      completeness: Math.round(completeness * 100),
      overall_confidence: confidence.overall_confidence,
      score_anomaly: scoreAnomaly,
      dim_stddev: parseFloat(dimStddev.toFixed(2)),
      reasoning: `Weighted blend: ${weightStr}. Data completeness: ${Math.round(completeness * 100)}%. Overall confidence: ${confidence.overall_confidence}%. Score spread: ${scoreAnomaly} (stddev ${dimStddev.toFixed(2)}).`,
      circuit_breakers: breakerResult.capped ? breakerResult : null,
      // Phase 3: category-adaptive weighting metadata
      category: categoryResult.category,
      category_confidence: categoryResult.confidence,
      category_source: categoryResult.source,
      weights_used: categoryResult.weights,
    },
  };
}

// ─── Re-export companion services for unified import ─────────────────────────
export { detectRedFlags }   from '../services/red-flags.js';
export { detectAlphaSignals } from '../services/alpha-signals.js';
export { calculateMomentum }  from '../services/momentum.js';
export { generateThesis }     from '../services/thesis-generator.js';
export { storeScores, getPercentile, getAllPercentiles, initScoreHistory } from '../services/percentile-store.js';
export { calibrateScores }    from '../services/score-calibration.js';
