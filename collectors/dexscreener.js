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

    return {
      ...fallback,
      dex_volume_24h: totalVolume24h > 0 ? totalVolume24h : null,
      dex_liquidity_usd: totalLiquidity > 0 ? totalLiquidity : null,
      dex_pair_count: pairs.length,
      top_dex_name: topDexName || topPair?.dexId || null,
      dex_price_usd: Number(topPair?.priceUsd || 0) || null,
      dex_chains: [...chains],
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'DexScreener timeout' : error.message,
    };
  }
}
