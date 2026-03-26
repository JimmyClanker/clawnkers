/**
 * Sector Benchmarks Service
 *
 * Fetches and caches sector-level averages from DeFiLlama.
 * Used by the scoring engine to contextualize a project's metrics
 * against its category peers.
 *
 * Refreshed every 6 hours via in-memory cache (no DB dependency).
 */

const LLAMA_PROTOCOLS_URL = 'https://api.llama.fi/protocols';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let benchmarkCache = null;
let benchmarkCacheAt = 0;

// Category normalization map
const CATEGORY_ALIASES = {
  'dex': 'DEX',
  'decentralized exchange': 'DEX',
  'amm': 'DEX',
  'spot dex': 'DEX',
  'lending': 'Lending',
  'money market': 'Lending',
  'liquid staking': 'Liquid Staking',
  'liquid staking token': 'Liquid Staking',
  'restaking': 'Liquid Staking',
  'bridge': 'Bridge',
  'cross-chain': 'Bridge',
  'interoperability': 'Bridge',
  'yield': 'Yield',
  'yield aggregator': 'Yield',
  'vault': 'Yield',
  'auto-compounder': 'Yield',
  'cex': 'CEX',
  'derivatives': 'Derivatives',
  'perp dex': 'Derivatives',
  'perpetuals': 'Derivatives',
  'options': 'Options',
  'structured products': 'Options',
  'nft': 'NFT',
  'nft marketplace': 'NFT',
  'nft lending': 'NFT',
  'stablecoin': 'CDP',
  'cdp': 'CDP',
  'algorithmic stablecoin': 'CDP',
  'insurance': 'Insurance',
  'launchpad': 'Launchpad',
  'ido': 'Launchpad',
  'privacy': 'Privacy',
  'mixer': 'Privacy',
  'gaming': 'Gaming',
  'gamefi': 'Gaming',
  'play to earn': 'Gaming',
  'layer 1': 'Layer 1',
  'l1': 'Layer 1',
  'blockchain': 'Layer 1',
  'layer 2': 'Layer 2',
  'l2': 'Layer 2',
  'rollup': 'Layer 2',
  'zk rollup': 'Layer 2',
  'optimistic rollup': 'Layer 2',
  'rwa': 'RWA',
  'real world assets': 'RWA',
  'tokenized assets': 'RWA',
  'ai': 'AI',
  'artificial intelligence': 'AI',
  'depin': 'DePIN',
  'decentralized physical infrastructure': 'DePIN',
  'oracle': 'Oracle',
  'data feed': 'Oracle',
  'prediction market': 'Prediction Market',
  'dao': 'DAO',
  'governance': 'DAO',
  'social': 'Social',
  'socialfi': 'Social',
  'meme': 'Meme',
  'meme coin': 'Meme',
};

function normalizeCategory(category) {
  if (!category) return null;
  const lower = category.toLowerCase().trim();
  return CATEGORY_ALIASES[lower] || category;
}

function computeCategoryBenchmarks(protocols) {
  const byCategory = new Map();

  for (const p of protocols) {
    const category = normalizeCategory(p?.category);
    if (!category) continue;
    if (!byCategory.has(category)) {
      byCategory.set(category, { tvls: [], mcaps: [], volumes: [], feesPerTvl: [] });
    }
    const bucket = byCategory.get(category);
    if (Number.isFinite(p.tvl) && p.tvl > 0) bucket.tvls.push(p.tvl);
    if (Number.isFinite(p.mcap) && p.mcap > 0) bucket.mcaps.push(p.mcap);
    if (Number.isFinite(p.volume24h) && p.volume24h > 0) bucket.volumes.push(p.volume24h);
    // Round 155 (AutoResearch): compute fees_7d / TVL efficiency ratio for sector benchmarking
    const fees7d = Number(p.fees7d ?? p.totalFees7d ?? 0);
    if (Number.isFinite(fees7d) && fees7d > 0 && Number.isFinite(p.tvl) && p.tvl > 1_000_000) {
      bucket.feesPerTvl.push(fees7d / (p.tvl / 1_000_000)); // $ fees per $1M TVL per 7d
    }
  }

  const benchmarks = {};
  for (const [category, { tvls, mcaps, volumes }] of byCategory.entries()) {
    const median = (arr) => {
      if (!arr.length) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    };
    const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const top25Avg = (arr) => {
      if (!arr.length) return null;
      const sorted = [...arr].sort((a, b) => b - a);
      const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
      return top.reduce((s, v) => s + v, 0) / top.length;
    };

    benchmarks[category] = {
      count: tvls.length,
      tvl_median: median(tvls),
      tvl_avg: avg(tvls),
      tvl_top25_avg: top25Avg(tvls),
      mcap_median: median(mcaps),
      mcap_avg: avg(mcaps),
      volume_median: median(volumes),
      fees_per_tvl_median: median(byCategory.get(category).feesPerTvl),
    };
  }

  return benchmarks;
}

async function fetchBenchmarks() {
  const now = Date.now();
  if (benchmarkCache && now - benchmarkCacheAt < CACHE_TTL_MS) {
    return benchmarkCache;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let protocols;
    try {
      const resp = await fetch(LLAMA_PROTOCOLS_URL, { signal: controller.signal });
      protocols = resp.ok ? await resp.json() : [];
    } finally {
      clearTimeout(timeout);
    }

    if (!Array.isArray(protocols) || !protocols.length) {
      return benchmarkCache || {}; // Return stale if available
    }

    benchmarkCache = computeCategoryBenchmarks(protocols);
    benchmarkCacheAt = now;
    return benchmarkCache;
  } catch {
    return benchmarkCache || {}; // Return stale on error, never throw
  }
}

/**
 * Get benchmarks for a specific category.
 * Returns null if category not found or benchmarks unavailable.
 */
export async function getBenchmarkForCategory(category) {
  const benchmarks = await fetchBenchmarks();
  const normalized = normalizeCategory(category);
  return (normalized && benchmarks[normalized]) ? {
    category: normalized,
    ...benchmarks[normalized],
  } : null;
}

/**
 * Compare a project's metrics against its sector benchmark.
 * Returns a comparison object with percentile estimates and context.
 */
export function compareToSector(projectMetrics, benchmark) {
  if (!benchmark || !projectMetrics) return null;

  const comparison = {
    category: benchmark.category,
    sample_size: benchmark.count,
  };

  // TVL comparison
  if (projectMetrics.tvl != null && benchmark.tvl_median != null) {
    const ratio = projectMetrics.tvl / benchmark.tvl_median;
    comparison.tvl_vs_median = {
      project: projectMetrics.tvl,
      sector_median: benchmark.tvl_median,
      ratio: Math.round(ratio * 100) / 100,
      context: ratio >= 2 ? 'top-tier' : ratio >= 0.5 ? 'mid-tier' : 'below-median',
    };
  }

  // Market cap comparison
  if (projectMetrics.market_cap != null && benchmark.mcap_median != null) {
    const ratio = projectMetrics.market_cap / benchmark.mcap_median;
    comparison.mcap_vs_median = {
      project: projectMetrics.market_cap,
      sector_median: benchmark.mcap_median,
      ratio: Math.round(ratio * 100) / 100,
      context: ratio >= 2 ? 'above-median' : ratio >= 0.5 ? 'at-median' : 'below-median',
    };
  }

  // P/TVL ratio (market cap / TVL) — lower can mean undervalued
  if (projectMetrics.tvl > 0 && projectMetrics.market_cap > 0) {
    const ptvl = projectMetrics.market_cap / projectMetrics.tvl;
    const sectorPtvl = (benchmark.mcap_median && benchmark.tvl_median && benchmark.tvl_median > 0)
      ? benchmark.mcap_median / benchmark.tvl_median
      : null;
    comparison.price_to_tvl = {
      ratio: Math.round(ptvl * 100) / 100,
      sector_median: sectorPtvl ? Math.round(sectorPtvl * 100) / 100 : null,
      context: sectorPtvl
        ? (ptvl < sectorPtvl * 0.6 ? 'potentially-undervalued' : ptvl > sectorPtvl * 1.5 ? 'premium-valued' : 'fairly-valued')
        : 'no-sector-data',
    };
  }

  // Round 21 + Round 50: Volume efficiency comparison (volume / TVL ratio vs sector)
  if (projectMetrics.tvl > 0 && projectMetrics.market_cap != null) {
    // Accept volume from direct field or from _volume_24h injected by routes/alpha.js
    const projectVolume = projectMetrics.volume_24h ?? projectMetrics._volume_24h ?? null;
    if (projectVolume != null && projectVolume > 0 && projectMetrics.tvl > 0) {
      const volTvlRatio = projectVolume / projectMetrics.tvl;
      const sectorVolTvlRatio = (benchmark.volume_median && benchmark.tvl_median && benchmark.tvl_median > 0)
        ? benchmark.volume_median / benchmark.tvl_median
        : null;
      comparison.volume_efficiency = {
        project_vol_tvl_ratio: Math.round(volTvlRatio * 1000) / 1000,
        sector_median_ratio: sectorVolTvlRatio ? Math.round(sectorVolTvlRatio * 1000) / 1000 : null,
        context: sectorVolTvlRatio
          ? (volTvlRatio > sectorVolTvlRatio * 1.5 ? 'high-velocity' : volTvlRatio < sectorVolTvlRatio * 0.5 ? 'low-velocity' : 'average-velocity')
          : 'no-sector-data',
      };
    }
  }

  // Round 66: Sector percentile rank estimate (0-100) based on TVL vs distribution
  // Uses linear interpolation between median and top25 for rough percentile
  if (projectMetrics.tvl != null && benchmark.tvl_median != null && benchmark.tvl_top25_avg != null) {
    const tvl = projectMetrics.tvl;
    let tvlPercentile;
    if (tvl >= benchmark.tvl_top25_avg) tvlPercentile = 90; // top 25% floor
    else if (tvl >= benchmark.tvl_median) {
      // Between median (50th) and top25 (75th)
      const frac = (tvl - benchmark.tvl_median) / (benchmark.tvl_top25_avg - benchmark.tvl_median);
      tvlPercentile = Math.round(50 + frac * 25);
    } else {
      // Below median
      const frac = Math.min(tvl / benchmark.tvl_median, 1);
      tvlPercentile = Math.round(frac * 50);
    }
    comparison.sector_tvl_percentile = Math.min(99, Math.max(1, tvlPercentile));
  }

  return comparison;
}
