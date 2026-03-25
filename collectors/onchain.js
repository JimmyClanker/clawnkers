import { fetchJson } from './fetch.js';

const LLAMA_PROTOCOLS_URL = 'https://api.llama.fi/protocols';
const LLAMA_PROTOCOL_URL = 'https://api.llama.fi/protocol';
const LLAMA_FEES_URL = 'https://api.llama.fi/summary/fees';
const LLAMA_CHAINS_URL = 'https://api.llama.fi/v2/chains';
const LLAMA_CHAIN_TVL_URL = 'https://api.llama.fi/v2/historicalChainTvl';

function createEmptyOnchainResult(projectName) {
  return {
    project_name: projectName,
    slug: null,
    tvl: null,
    tvl_change_7d: null,
    tvl_change_30d: null,
    chains: [],
    category: null,
    fees_7d: null,
    revenue_7d: null,
    // Round 4: revenue/fees ratio + treasury
    revenue_to_fees_ratio: null,
    treasury_balance: null,
    // Round 11: per-chain TVL breakdown
    chain_tvl: {},
    // Round 11: active users (if available from DeFiLlama)
    active_users_24h: null,
    // Round 21: revenue efficiency (fees_7d per $1M TVL)
    revenue_efficiency: null,
    // Round 6: TVL stickiness ('sticky' | 'moderate' | 'fleeing' | null)
    tvl_stickiness: null,
    // Round 43: TVL data quality ('active' | 'suspect_static' | null)
    tvl_data_quality: null,
    error: null,
  };
}


function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function similarityScore(projectName, protocol) {
  const target = normalize(projectName);
  const name = normalize(protocol?.name);
  const symbol = normalize(protocol?.symbol);
  const slug = normalize(protocol?.slug);

  let score = 0;
  if (!target) return score;
  if (name === target) score += 100;
  if (symbol === target) score += 90;
  if (slug === target) score += 85;
  if (name.includes(target)) score += 60;
  if (target.includes(name) && name) score += 50;
  if (slug.includes(target)) score += 45;
  if (symbol && target.includes(symbol)) score += 35;
  if (protocol?.category) score += 3;
  if (protocol?.chains?.length) score += 2;
  return score;
}

function computePctChange(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function getClosestHistoricalTvl(tvlHistory, daysBack) {
  if (!Array.isArray(tvlHistory) || tvlHistory.length === 0) return null;
  const targetTs = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  let closest = null;
  let smallestDistance = Number.POSITIVE_INFINITY;

  for (const point of tvlHistory) {
    const ts = (point?.date || 0) * 1000;
    const distance = Math.abs(ts - targetTs);
    if (Number.isFinite(point?.totalLiquidityUSD) && distance < smallestDistance) {
      closest = point.totalLiquidityUSD;
      smallestDistance = distance;
    }
  }

  return closest;
}

function sumLastNDays(values, days) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values]
    .filter((item) => Number.isFinite(item?.dailyFees) || Number.isFinite(item?.dailyRevenue))
    .sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0));

  if (!sorted.length) return null;

  const tail = sorted.slice(-days);
  const totals = tail.reduce(
    (acc, item) => {
      acc.fees += Number(item?.dailyFees || 0);
      acc.revenue += Number(item?.dailyRevenue || 0);
      return acc;
    },
    { fees: 0, revenue: 0 }
  );

  return totals;
}

async function tryChainTvl(projectName) {
  try {
    const chains = await fetchJson(LLAMA_CHAINS_URL);
    const target = normalize(projectName);
    const chain = chains.find(
      (c) => normalize(c.name) === target || normalize(c.gecko_id) === target
    );
    if (!chain) return null;

    const chainName = chain.name;
    const currentTvl = Number(chain.tvl) || 0;

    let tvl7dAgo = null;
    let tvl30dAgo = null;
    try {
      const history = await fetchJson(
        `${LLAMA_CHAIN_TVL_URL}/${encodeURIComponent(chainName)}`
      );
      if (Array.isArray(history) && history.length > 0) {
        const now = Date.now();
        const find = (daysBack) => {
          const targetTs = now - daysBack * 86400000;
          let closest = null;
          let dist = Infinity;
          for (const pt of history) {
            const d = Math.abs((pt.date || 0) * 1000 - targetTs);
            if (d < dist && Number.isFinite(pt.tvl)) {
              dist = d;
              closest = pt.tvl;
            }
          }
          return closest;
        };
        tvl7dAgo = find(7);
        tvl30dAgo = find(30);
      }
    } catch {}

    return {
      slug: chainName.toLowerCase(),
      tvl: currentTvl,
      tvl_change_7d: computePctChange(currentTvl, tvl7dAgo),
      tvl_change_30d: computePctChange(currentTvl, tvl30dAgo),
      chains: [chainName],
      category: 'Layer 1',
      isChain: true,
    };
  } catch {
    return null;
  }
}

export async function collectOnchain(projectName) {
  const fallback = createEmptyOnchainResult(projectName);

  try {
    // Run chain and protocol discovery in parallel to reduce cold-start latency.
    const [chainResult, protocols] = await Promise.all([
      tryChainTvl(projectName),
      fetchJson(LLAMA_PROTOCOLS_URL),
    ]);

    const match = [...(protocols || [])]
      .map((protocol) => ({ protocol, score: similarityScore(projectName, protocol) }))
      .sort((a, b) => b.score - a.score)[0];

    const protocolTvl = match?.protocol?.tvl;
    const useChain = chainResult && (!match?.protocol?.slug || match.score < 40 || protocolTvl == null);

    if (useChain) {
      // L1 chain path — use chain TVL + try to get fees from protocol slug
      let fees7d = null;
      let revenue7d = null;
      try {
        const feesData = await fetchJson(`${LLAMA_FEES_URL}/${encodeURIComponent(chainResult.slug)}`);
        const feeTotals = sumLastNDays(feesData?.totalDataChart || feesData?.data || [], 7);
        fees7d = feeTotals?.fees ?? (feesData?.total24h ? Number(feesData.total24h) * 7 : null);
        revenue7d = feeTotals?.revenue ?? null;
      } catch {}

      const chainRevenueToFees = (revenue7d != null && fees7d != null && fees7d > 0)
        ? revenue7d / fees7d
        : null;

      return {
        ...fallback,
        slug: chainResult.slug,
        tvl: chainResult.tvl,
        tvl_change_7d: chainResult.tvl_change_7d,
        tvl_change_30d: chainResult.tvl_change_30d,
        chains: chainResult.chains,
        category: chainResult.category,
        fees_7d: fees7d,
        revenue_7d: revenue7d,
        revenue_to_fees_ratio: chainRevenueToFees,
        treasury_balance: null,
        error: null,
      };
    }

    // Protocol path (DeFi protocols like Aave, Uniswap, etc.)
    if (!match?.protocol?.slug || match.score < 20) {
      return { ...fallback, error: 'DeFiLlama protocol not found' };
    }

    const slug = match.protocol.slug;
    const [protocolData, feesData] = await Promise.allSettled([
      fetchJson(`${LLAMA_PROTOCOL_URL}/${encodeURIComponent(slug)}`),
      fetchJson(`${LLAMA_FEES_URL}/${encodeURIComponent(slug)}`).catch(() => null),
    ]);

    const protocol = protocolData.status === 'fulfilled' ? protocolData.value : null;
    const fees = feesData.status === 'fulfilled' ? feesData.value : null;

    // currentChainTvls can include "borrowed", "staking" etc — filter to real chain names only
    let currentTvl = null;
    if (protocol?.currentChainTvls) {
      const validChains = new Set((protocol.chains || []).map((c) => c));
      currentTvl = Object.entries(protocol.currentChainTvls)
        .filter(([key]) => validChains.has(key))
        .reduce((sum, [, value]) => sum + Number(value || 0), 0);
      if (currentTvl === 0) currentTvl = null;
    }
    if (!currentTvl) {
      currentTvl = Number(protocol?.tvl ?? match.protocol?.tvl ?? 0) || null;
    }

    const tvlHistory = Array.isArray(protocol?.tvl) ? protocol.tvl : [];
    const tvl7dAgo = getClosestHistoricalTvl(tvlHistory, 7);
    const tvl30dAgo = getClosestHistoricalTvl(tvlHistory, 30);
    const feeTotals = sumLastNDays(fees?.totalDataChart || fees?.data || [], 7);

    const fees7d = feeTotals?.fees ?? (fees?.total24h ? Number(fees.total24h) * 7 : null);
    const revenue7d = feeTotals?.revenue ?? null;
    const revenueToFeesRatio = (revenue7d != null && fees7d != null && fees7d > 0)
      ? revenue7d / fees7d
      : null;

    // Round 4: treasury from DeFiLlama protocol data
    let treasuryBalance = null;
    if (protocol) {
      const treasury = protocol?.treasury;
      const ownTokens = protocol?.ownTokens;
      if (typeof treasury === 'number') {
        treasuryBalance = treasury;
      } else if (typeof ownTokens === 'number') {
        treasuryBalance = ownTokens;
      } else if (treasury && typeof treasury === 'object') {
        // Sometimes it's an object with token holdings — sum numeric values
        const sum = Object.values(treasury).reduce((acc, val) => acc + (Number(val) || 0), 0);
        if (sum > 0) treasuryBalance = sum;
      }
    }

    // Round 11: per-chain TVL breakdown from currentChainTvls
    const chainTvl = {};
    if (protocol?.currentChainTvls) {
      const validChains = new Set((protocol.chains || []).map((c) => c));
      for (const [chain, val] of Object.entries(protocol.currentChainTvls)) {
        if (validChains.has(chain) && Number.isFinite(Number(val))) {
          chainTvl[chain] = Number(val);
        }
      }
    }

    // Round 11: active users from DeFiLlama if available
    const activeUsers24h = Number.isFinite(Number(protocol?.activeUsers))
      ? Number(protocol.activeUsers)
      : null;

    // Round 21: revenue efficiency = weekly fees per $1M TVL
    const revenueEfficiency = (fees7d != null && currentTvl != null && currentTvl > 0)
      ? (fees7d / (currentTvl / 1_000_000))
      : null;

    // Round 6: TVL stickiness — TVL stability signal: if 30d change > -10% and 7d > -5%, capital is sticky
    const tvl7dChange = computePctChange(currentTvl, tvl7dAgo);
    const tvl30dChange = computePctChange(currentTvl, tvl30dAgo);
    let tvlStickiness = null;
    if (tvl7dChange !== null && tvl30dChange !== null) {
      if (tvl7dChange >= -5 && tvl30dChange >= -10) tvlStickiness = 'sticky';
      else if (tvl7dChange < -20 || tvl30dChange < -30) tvlStickiness = 'fleeing';
      else tvlStickiness = 'moderate';
    }

    // Round 43: Detect suspiciously stable TVL — TVL that hasn't changed at all in 7d/30d may be stale data
    let tvlDataQuality = null;
    if (tvl7dChange !== null && tvl30dChange !== null) {
      const bothExact0 = tvl7dChange === 0 && tvl30dChange === 0;
      const bothNearZero = Math.abs(tvl7dChange) < 0.01 && Math.abs(tvl30dChange) < 0.01;
      if (bothExact0 || bothNearZero) {
        tvlDataQuality = 'suspect_static'; // TVL suspiciously unchanged
      } else if (Math.abs(tvl7dChange) > 0.1 || Math.abs(tvl30dChange) > 0.1) {
        tvlDataQuality = 'active'; // Shows real movement
      }
    }

    return {
      ...fallback,
      slug,
      tvl: currentTvl,
      tvl_change_7d: tvl7dChange,
      tvl_change_30d: tvl30dChange,
      chains: protocol?.chains || match.protocol?.chains || [],
      category: protocol?.category || match.protocol?.category || null,
      fees_7d: fees7d,
      revenue_7d: revenue7d,
      revenue_to_fees_ratio: revenueToFeesRatio,
      treasury_balance: treasuryBalance,
      chain_tvl: chainTvl,
      active_users_24h: activeUsers24h,
      revenue_efficiency: revenueEfficiency != null ? Math.round(revenueEfficiency * 100) / 100 : null,
      tvl_stickiness: tvlStickiness,
      tvl_data_quality: tvlDataQuality,
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'DeFiLlama timeout' : error.message,
    };
  }
}
