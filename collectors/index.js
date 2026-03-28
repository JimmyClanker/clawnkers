import { collectMarket } from './market.js';
import { collectOnchain } from './onchain.js';
import { collectSocial } from './social.js';
import { collectGithub } from './github.js';
import { collectTokenomics } from './tokenomics.js';
import { collectDexScreener } from './dexscreener.js';
import { collectReddit } from './reddit.js';
import { collectHolders } from './holders.js';
import { collectEcosystem } from './ecosystem.js';
import { collectContractStatus } from './contract.js';
import { collectXSocial } from './x-social.js';
// Round 592 (AutoResearch batch): Fear & Greed Index — macro sentiment context (free, no API key)
import { collectFearGreed } from './fear-greed.js';

const GLOBAL_TIMEOUT_MS = 20000;

function withTimeout(promise, label, timeoutMs = GLOBAL_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function unwrapSettledResult(result, collectorName, fallbackValue = null) {
  if (result.status === 'fulfilled') {
    const data = result.value;
    const error = data?.error || null;
    return {
      data,
      error,
      ok: !error,
      source: error ? 'partial' : 'fresh',
    };
  }

  const errorMessage = result.reason?.message || 'Unknown collector error';
  console.error(`[collector:${collectorName}] FAILED: ${errorMessage}`);
  return {
    data: { ...fallbackValue, error: errorMessage },
    error: errorMessage,
    ok: false,
    source: 'error',
  };
}

/**
 * Build an aggregated error summary for inclusion in reports.
 * Makes it explicit which data sources succeeded or failed.
 */
function buildDataSourceSummary(collectors) {
  const succeeded = [];
  const failed = [];
  const stale = [];

  for (const [name, info] of Object.entries(collectors)) {
    if (!info.ok && info.error) {
      failed.push({ name, error: info.error });
    } else if (info.source === 'stale-cache') {
      stale.push({ name, age_ms: info.age_ms });
    } else {
      succeeded.push(name);
    }
  }

  return {
    succeeded,
    failed,
    stale,
    all_ok: failed.length === 0,
    coverage_pct: Math.round((succeeded.length + stale.length) / Object.keys(collectors).length * 100),
  };
}

export async function collectAll(projectName, exaService, collectorCache = null) {
  const startedAt = Date.now();

  // Wrap collector in cache if available
  async function maybeCached(name, fn) {
    if (!collectorCache) return { data: await fn(), fromCache: false, stale: false };
    return collectorCache.withCache(name, projectName, fn);
  }

  // Round 226 (AutoResearch): track per-collector start time for latency reporting
  const collectorStartTimes = {};
  function timedCollect(name, fn) {
    collectorStartTimes[name] = Date.now();
    return maybeCached(name, fn);
  }

  // --- Phase 1: Independent collectors (run in parallel) ---
  const marketPromise = timedCollect('market', () => collectMarket(projectName));
  const onchainPromise = timedCollect('onchain', () => collectOnchain(projectName));
  const socialPromise = timedCollect('social', () => collectSocial(projectName, exaService));
  const githubPromise = timedCollect('github', () => collectGithub(projectName));
  const dexPromise = timedCollect('dex', () => collectDexScreener(projectName));
  const redditPromise = timedCollect('reddit', () => collectReddit(projectName));
  const xSocialPromise = timedCollect('x_social', () => collectXSocial(projectName));
  // Round 592 (AutoResearch batch): Fear & Greed collected in parallel (free, fast, < 1s)
  const fearGreedPromise = timedCollect('fear_greed', () => collectFearGreed());

  const TOKENOMICS_OWN_TIMEOUT_MS = 12000;
  const tokenomicsPromise = marketPromise
    .catch(() => null)
    .then((marketCacheResult) => {
      const market = marketCacheResult?.data || null;
      collectorStartTimes['tokenomics'] = Date.now();
    return maybeCached('tokenomics', () =>
        withTimeout(
          collectTokenomics(projectName, market?.coin_id || null, market),
          'tokenomics',
          TOKENOMICS_OWN_TIMEOUT_MS,
        )
      );
    });

  // --- Phase 1 settle ---
  const phase1Results = await Promise.allSettled([
    withTimeout(marketPromise, 'market'),
    withTimeout(onchainPromise, 'onchain'),
    withTimeout(socialPromise, 'social'),
    withTimeout(githubPromise, 'github'),
    tokenomicsPromise,
    withTimeout(dexPromise, 'dex'),
    withTimeout(redditPromise, 'reddit', 15000),
    withTimeout(xSocialPromise, 'x_social', 30000),
    withTimeout(fearGreedPromise, 'fear_greed', 10000),
  ]);

  const [
    marketResult,
    onchainResult,
    socialResult,
    githubResult,
    tokenomicsResult,
    dexResult,
    redditResult,
    xSocialResult,
    fearGreedResult,
  ] = phase1Results;

  // Unwrap cache wrapper results
  function unwrapCache(result, name) {
    if (result.status === 'fulfilled') {
      const cacheResult = result.value;
      // If this came from withCache, it has { data, fromCache, stale }
      const data = cacheResult?.data !== undefined ? cacheResult.data : cacheResult;
      const fromCache = cacheResult?.fromCache ?? false;
      const stale = cacheResult?.stale ?? false;
      const error = data?.error || null;
      return {
        data,
        error,
        ok: !error,
        source: cacheResult?.lastResort ? 'last-resort-cache' : (fromCache ? (stale ? 'stale-cache' : 'cache') : 'fresh'),
        age_ms: cacheResult?.age_ms ?? null,
      };
    }
    const errorMessage = result.reason?.message || 'Unknown collector error';
    console.error(`[collector:${name}] FAILED: ${errorMessage}`);
    return {
      data: { error: errorMessage },
      error: errorMessage,
      ok: false,
      source: 'error',
      age_ms: null,
    };
  }

  const market = unwrapCache(marketResult, 'market');
  const onchain = unwrapCache(onchainResult, 'onchain');
  const social = unwrapCache(socialResult, 'social');
  const github = unwrapCache(githubResult, 'github');
  const tokenomics = unwrapCache(tokenomicsResult, 'tokenomics');
  const dex = unwrapCache(dexResult, 'dex');
  const reddit = unwrapCache(redditResult, 'reddit');
  const xSocial = unwrapCache(xSocialResult, 'x_social');
  // Round 592 (AutoResearch batch): Fear & Greed unwrap
  const fearGreed = unwrapCache(fearGreedResult, 'fear_greed');

  // --- Phase 2: Dependent collectors (need market/onchain/dex data) ---
  // Extract contract address from market data if available
  const marketData = market.data || {};
  const onchainData = onchain.data || {};
  const dexData = dex.data || {};

  // CoinGecko platforms data for contract verification
  const platforms = marketData?.platforms || marketData?.contract_addresses || null;
  // Contract address — from market platforms or existing field
  const contractAddress = marketData?.contract_address || null;

  const phase2Results = await Promise.allSettled([
    withTimeout(
      timedCollect('holders', () => collectHolders(projectName, contractAddress)),
      'holders',
      15000,
    ),
    withTimeout(
      timedCollect('ecosystem', () => collectEcosystem(projectName, onchainData, dexData)),
      'ecosystem',
      10000,
    ),
    withTimeout(
      timedCollect('contract', () => collectContractStatus(projectName, platforms, contractAddress)),
      'contract',
      12000,
    ),
  ]);

  const [holdersResult, ecosystemResult, contractResult] = phase2Results;

  const holders = unwrapCache(holdersResult, 'holders');
  const ecosystem = unwrapCache(ecosystemResult, 'ecosystem');
  const contract = unwrapCache(contractResult, 'contract');

  // Round 189 (AutoResearch): record per-collector status with age_ms for cache diagnostics
  // Round 226 (AutoResearch): add latency_ms for each collector
  const now226 = Date.now();
  const collectorsInfo = {
    market:     { ok: market.ok,     error: market.error,     source: market.source,     age_ms: market.age_ms,     latency_ms: collectorStartTimes.market ? now226 - collectorStartTimes.market : null },
    onchain:    { ok: onchain.ok,    error: onchain.error,    source: onchain.source,    age_ms: onchain.age_ms,    latency_ms: collectorStartTimes.onchain ? now226 - collectorStartTimes.onchain : null },
    social:     { ok: social.ok,     error: social.error,     source: social.source,     age_ms: social.age_ms,     latency_ms: collectorStartTimes.social ? now226 - collectorStartTimes.social : null },
    github:     { ok: github.ok,     error: github.error,     source: github.source,     age_ms: github.age_ms,     latency_ms: collectorStartTimes.github ? now226 - collectorStartTimes.github : null },
    tokenomics: { ok: tokenomics.ok, error: tokenomics.error, source: tokenomics.source, age_ms: tokenomics.age_ms, latency_ms: collectorStartTimes.tokenomics ? now226 - collectorStartTimes.tokenomics : null },
    dex:        { ok: dex.ok,        error: dex.error,        source: dex.source,        age_ms: dex.age_ms,        latency_ms: collectorStartTimes.dex ? now226 - collectorStartTimes.dex : null },
    reddit:     { ok: reddit.ok,     error: reddit.error,     source: reddit.source,     age_ms: reddit.age_ms,     latency_ms: collectorStartTimes.reddit ? now226 - collectorStartTimes.reddit : null },
    holders:    { ok: holders.ok,    error: holders.error,    source: holders.source,    age_ms: holders.age_ms,    latency_ms: collectorStartTimes.holders ? now226 - collectorStartTimes.holders : null },
    ecosystem:  { ok: ecosystem.ok,  error: ecosystem.error,  source: ecosystem.source,  age_ms: ecosystem.age_ms,  latency_ms: collectorStartTimes.ecosystem ? now226 - collectorStartTimes.ecosystem : null },
    contract:   { ok: contract.ok,   error: contract.error,   source: contract.source,   age_ms: contract.age_ms,   latency_ms: collectorStartTimes.contract ? now226 - collectorStartTimes.contract : null },
    x_social:   { ok: xSocial.ok,    error: xSocial.error,    source: xSocial.source,    age_ms: xSocial.age_ms,    latency_ms: collectorStartTimes.x_social ? now226 - collectorStartTimes.x_social : null },
    fear_greed: { ok: fearGreed.ok,  error: fearGreed.error,  source: fearGreed.source,  age_ms: fearGreed.age_ms,  latency_ms: collectorStartTimes.fear_greed ? now226 - collectorStartTimes.fear_greed : null },
  };

  const dataSourceSummary = buildDataSourceSummary(collectorsInfo);

  // Round 548 (AutoResearch): pre-compute cross-collector derived signals for scoring convenience
  // These avoid scoring.js having to import from multiple collectors independently
  const crossCollectorSignals = {
    // MCap/TVL from either source (prefer onchain as it uses DeFiLlama which is more reliable)
    mcap_to_tvl_ratio: onchain.data?.mcap_to_tvl_ratio
      ?? (market.data?.market_cap != null && onchain.data?.tvl != null && onchain.data.tvl > 0
        ? parseFloat((market.data.market_cap / onchain.data.tvl).toFixed(3))
        : null),
    // Combined development activity (GitHub + CoinGecko fallback)
    dev_commits_90d: github.data?.commits_90d
      ?? github.data?.commits_90d_cg_fallback
      ?? null,
    // Primary contract address (from contract collector or market bridge)
    primary_contract_address: contract.data?.contract_address ?? null,
    // Security signal: has_audit from DeFiLlama (null if protocol not found)
    has_audit: onchain.data?.has_audit ?? null,
  };

  // Round 202 (AutoResearch): log collector failures for observability
  for (const [name, info] of Object.entries(collectorsInfo)) {
    if (!info.ok && info.error) {
      console.error(`[collectAll:${projectName}] collector "${name}" failed: ${info.error}`);
    }
  }

  // Round 238 (AutoResearch): propagate community_score from market into social result
  // scoring.js reads social.community_score but it only exists in market — bridge the gap
  if (social.data && market.data?.community_score != null && social.data.community_score == null) {
    social.data = { ...social.data, community_score: market.data.community_score };
  }

  // Round 565 (AutoResearch): enrich crossCollectorSignals with social follower data from x_social
  // x_social has mention_volume signal; market has twitter_followers — merge for richer social context
  // Also surface a combined "social_signal_strength" for scoring shortcuts
  const socialSignalStrength = (() => {
    const twitterFollowers = market.data?.twitter_followers ?? 0;
    const telegramUsers = market.data?.telegram_channel_user_count ?? 0;
    const xMentionVolume = xSocial.ok && xSocial.data?.mention_volume;
    const redditPostCount = reddit.data?.post_count ?? 0;
    let score = 0;
    if (twitterFollowers > 1_000_000) score += 3;
    else if (twitterFollowers > 100_000) score += 2;
    else if (twitterFollowers > 10_000) score += 1;
    if (telegramUsers > 100_000) score += 2;
    else if (telegramUsers > 10_000) score += 1;
    if (xMentionVolume === 'high') score += 2;
    else if (xMentionVolume === 'medium') score += 1;
    if (redditPostCount > 20) score += 1;
    return score >= 6 ? 'very_high' : score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
  })();
  crossCollectorSignals.social_signal_strength = socialSignalStrength;
  crossCollectorSignals.social_signal_components = {
    twitter_followers: market.data?.twitter_followers ?? null,
    telegram_users: market.data?.telegram_channel_user_count ?? null,
    x_mention_volume: xSocial.ok ? xSocial.data?.mention_volume ?? null : null,
    reddit_post_count: reddit.data?.post_count ?? null,
  };

  // Round 547 (AutoResearch): bridge contract_addresses from market to contract/holders collectors
  // When market has platforms data but contract.data is empty/errored, surface addresses
  if (contract.data && market.data?.contract_addresses) {
    if (!contract.data.contract_address) {
      const addrs = market.data.contract_addresses;
      const chain = addrs.ethereum ? 'ethereum'
        : addrs.base ? 'base'
        : Object.keys(addrs)[0] || null;
      const addr = chain ? addrs[chain] : null;
      if (addr) {
        contract.data = {
          ...contract.data,
          contract_address: addr,
          platform: chain,
          // Flag that this came from market fallback, not Etherscan verification
          is_verified: contract.data.is_verified ?? null,
          _address_source: 'coingecko_platforms',
        };
      }
    }
  }

  // Round 546 (AutoResearch): if GitHub collector failed/partial, bridge cg_commits_4w from market
  // CoinGecko developer_data gives us commit_count_4_weeks as a fallback development signal
  if (github.data && market.data?.cg_commits_4w != null) {
    if (github.data.commits_90d == null || !github.ok) {
      github.data = {
        ...github.data,
        commits_90d_cg_fallback: market.data.cg_commits_4w * 3, // extrapolate 4w → 90d
        cg_commits_4w: market.data.cg_commits_4w,
        cg_forks: market.data.cg_forks ?? github.data.cg_forks ?? null,
        cg_stars: market.data.cg_stars ?? github.data.cg_stars ?? null,
      };
    }
  }

  // Round 102 (AutoResearch): NaN sanitizer pass + impossible value guards
  // Replace any NaN with null, guard negative prices/market caps, extreme ratios
  function sanitizeCollectorData(data) {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map(sanitizeCollectorData);
    const sanitized = {};
    for (const [key, val] of Object.entries(data)) {
      if (typeof val === 'number') {
        // NaN → null
        if (!Number.isFinite(val)) {
          sanitized[key] = null;
          continue;
        }
        // Impossible value guards
        if (key.includes('price') && val < 0) sanitized[key] = null;
        else if (key.includes('market_cap') && val < 0) sanitized[key] = null;
        else if (key.includes('volume') && val < 0) sanitized[key] = null;
        else if (key.includes('ratio') && (val < 0 || val > 1e12)) sanitized[key] = null;
        else if (key.includes('tvl') && val < 0) sanitized[key] = null;
        else sanitized[key] = val;
      } else if (typeof val === 'object' && val !== null) {
        sanitized[key] = sanitizeCollectorData(val);
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }

  const cleanedData = {
    market: sanitizeCollectorData(market.data),
    onchain: sanitizeCollectorData(onchain.data),
    social: sanitizeCollectorData(social.data),
    github: sanitizeCollectorData(github.data),
    tokenomics: sanitizeCollectorData(tokenomics.data),
    dex: sanitizeCollectorData(dex.data),
    reddit: sanitizeCollectorData(reddit.data),
    holders: sanitizeCollectorData(holders.data),
    ecosystem: sanitizeCollectorData(ecosystem.data),
    contract: sanitizeCollectorData(contract.data),
    x_social: sanitizeCollectorData(xSocial.data),
    fear_greed: sanitizeCollectorData(fearGreed.data),
  };

  // Round 111 (AutoResearch): log warning if total collection time >15s (slow collectors or rate-limit stalls)
  const resultObject = {
    project_name: projectName,
    market: cleanedData.market,
    onchain: cleanedData.onchain,
    social: cleanedData.social,
    github: cleanedData.github,
    tokenomics: cleanedData.tokenomics,
    dex: cleanedData.dex,
    reddit: cleanedData.reddit,
    holders: cleanedData.holders,
    ecosystem: cleanedData.ecosystem,
    contract: cleanedData.contract,
    x_social: cleanedData.x_social,
    fear_greed: cleanedData.fear_greed,
    metadata: {
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      collectors: collectorsInfo,
      data_sources: dataSourceSummary,
      cross_collector: crossCollectorSignals,
    },
  };

  const totalDuration = Date.now() - startedAt;
  if (totalDuration > 15000) {
    const slowCollectors = Object.entries(collectorsInfo)
      .filter(([, info]) => info.latency_ms != null && info.latency_ms > 8000)
      .map(([name, info]) => `${name}(${Math.round(info.latency_ms)}ms)`)
      .join(', ');
    console.warn(`[collectAll:${projectName}] Slow total collection: ${totalDuration}ms${slowCollectors ? ` — slow: ${slowCollectors}` : ''}`);
  }

  return resultObject;
}

export {
  collectMarket,
  collectOnchain,
  collectSocial,
  collectGithub,
  collectTokenomics,
  collectDexScreener,
  collectReddit,
  collectHolders,
  collectEcosystem,
  collectContractStatus,
  collectXSocial,
  collectFearGreed,
};
