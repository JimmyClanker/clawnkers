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
      return { ...fallback, error: 'No DEX pairs found' };
    }

    // Sort by 24h volume descending to find the most relevant pair
    const sorted = [...pairs].sort(
      (a, b) => Number(b?.volume?.h24 || 0) - Number(a?.volume?.h24 || 0)
    );

    const topPair = sorted[0];

    // Aggregate totals across all pairs
    let totalVolume24h = 0;
    let totalLiquidity = 0;
    const dexNames = new Map(); // dexId → total volume
    const chains = new Set();

    for (const pair of pairs) {
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
    const dexPriceChangeH1 = topPair?.priceChange?.h1 != null ? Number(topPair.priceChange.h1) : null;
    const dexPriceChangeH24 = topPair?.priceChange?.h24 != null ? Number(topPair.priceChange.h24) : null;
    const dexPriceChangeH6 = topPair?.priceChange?.h6 != null ? Number(topPair.priceChange.h6) : null;

    // Round 3: top pair liquidity concentration (how dominant the top pair is)
    const topPairLiq = Number(topPair?.liquidity?.usd || 0);
    const topPairLiqPct = totalLiquidity > 0 ? (topPairLiq / totalLiquidity) * 100 : null;

    // Round 2: aggregate buy/sell pressure from txns across all pairs
    let totalBuys24h = 0;
    let totalSells24h = 0;
    for (const pair of pairs) {
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

    // Round 39: average liquidity per pair (quality indicator)
    const avgLiquidityPerPair = pairs.length > 0 && totalLiquidity > 0
      ? Math.round(totalLiquidity / pairs.length)
      : null;

    // Round 39: count pairs with meaningful liquidity (>$50K)
    const decentPairsCount = pairs.filter((p) => Number(p?.liquidity?.usd ?? 0) >= 50_000).length;

    // Round 11 (AutoResearch batch): DEX diversity score — how spread across DEXs?
    const dexDiversityScore = dexNames.size >= 5 ? 'high' : dexNames.size >= 3 ? 'moderate' : dexNames.size >= 2 ? 'low' : 'concentrated';

    // Round 11 (AutoResearch batch): Liquidity depth category for risk assessment
    let liquidityCategory = null;
    if (totalLiquidity >= 10_000_000) liquidityCategory = 'deep';
    else if (totalLiquidity >= 1_000_000) liquidityCategory = 'adequate';
    else if (totalLiquidity >= 100_000) liquidityCategory = 'shallow';
    else if (totalLiquidity > 0) liquidityCategory = 'very_shallow';

    return {
      ...fallback,
      dex_volume_24h: totalVolume24h > 0 ? totalVolume24h : null,
      dex_liquidity_usd: totalLiquidity > 0 ? totalLiquidity : null,
      dex_pair_count: pairs.length,
      top_dex_name: topDexName || topPair?.dexId || null,
      dex_price_usd: Number(topPair?.priceUsd || 0) || null,
      dex_chains: [...chains],
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
      decent_pairs_count: decentPairsCount,
      dex_diversity_score: dexDiversityScore,
      liquidity_category: liquidityCategory,
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'DexScreener timeout' : error.message,
    };
  }
}
