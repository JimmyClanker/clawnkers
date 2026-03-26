import { fetchJson } from './fetch.js';

const DEXSCREENER_SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search';

function createEmptyDexResult(projectName) {
  return {
    project_name: projectName,
    dex_volume_24h: null,
    dex_liquidity_usd: null,
    dex_pair_count: null,
    top_dex_name: null,
    dex_price_usd: null,
    dex_chains: [],
    // Round 3: price change from DexScreener (h1, h24, h6) for freshness
    // Round 238 (AutoResearch): added m5 for ultra-short-term momentum
    dex_price_change_m5: null,
    dex_price_change_h1: null,
    dex_price_change_h24: null,
    dex_price_change_h6: null,
    // Round 3: top pair liquidity concentration
    top_pair_liquidity_pct: null,
    // Round 2: buy/sell pressure from 24h txns
    buys_24h: null,
    sells_24h: null,
    buy_sell_ratio: null,   // >1 = more buyers, <1 = more sellers
    pressure_signal: null,  // 'buy_pressure' | 'sell_pressure' | 'balanced' | null
    // Round 39: enhanced signals
    pump_dump_signal: null,
    avg_liquidity_per_pair: null,
    decent_pairs_count: null,
    error: null,
  };
}

/**
 * Collect DEX trading data for a project from DexScreener.
 * Uses free public API — no key required.
 */
export async function collectDexScreener(projectName) {
  const fallback = createEmptyDexResult(projectName);

  try {
    const url = `${DEXSCREENER_SEARCH_URL}?q=${encodeURIComponent(projectName)}`;
    const data = await fetchJson(url, { timeoutMs: 12000 });

    const pairs = data?.pairs;
    if (!Array.isArray(pairs) || pairs.length === 0) {
      // Round 195 (AutoResearch): surface whether the API returned empty vs malformed response
      const detail = !Array.isArray(pairs) ? 'unexpected API response format' : `0 pairs returned`;
      return { ...fallback, error: `No DEX pairs found (${detail})` };
    }

    // Sort by 24h volume descending to find the most relevant pair
    const sorted = [...pairs].sort(
      (a, b) => Number(b?.volume?.h24 || 0) - Number(a?.volume?.h24 || 0)
    );

    // === CRITICAL: Filter out fake/scam pairs with inflated liquidity ===
    // DexScreener returns pairs where liquidity is fake (billions of $ but $4 volume).
    // Heuristic: if a pair has >$1M liquidity but <$100 24h volume, it's likely fake.
    // Also cap liquidity/volume ratio: legitimate pairs rarely exceed 1000:1.
    const validPairs = sorted.filter((pair) => {
      const vol = Number(pair?.volume?.h24 || 0);
      const liq = Number(pair?.liquidity?.usd || 0);

      // Filter 1: Pairs with huge liquidity but near-zero volume are fake
      if (liq > 1_000_000 && vol < 100) return false;

      // Filter 2: Liquidity/volume ratio sanity check
      // Real trading pairs rarely have liq > 1000x daily volume
      if (vol > 0 && liq / vol > 5000) return false;

      // Filter 3: Pairs with zero volume AND >$10K liquidity are suspicious
      if (vol === 0 && liq > 10_000) return false;

      return true;
    });

    // Use filtered pairs for aggregation, but keep original sorted for topPair fallback
    const effectivePairs = validPairs.length > 0 ? validPairs : sorted.slice(0, 1);
    const topPair = effectivePairs[0] || sorted[0];

    // Log filtering stats if significant
    if (validPairs.length < pairs.length) {
      const removed = pairs.length - validPairs.length;
      console.log(`[dexscreener] Filtered ${removed}/${pairs.length} suspicious pairs for ${projectName} (fake liquidity)`);
    }

    // Aggregate totals across FILTERED pairs only
    let totalVolume24h = 0;
    let totalLiquidity = 0;
    const dexNames = new Map(); // dexId → total volume
    const chains = new Set();

    for (const pair of effectivePairs) {
      const vol = Number(pair?.volume?.h24 || 0);
      const liq = Number(pair?.liquidity?.usd || 0);
      totalVolume24h += vol;
      totalLiquidity += liq;

      const dexId = pair?.dexId || pair?.dexName;
      if (dexId) {
        dexNames.set(dexId, (dexNames.get(dexId) || 0) + vol);
      }

      const chain = pair?.chainId;
      if (chain) chains.add(chain);
    }

    // Top DEX by volume
    let topDexName = null;
    let topDexVol = -Infinity;
    for (const [name, vol] of dexNames.entries()) {
      if (vol > topDexVol) {
        topDexVol = vol;
        topDexName = name;
      }
    }

    // Round 3: price changes from top pair
    // Round 238 (AutoResearch): also capture 5m change for ultra-short-term momentum signal
    const dexPriceChangeH1 = topPair?.priceChange?.h1 != null ? Number(topPair.priceChange.h1) : null;
    const dexPriceChangeH24 = topPair?.priceChange?.h24 != null ? Number(topPair.priceChange.h24) : null;
    const dexPriceChangeH6 = topPair?.priceChange?.h6 != null ? Number(topPair.priceChange.h6) : null;
    const dexPriceChangeM5 = topPair?.priceChange?.m5 != null ? Number(topPair.priceChange.m5) : null;

    // Round 3: top pair liquidity concentration (how dominant the top pair is)
    const topPairLiq = Number(topPair?.liquidity?.usd || 0);
    const topPairLiqPct = totalLiquidity > 0 ? (topPairLiq / totalLiquidity) * 100 : null;

    // Round 2: aggregate buy/sell pressure from txns across FILTERED pairs
    let totalBuys24h = 0;
    let totalSells24h = 0;
    for (const pair of effectivePairs) {
      totalBuys24h += Number(pair?.txns?.h24?.buys || 0);
      totalSells24h += Number(pair?.txns?.h24?.sells || 0);
    }
    const hasTxnData = totalBuys24h > 0 || totalSells24h > 0;
    const buySellRatio = hasTxnData && totalSells24h > 0
      ? Math.round((totalBuys24h / totalSells24h) * 100) / 100
      : hasTxnData ? 99 : null;
    let pressureSignal = null;
    if (buySellRatio !== null) {
      if (buySellRatio >= 1.15) pressureSignal = 'buy_pressure';
      else if (buySellRatio <= 0.87) pressureSignal = 'sell_pressure';
      else pressureSignal = 'balanced';
    }

    // Round 39: detect pump/dump patterns from price changes
    let pumpDumpSignal = null;
    if (dexPriceChangeH1 != null && dexPriceChangeH24 != null) {
      const recentVsDay = dexPriceChangeH1 - (dexPriceChangeH24 / 24);
      if (dexPriceChangeH1 > 15 && dexPriceChangeH24 > 30) {
        pumpDumpSignal = 'possible_pump';
      } else if (dexPriceChangeH1 < -10 && dexPriceChangeH24 < -20) {
        pumpDumpSignal = 'possible_dump';
      } else if (Math.abs(recentVsDay) > 20) {
        pumpDumpSignal = 'volatile_reversal';
      }
    }

    // Round 39: average liquidity per pair (quality indicator) — use filtered pairs
    const avgLiquidityPerPair = effectivePairs.length > 0 && totalLiquidity > 0
      ? Math.round(totalLiquidity / effectivePairs.length)
      : null;

    // Round 236 (AutoResearch): median liquidity per pair — robust quality indicator
    // Median is more resistant to outliers than avg (one massive pair doesn't inflate the metric)
    const medianLiquidityPerPair = (() => {
      if (effectivePairs.length === 0) return null;
      const sorted = effectivePairs.map((p) => Number(p?.liquidity?.usd || 0)).sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
    })();

    // Round 39: count pairs with meaningful liquidity (>$50K) — among filtered pairs
    const decentPairsCount = effectivePairs.filter((p) => Number(p?.liquidity?.usd ?? 0) >= 50_000).length;

    // Round 154 (AutoResearch): per-chain liquidity breakdown — identifies chain concentration risk
    const chainLiquidityMap = {};
    for (const pair of effectivePairs) {
      const chain = pair?.chainId || 'unknown';
      const liq = Number(pair?.liquidity?.usd || 0);
      chainLiquidityMap[chain] = (chainLiquidityMap[chain] || 0) + liq;
    }
    const chainLiquidityBreakdown = Object.entries(chainLiquidityMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .reduce((acc, [chain, liq]) => { acc[chain] = liq; return acc; }, {});

    // Round 154 (AutoResearch): volume trend from h1/h6/h24 ratios — is volume accelerating?
    // Use top pair's 1h volume annualized vs 24h volume to gauge intraday momentum
    const h1Vol = Number(topPair?.volume?.h1 || 0);
    const h6Vol = Number(topPair?.volume?.h6 || 0);
    const h24Vol = Number(topPair?.volume?.h24 || 0);
    let volumeMomentum = null;
    if (h1Vol > 0 && h24Vol > 0) {
      const h1Annualized = h1Vol * 24;
      const ratio = h1Annualized / h24Vol;
      if (ratio >= 1.5) volumeMomentum = 'accelerating';
      else if (ratio <= 0.5) volumeMomentum = 'decelerating';
      else volumeMomentum = 'stable';
    }

    // Round 11 (AutoResearch batch): DEX diversity score — how spread across DEXs?
    const dexDiversityScore = dexNames.size >= 5 ? 'high' : dexNames.size >= 3 ? 'moderate' : dexNames.size >= 2 ? 'low' : 'concentrated';

    // Round 185 (AutoResearch): volume-to-liquidity ratio — high ratio = capital-efficient pair
    // > 1.0 means the pair turns over its full liquidity daily (high efficiency)
    const volumeToLiquidityRatio = (totalLiquidity > 0 && totalVolume24h > 0)
      ? parseFloat((totalVolume24h / totalLiquidity).toFixed(4))
      : null;

    // Round 11 (AutoResearch batch): Liquidity depth category for risk assessment
    let liquidityCategory = null;
    if (totalLiquidity >= 10_000_000) liquidityCategory = 'deep';
    else if (totalLiquidity >= 1_000_000) liquidityCategory = 'adequate';
    else if (totalLiquidity >= 100_000) liquidityCategory = 'shallow';
    else if (totalLiquidity > 0) liquidityCategory = 'very_shallow';

    // Round 3 (AutoResearch nightly): Liquidity health score (0–100) combining depth + diversity + pair quality
    const liquidityHealthScore = (() => {
      let lhs = 0;
      // Depth component (0-40)
      if (totalLiquidity >= 10_000_000) lhs += 40;
      else if (totalLiquidity >= 1_000_000) lhs += 30;
      else if (totalLiquidity >= 500_000) lhs += 20;
      else if (totalLiquidity >= 100_000) lhs += 10;
      else if (totalLiquidity >= 10_000) lhs += 5;
      // Diversity component (0-30)
      if (dexNames.size >= 5) lhs += 30;
      else if (dexNames.size >= 3) lhs += 20;
      else if (dexNames.size >= 2) lhs += 10;
      // Quality component: decent pairs (0-30)
      if (decentPairsCount >= 5) lhs += 30;
      else if (decentPairsCount >= 3) lhs += 20;
      else if (decentPairsCount >= 1) lhs += 10;
      return lhs;
    })();

    return {
      ...fallback,
      dex_volume_24h: totalVolume24h > 0 ? totalVolume24h : null,
      dex_liquidity_usd: totalLiquidity > 0 ? totalLiquidity : null,
      dex_pair_count: effectivePairs.length,
      dex_pairs_filtered: pairs.length - effectivePairs.length,
      top_dex_name: topDexName || topPair?.dexId || null,
      dex_price_usd: Number(topPair?.priceUsd || 0) || null,
      dex_chains: [...chains],
      // Round 198 (AutoResearch): top pair identifiers for direct DexScreener linking
      top_pair_address: topPair?.pairAddress || null,
      top_pair_chain: topPair?.chainId || null,
      // Round 211 (AutoResearch): net_buy_pressure_pct — % of transactions that are buys
      // Simple but effective: >55% buys = net accumulation, <45% = net distribution
      net_buy_pressure_pct: hasTxnData && (totalBuys24h + totalSells24h) > 0
        ? parseFloat((totalBuys24h / (totalBuys24h + totalSells24h) * 100).toFixed(1))
        : null,
      // Round 207 (AutoResearch): h6 volume as % of 24h — high pct = activity concentrated in last 6h
      h6_volume_pct_of_24h: (h6Vol > 0 && h24Vol > 0)
        ? parseFloat(((h6Vol / h24Vol) * 100).toFixed(1))
        : null,
      dex_price_change_m5: dexPriceChangeM5,
      dex_price_change_h1: dexPriceChangeH1,
      dex_price_change_h24: dexPriceChangeH24,
      dex_price_change_h6: dexPriceChangeH6,
      top_pair_liquidity_pct: topPairLiqPct != null ? Math.round(topPairLiqPct * 10) / 10 : null,
      buys_24h: hasTxnData ? totalBuys24h : null,
      sells_24h: hasTxnData ? totalSells24h : null,
      buy_sell_ratio: buySellRatio,
      pressure_signal: pressureSignal,
      pump_dump_signal: pumpDumpSignal,
      avg_liquidity_per_pair: avgLiquidityPerPair,
      median_liquidity_per_pair: medianLiquidityPerPair,
      decent_pairs_count: decentPairsCount,
      dex_diversity_score: dexDiversityScore,
      volume_to_liquidity_ratio: volumeToLiquidityRatio,
      liquidity_category: liquidityCategory,
      liquidity_health_score: liquidityHealthScore,
      chain_liquidity_breakdown: chainLiquidityBreakdown,
      volume_momentum: volumeMomentum,
      // Round 234 (AutoResearch): liquidity_depth_score — combined quality metric (0-100)
      // Rewards: high liquidity, multiple decent pairs, volume/liquidity health, chain diversity
      liquidity_depth_score: (() => {
        const liq = Number(validPairs.reduce((s, p) => s + Number(p?.liquidity?.usd || 0), 0));
        const pairCount = validPairs.length;
        const chainSet = new Set(validPairs.map((p) => p.chainId).filter(Boolean));
        const chainDiv = chainSet.size;
        // Base from liquidity tiers
        let score = 0;
        if (liq >= 10_000_000) score += 40;
        else if (liq >= 1_000_000) score += 30;
        else if (liq >= 100_000) score += 20;
        else if (liq >= 10_000) score += 10;
        // Pair diversification
        if (pairCount >= 10) score += 25;
        else if (pairCount >= 5) score += 18;
        else if (pairCount >= 2) score += 10;
        else if (pairCount === 1) score += 5;
        // Chain diversification
        if (chainDiv >= 4) score += 20;
        else if (chainDiv >= 2) score += 12;
        else if (chainDiv === 1) score += 5;
        // Volume health bonus
        const v24h = Number(validPairs.reduce((s, p) => s + Number(p?.volume?.h24 || 0), 0));
        if (v24h > 0 && liq > 0 && (v24h / liq) >= 0.1) score += 15;
        return Math.min(100, score);
      })(),
      // Round 237 (AutoResearch nightly): sell_wall_risk — composite signal that a sell wall is forming
      // Criteria: sell pressure + top pair concentrated + volume accelerating → possible coordinated exit
      sell_wall_risk: (() => {
        if (!hasTxnData || !buySellRatio || buySellRatio === null) return null;
        let risk = 0;
        if (buySellRatio < 0.7) risk += 2;          // Strong sell dominance
        else if (buySellRatio < 0.87) risk += 1;    // Moderate sell dominance
        if (topPairLiqPct !== null && topPairLiqPct > 80) risk += 1; // Single pool = fragile
        if (volumeMomentum === 'accelerating' && buySellRatio < 0.87) risk += 1; // Volume spike + sell = distribution
        if (risk >= 3) return 'high';
        if (risk >= 2) return 'elevated';
        if (risk === 1) return 'low';
        return null;
      })(),
      // Round 235 (AutoResearch): most_active_chain — chain with highest 24h volume
      most_active_chain: (() => {
        if (!validPairs.length) return null;
        const byChain = {};
        for (const p of validPairs) {
          const chain = p.chainId;
          if (!chain) continue;
          byChain[chain] = (byChain[chain] || 0) + Number(p?.volume?.h24 || 0);
        }
        const entries = Object.entries(byChain).sort((a, b) => b[1] - a[1]);
        return entries.length > 0 ? entries[0][0] : null;
      })(),
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'DexScreener timeout' : error.message,
    };
  }
}
