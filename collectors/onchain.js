import { fetchJson } from './fetch.js';

const LLAMA_PROTOCOLS_URL = 'https://api.llama.fi/protocols';
const LLAMA_PROTOCOL_URL = 'https://api.llama.fi/protocol';
const LLAMA_FEES_URL = 'https://api.llama.fi/summary/fees';
const LLAMA_CHAINS_URL = 'https://api.llama.fi/v2/chains';
const LLAMA_CHAIN_TVL_URL = 'https://api.llama.fi/v2/historicalChainTvl';
const ONCHAIN_TIMEOUT_MS = 20000;

function sanitizeNonNegative(value, decimals = null) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return typeof decimals === 'number' ? parseFloat(num.toFixed(decimals)) : num;
}

function normalizeUsdAmount(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,\s]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return sanitizeNonNegative(value);
}

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
    active_users_7d: null,
    active_users_30d: null,
    fee_data_days_covered: null,
    revenue_data_days_covered: null,
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
  if (target.includes(name) && name && name.length >= 4) score += 50;
  if (slug.includes(target)) score += 45;
  if (symbol && symbol.length >= 3 && target.includes(symbol)) score += 35;
  if (protocol?.category) score += 3;
  if (protocol?.chains?.length) score += 2;
  return score;
}

function computePctChange(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  const result = ((c - p) / Math.abs(p)) * 100;
  // Round 183 (AutoResearch): guard against NaN/Infinity from extreme values
  // Round 531 (AutoResearch): also clamp extreme % changes (>10000%) as data anomalies
  if (!Number.isFinite(result)) return null;
  if (Math.abs(result) > 10000) return null; // likely stale/bad historical data point
  return parseFloat(result.toFixed(2));
}

function getClosestHistoricalTvl(tvlHistory, daysBack) {
  if (!Array.isArray(tvlHistory) || tvlHistory.length === 0) return null;
  const targetTs = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  let closest = null;
  let smallestDistance = Number.POSITIVE_INFINITY;

  for (const point of tvlHistory) {
    // Round 555 (AutoResearch): handle both DeFiLlama TVL history shapes:
    // shape A: { date: unixSec, totalLiquidityUSD: number } (protocol endpoint)
    // shape B: { date: unixSec, tvl: number } (chain TVL endpoint)
    // shape C: [unixMs, number] (array tuple format — rare but seen in some endpoints)
    let ts, tvlValue;
    if (Array.isArray(point)) {
      [ts, tvlValue] = [Number(point[0] || 0) * 1000, Number(point[1] || 0)];
      if (ts < 1e10) ts *= 1000; // handle both sec and ms timestamps
    } else {
      ts = (point?.date || 0) * 1000;
      tvlValue = point?.totalLiquidityUSD ?? point?.tvl ?? null;
    }
    const numVal = Number(tvlValue);
    if (!Number.isFinite(numVal) || numVal < 0) continue;
    const distance = Math.abs(ts - targetTs);
    if (distance < smallestDistance) {
      closest = numVal;
      smallestDistance = distance;
    }
  }

  return closest;
}

// Round 153 (AutoResearch): support optional startOffset to sum a window ending N days ago
// e.g. sumLastNDays(data, 14, 7) → days 8–14 ago (prior week)
function sumLastNDays(values, days, startOffset = 0) {
  if (!Array.isArray(values) || values.length === 0) return null;
  // Round 557 (AutoResearch): DeFiLlama fee arrays have varied field names and shapes
  // Handle both { timestamp, dailyFees, dailyRevenue } and { date, fees, revenue } shapes
  // Also guard NaN/Infinity and negative values (negative fees = refund events, treat as 0)
  const sorted = [...values]
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const dailyFees = (() => {
        const v = Number(item?.dailyFees ?? item?.fees ?? item?.total ?? 0);
        return Number.isFinite(v) && v >= 0 ? v : 0;
      })();
      const dailyRevenue = (() => {
        const v = Number(item?.dailyRevenue ?? item?.revenue ?? 0);
        return Number.isFinite(v) && v >= 0 ? v : 0;
      })();
      const ts = item?.timestamp ?? item?.date ?? 0;
      return { timestamp: ts, dailyFees, dailyRevenue };
    })
    .filter(item => item !== null && (item.dailyFees > 0 || item.dailyRevenue > 0))
    .sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0));

  if (!sorted.length) return null;

  // slice(-days) up to slice(-startOffset) (or end if startOffset=0)
  const end = startOffset > 0 ? sorted.length - startOffset : sorted.length;
  const start = Math.max(0, end - days);
  const tail = sorted.slice(start, end);
  if (!tail.length) return null;

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

    if (!Array.isArray(protocols)) {
      return {
        ...fallback,
        error: 'DeFiLlama protocols list unavailable or malformed',
      };
    }

    const match = [...protocols]
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
        // Round 188 (AutoResearch): DeFiLlama fees API can return various shapes;
        // try all known array fields, fall back to total24h scalar, or leave null.
        const feeArray = feesData?.totalDataChart || feesData?.totalDataChartBreakdown || feesData?.data || [];
        const feeTotals = sumLastNDays(Array.isArray(feeArray) ? feeArray : [], 7);
        fees7d = feeTotals?.fees != null
          ? feeTotals.fees
          : (feesData?.total7d ? Number(feesData.total7d) : feesData?.total24h ? Number(feesData.total24h) * 7 : null);
        revenue7d = feeTotals?.revenue != null
          ? feeTotals.revenue
          : (feesData?.totalRevenue7d ? Number(feesData.totalRevenue7d) : null);
        // Sanitize
        if (!Number.isFinite(fees7d)) fees7d = null;
        if (!Number.isFinite(revenue7d)) revenue7d = null;
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
    if (!match?.protocol?.slug || match.score < 45) {
      // Round 194 (AutoResearch): include best-candidate info for debug
      const bestName = match?.protocol?.name || 'none';
      const bestSlug = match?.protocol?.slug || 'none';
      const bestSymbol = match?.protocol?.symbol || 'n/a';
      const bestScore = match?.score ?? 0;
      return { ...fallback, error: `DeFiLlama protocol not found for "${projectName}" (best match: "${bestName}" slug=${bestSlug} symbol=${bestSymbol} score=${bestScore})` };
    }

    const slug = match.protocol.slug;
    const [protocolData, feesData] = await Promise.allSettled([
      fetchJson(`${LLAMA_PROTOCOL_URL}/${encodeURIComponent(slug)}`),
      fetchJson(`${LLAMA_FEES_URL}/${encodeURIComponent(slug)}`).catch(() => null),
    ]);

    const protocol = protocolData.status === 'fulfilled' ? protocolData.value : null;
    const fees = feesData.status === 'fulfilled' ? feesData.value : null;

    if (!protocol && !fees) {
      return {
        ...fallback,
        slug,
        error: `DeFiLlama protocol and fees payloads unavailable for slug "${slug}"`,
      };
    }

    // currentChainTvls can include "borrowed", "staking" etc — filter to real chain names only
    // Round 552 (AutoResearch): distinguish TVL=0 (legitimate zero) from TVL=null (data missing)
    // A protocol with $0 TVL is a real signal (unused/deprecated) — don't silently null it
    let currentTvl = null;
    if (protocol?.currentChainTvls) {
      const validChains = new Set((protocol.chains || []).map((c) => c));
      const chainSum = Object.entries(protocol.currentChainTvls)
        .filter(([key]) => validChains.has(key))
        .reduce((sum, [, value]) => {
          const v = Number(value || 0);
          return sum + (Number.isFinite(v) ? v : 0);
        }, 0);
      // Only use 0 if we had actual chain data to aggregate (not just an empty filter result)
      currentTvl = validChains.size > 0 ? chainSum : null;
      if (currentTvl === 0 && validChains.size === 0) currentTvl = null;
    }
    if (currentTvl == null) {
      const rawTvl = protocol?.tvl ?? match.protocol?.tvl;
      const numTvl = Number(rawTvl ?? 0);
      currentTvl = Number.isFinite(numTvl) && numTvl >= 0 ? numTvl : null;
    }

    const tvlHistory = Array.isArray(protocol?.tvl) ? protocol.tvl : [];
    const tvl7dAgo = getClosestHistoricalTvl(tvlHistory, 7);
    const tvl30dAgo = getClosestHistoricalTvl(tvlHistory, 30);
    const feeDataArr = fees?.totalDataChart || fees?.totalDataChartBreakdown || fees?.data || [];
    const feeDataCoverage = Array.isArray(feeDataArr)
      ? feeDataArr
          .map((item) => ({
            fees: sanitizeNonNegative(item?.dailyFees ?? item?.fees ?? item?.total),
            revenue: sanitizeNonNegative(item?.dailyRevenue ?? item?.revenue),
          }))
          .reduce((acc, item) => {
            if (item.fees != null) acc.feeDays += 1;
            if (item.revenue != null) acc.revenueDays += 1;
            return acc;
          }, { feeDays: 0, revenueDays: 0 })
      : { feeDays: 0, revenueDays: 0 };
    const feeTotals = sumLastNDays(feeDataArr, 7);
    // Round 153 (AutoResearch): also compute fees for prior 7d window (days 8-14) to detect trend
    const feeTotalsPrev = sumLastNDays(feeDataArr, 14, 7);
    // Round 229 (AutoResearch): fees_30d_actual from actual 30-day sum (more accurate than 7d × 4.3)
    const feeTotals30d = sumLastNDays(feeDataArr, 30);

    const fees7d = sanitizeNonNegative(feeTotals?.fees)
      ?? (sanitizeNonNegative(fees?.total7d) ?? (sanitizeNonNegative(fees?.total24h) != null ? sanitizeNonNegative(fees?.total24h) * 7 : null));
    const revenue7d = sanitizeNonNegative(feeTotals?.revenue)
      ?? sanitizeNonNegative(fees?.totalRevenue7d)
      ?? sanitizeNonNegative(fees?.protocolRevenue7d);
    const revenue7dPrev = sanitizeNonNegative(feeTotalsPrev?.revenue);
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
        const sanitized = sanitizeNonNegative(val);
        if (validChains.has(chain) && sanitized != null) {
          chainTvl[chain] = sanitized;
        }
      }
    }

    const protocolChains = [...new Set([...(protocol?.chains || []), ...(match.protocol?.chains || [])].filter(Boolean))];

    // Round 11: active users from DeFiLlama if available
    const activeUsers24h = sanitizeNonNegative(protocol?.activeUsers ?? protocol?.activeUsers24h);
    const activeUsers7d = sanitizeNonNegative(protocol?.activeUsers7d);
    const activeUsers30d = sanitizeNonNegative(protocol?.activeUsers30d);

    // Round 21: revenue efficiency = weekly fees per $1M TVL
    const revenueEfficiency = (fees7d != null && currentTvl != null && currentTvl > 0)
      ? (fees7d / (currentTvl / 1_000_000))
      : null;

    // Round 199 (AutoResearch): fees_per_tvl_7d — another form of capital efficiency
    // Ratio of weekly fees to total TVL; high ratio = TVL working hard
    const feesPerTvl7d = (fees7d != null && currentTvl != null && currentTvl > 0)
      ? parseFloat((fees7d / currentTvl).toFixed(6))
      : null;

    // Round 6: TVL stickiness — TVL stability signal: if 30d change > -10% and 7d > -5%, capital is sticky
    const tvl7dChange = computePctChange(currentTvl, tvl7dAgo);
    const tvl30dChange = computePctChange(currentTvl, tvl30dAgo);
    let tvlStickiness = null;
    if (tvl7dChange !== null && tvl30dChange !== null) {
      // Round 238 (AutoResearch): improved stickiness — also reward TVL growth (not just stability)
      const isGrowing = tvl7dChange > 5 && tvl30dChange > 10;
      if (isGrowing) tvlStickiness = 'growing';  // new: actively attracting capital
      else if (tvl7dChange >= -5 && tvl30dChange >= -10) tvlStickiness = 'sticky';
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

    // Round 542 (AutoResearch): MCap/TVL ratio from DeFiLlama protocol.mcap field
    // Key valuation metric: low MCap/TVL = potentially undervalued, high = overvalued relative to TVL
    const protocolMcap = protocol?.mcap ?? null;
    const mcapToTvlRatio = (() => {
      if (protocolMcap == null || currentTvl == null || currentTvl <= 0) return null;
      const ratio = protocolMcap / currentTvl;
      return Number.isFinite(ratio) ? parseFloat(ratio.toFixed(3)) : null;
    })();

    // Round 5 (AutoResearch batch): Derive fees_30d and revenue_30d from 7d data if missing
    // Round 229: prefer actual 30d sum over derived estimate
    const fees30dActual = feeTotals30d?.fees != null && feeTotals30d.fees > 0 ? feeTotals30d.fees : null;
    const revenue30dActual = feeTotals30d?.revenue != null ? feeTotals30d.revenue : null;
    const fees30dDerived = fees30dActual ?? (fees7d != null ? fees7d * (30 / 7) : null);
    const revenue30dDerived = revenue30dActual ?? (revenue7d != null ? revenue7d * (30 / 7) : null);

    // Round 5 (AutoResearch batch): Protocol maturity tier based on TVL + fees
    let protocolMaturity = null;
    if (currentTvl != null && fees7d != null) {
      const annualFees = fees7d * 52;
      if (currentTvl > 1_000_000_000 && annualFees > 10_000_000) protocolMaturity = 'tier1';
      else if (currentTvl > 100_000_000 || annualFees > 1_000_000) protocolMaturity = 'tier2';
      else if (currentTvl > 10_000_000 || annualFees > 100_000) protocolMaturity = 'tier3';
      else protocolMaturity = 'emerging';
    }

    return {
      ...fallback,
      slug,
      tvl: currentTvl,
      tvl_change_7d: tvl7dChange,
      tvl_change_30d: tvl30dChange,
      chains: protocolChains,
      category: protocol?.category || match.protocol?.category || null,
      fees_7d: fees7d,
      // Round 238 (AutoResearch): fees_7d_prev for revenue trend detection in circuit breakers
      fees_7d_prev: feeTotalsPrev?.fees ?? null,
      fees_30d: fees30dDerived,
      fees_30d_actual: fees30dActual,
      revenue_7d: revenue7d,
      revenue_30d: revenue30dDerived,
      revenue_to_fees_ratio: revenueToFeesRatio,
      revenue_7d_prev: revenue7dPrev,
      treasury_balance: treasuryBalance,
      chain_tvl: chainTvl,
      active_users_24h: activeUsers24h,
      active_users_7d: activeUsers7d,
      active_users_30d: activeUsers30d,
      fee_data_days_covered: feeDataCoverage.feeDays || null,
      revenue_data_days_covered: feeDataCoverage.revenueDays || null,
      revenue_efficiency: revenueEfficiency != null ? Math.round(revenueEfficiency * 100) / 100 : null,
      fees_per_tvl_7d: feesPerTvl7d,
      // Round 571 (AutoResearch): annualized fee rate as % of TVL
      fee_to_tvl_annualized: (() => {
        if (fees7d == null || currentTvl == null || currentTvl <= 0) return null;
        const annualized = (fees7d * (365 / 7) / currentTvl) * 100;
        return Number.isFinite(annualized) ? parseFloat(annualized.toFixed(3)) : null;
      })(),
      // Round 572 (AutoResearch): annualized revenue rate as % of TVL
      revenue_to_tvl_annualized: (() => {
        if (revenue7d == null || currentTvl == null || currentTvl <= 0) return null;
        const annualized = (revenue7d * (365 / 7) / currentTvl) * 100;
        return Number.isFinite(annualized) ? parseFloat(annualized.toFixed(3)) : null;
      })(),
      // Round 573 (AutoResearch): protocol fee capture — how much of gross fees accrue to protocol revenue
      fee_capture_pct: (() => {
        if (revenueToFeesRatio == null) return null;
        const pct = revenueToFeesRatio * 100;
        return Number.isFinite(pct) ? parseFloat(pct.toFixed(1)) : null;
      })(),
      // Round 200 (AutoResearch): protocol age from DeFiLlama listedAt timestamp
      // Round 206 (AutoResearch): revenue trend — compare current 7d vs prior 7d revenue
      revenue_trend: (() => {
        if (revenue7d == null || revenue7dPrev == null) return null;
        if (revenue7dPrev === 0) return revenue7d > 0 ? 'improving' : null;
        const change = (revenue7d - revenue7dPrev) / Math.abs(revenue7dPrev);
        if (change > 0.15) return 'improving';
        if (change < -0.15) return 'declining';
        return 'flat';
      })(),
      protocol_age_days: (() => {
        const listedAt = protocol?.listedAt || match?.protocol?.listedAt;
        if (!listedAt) return null;
        const days = Math.floor((Date.now() - listedAt * 1000) / 86400000);
        return days >= 0 ? days : null;
      })(),
      tvl_stickiness: tvlStickiness,
      tvl_data_quality: tvlDataQuality,
      protocol_maturity: protocolMaturity,
      // Round 233 (AutoResearch nightly): protocol_efficiency_score (0-100)
      // Composite: fee generation rate, TVL stickiness, revenue capture quality, chain diversification
      protocol_efficiency_score: (() => {
        if (!currentTvl || currentTvl <= 0) return null;
        let score = 0;
        // Fee efficiency component (0-40): log scale on fees per TVL
        if (revenueEfficiency != null) {
          // $0/M = 0, $10/M = 8, $100/M = 24, $1000/M = 40
          const feeScore = Math.min(40, Math.max(0, Math.log10(Math.max(1, revenueEfficiency)) / 3 * 40));
          score += feeScore;
        }
        // TVL stability (0-30)
        if (tvlStickiness === 'sticky') score += 30;
        else if (tvlStickiness === 'moderate') score += 15;
        else if (tvlStickiness === 'fleeing') score += 0;
        // Revenue capture (0-20): what % of fees become protocol revenue
        if (revenueToFeesRatio != null) {
          score += Math.min(20, revenueToFeesRatio * 40); // 50% capture → 20 pts
        }
        // Chain diversification (0-10): more chains = more resilient
        const chainCount = (protocol?.chains || []).length;
        if (chainCount >= 5) score += 10;
        else if (chainCount >= 3) score += 6;
        else if (chainCount >= 2) score += 3;
        return Math.round(Math.min(100, score));
      })(),
      // Round 6 (AutoResearch nightly): governance signals — placeholder populated from DeFiLlama if available
      governance_proposals_30d: protocol?.governanceProposals ?? null,
      governance_participation_pct: protocol?.governanceParticipation ?? null,
      // Per-chain TVL dominance — largest single chain as % of total TVL (concentration risk)
      chain_tvl_dominance_pct: (() => {
        const vals = Object.values(chainTvl ?? {}).map(Number).filter(Number.isFinite);
        if (!vals.length || currentTvl <= 0) return null;
        const maxChainTvl = Math.max(...vals);
        return parseFloat(((maxChainTvl / currentTvl) * 100).toFixed(1));
      })(),
      // Round 234 (AutoResearch): fee_revenue_acceleration — is revenue growing faster than TVL?
      // fee_7d / tvl improvement: if revenue up >20% while TVL flat or down, protocol is monetizing better
      fee_revenue_acceleration: (() => {
        if (revenueEfficiency == null || fees7d == null || currentTvl == null || currentTvl <= 0) return null;
        // Proxy: compare revenue efficiency (fees per $1M TVL) vs revenue trend
        const revTrend = (() => {
          if (revenue7d == null || revenue7dPrev == null) return null;
          if (revenue7dPrev === 0) return revenue7d > 0 ? 1 : 0;
          return (revenue7d - revenue7dPrev) / Math.abs(revenue7dPrev);
        })();
        const tvlTrend = (() => {
          if (tvl7d == null) return 0;
          return tvl7d / 100; // normalize pct to ratio
        })();
        if (revTrend == null) return null;
        // Revenue growing faster than TVL = increasing monetization efficiency
        if (revTrend > 0.15 && tvlTrend <= 0.1) return 'accelerating';
        if (revTrend > 0.05) return 'growing';
        if (revTrend < -0.15) return 'declining';
        return 'stable';
      })(),
      // Round 235 (AutoResearch): daily_fee_rate — annualized fee rate as % of TVL
      // A higher rate = protocol extracts more value from locked capital
      daily_fee_rate_annualized: (() => {
        if (fees7d == null || currentTvl == null || currentTvl <= 0) return null;
        const dailyFees = fees7d / 7;
        const annualized = (dailyFees * 365) / currentTvl * 100;
        return Number.isFinite(annualized) ? parseFloat(annualized.toFixed(4)) : null;
      })(),

      // Round 237 (AutoResearch nightly): revenue_per_active_user — product-market fit metric
      // High revenue per user = each user generates significant protocol revenue → strong monetization
      // Low revenue per user with high TVL = capital heavy but user-light (possibly institutional)
      revenue_per_active_user: (() => {
        if (revenue7d == null || activeUsers24h == null || activeUsers24h <= 0) return null;
        // Normalize weekly revenue to daily, divide by daily active users
        const dailyRevenue = revenue7d / 7;
        const revenuePerUser = dailyRevenue / activeUsers24h;
        return Number.isFinite(revenuePerUser) ? parseFloat(revenuePerUser.toFixed(4)) : null;
      })(),

      // Round 237b (AutoResearch nightly): active_addresses_7d (derived from 7x daily active users)
      // Used by scoring for TVL efficiency per active user calculation
      active_addresses_7d: (() => {
        // Estimate: weekly active ≈ daily * 7 * uniqueness_factor (0.6 is typical for DeFi)
        if (activeUsers24h == null) return null;
        return Math.round(activeUsers24h * 7 * 0.6);
      })(),
      // Round 564 (AutoResearch): funding/raises data from DeFiLlama if available
      // DeFiLlama includes raises field on some protocol records with funding round details
      total_raised_usd: (() => {
        const raises = protocol?.raises;
        if (!Array.isArray(raises) || raises.length === 0) return null;
        const total = raises.reduce((sum, r) => {
          const amt = normalizeUsdAmount(r?.amount ?? r?.raisedAmount ?? r?.amountUsd ?? 0);
          return sum + (amt != null ? amt : 0);
        }, 0);
        return total > 0 ? total : null;
      })(),
      raise_count: (() => {
        const raises = protocol?.raises;
        return Array.isArray(raises) ? raises.length : null;
      })(),
      last_raise_date: (() => {
        const raises = protocol?.raises;
        if (!Array.isArray(raises) || raises.length === 0) return null;
        const dates = raises.map(r => r?.date).filter(Boolean).sort().reverse();
        return dates[0] || null;
      })(),
      // Round 544 (AutoResearch): security signals from DeFiLlama protocol data
      // audit_links presence = at least one public audit; stablecoin flag from category
      has_audit: (() => {
        const links = protocol?.audit_links;
        if (!Array.isArray(links)) return null;
        return links.length > 0;
      })(),
      audit_count: (() => {
        const links = protocol?.audit_links;
        return Array.isArray(links) ? links.length : null;
      })(),
      // Token address from DeFiLlama (may differ from CoinGecko platforms field)
      llama_token_address: protocol?.address ?? null,
      // Whether the protocol uses a native token (has non-null address) vs governance-free
      has_native_token: protocol?.address != null && String(protocol.address).length > 5,
      // Round 542 (AutoResearch): MCap/TVL from DeFiLlama — key DeFi valuation signal
      // < 1 = TVL > market cap (potentially undervalued), > 3 = might be overvalued relative to usage
      protocol_mcap: protocolMcap,
      mcap_to_tvl_ratio: mcapToTvlRatio,
      mcap_to_tvl_tier: (() => {
        if (mcapToTvlRatio == null) return null;
        if (mcapToTvlRatio < 0.5) return 'very_undervalued';
        if (mcapToTvlRatio < 1) return 'undervalued';
        if (mcapToTvlRatio < 2) return 'fairly_valued';
        if (mcapToTvlRatio < 5) return 'overvalued';
        return 'highly_overvalued';
      })(),
      // Round 383 (AutoResearch): tvl_vs_ath_pct — how far current TVL is from protocol's all-time high TVL
      // This is a critical onchain context signal: near ATH TVL = peak adoption; far below = declining protocol
      // DeFiLlama historicalTvl endpoint provides full history
      tvl_vs_ath_pct: (() => {
        if (!Array.isArray(tvlHistory) || tvlHistory.length < 3 || currentTvl == null) return null;
        const athTvl = Math.max(...tvlHistory.map(p => Number(p.totalLiquidityUSD ?? p[1] ?? p.tvl ?? 0)).filter(Number.isFinite));
        if (athTvl <= 0 || !Number.isFinite(athTvl)) return null;
        const pct = ((currentTvl - athTvl) / athTvl) * 100;
        return Number.isFinite(pct) ? parseFloat(pct.toFixed(1)) : null;
      })(),
      // Round 383 (AutoResearch): weekly_tvl_velocity — absolute TVL gained/lost this week in USD
      // More actionable than pct changes for large protocols ($100M+ TVL with 5% = $5M new capital)
      weekly_tvl_velocity_usd: (() => {
        if (currentTvl == null || tvl7dChange == null) return null;
        const weekAgoTvl = currentTvl / (1 + tvl7dChange / 100);
        const velocity = currentTvl - weekAgoTvl;
        return Number.isFinite(velocity) ? Math.round(velocity) : null;
      })(),
      // Round 384 (AutoResearch batch): TVL 90-day range — high/low over the last 90 days
      // Gives medium-term TVL range context (quarterly support/resistance)
      tvl_range_90d: (() => {
        if (!Array.isArray(tvlHistory) || tvlHistory.length < 10 || currentTvl == null) return null;
        // Get last ~90 data points (DeFiLlama usually provides daily data)
        const recent = tvlHistory.slice(-90).map(p => Number(p.totalLiquidityUSD ?? p[1] ?? p.tvl ?? 0)).filter(v => Number.isFinite(v) && v > 0);
        if (recent.length < 10) return null;
        const high = Math.max(...recent);
        const low = Math.min(...recent);
        if (low <= 0 || high <= 0) return null;
        const rangeWidth = ((high - low) / low) * 100;
        const positionInRange = (currentTvl - low) / (high - low); // 0=at low, 1=at high
        return {
          high: Math.round(high),
          low: Math.round(low),
          range_width_pct: parseFloat(rangeWidth.toFixed(1)),
          position_in_range: parseFloat(Math.max(0, Math.min(1, positionInRange)).toFixed(3)),
        };
      })(),
      error: null,
    };
  } catch (error) {
    const isTimeout = error.name === 'AbortError' || error.message?.includes('timed out');
    const isCooldown = error.message?.includes('cooldown');
    const isNotFound = error.message?.includes('not found') || error.message?.includes('404');
    let errorMsg = error.message;
    if (isTimeout) errorMsg = `DeFiLlama timeout (> ${ONCHAIN_TIMEOUT_MS}ms)`;
    else if (isCooldown) errorMsg = `DeFiLlama API in cooldown — too many recent failures`;
    else if (isNotFound) errorMsg = `DeFiLlama: protocol not found for "${projectName}"`;
    return {
      ...fallback,
      error: errorMsg,
    };
  }
}
