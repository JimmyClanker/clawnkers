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

  // --- Phase 1: Independent collectors (run in parallel) ---
  const marketPromise = maybeCached('market', () => collectMarket(projectName));
  const onchainPromise = maybeCached('onchain', () => collectOnchain(projectName));
  const socialPromise = maybeCached('social', () => collectSocial(projectName, exaService));
  const githubPromise = maybeCached('github', () => collectGithub(projectName));
  const dexPromise = maybeCached('dex', () => collectDexScreener(projectName));
  const redditPromise = maybeCached('reddit', () => collectReddit(projectName));

  const TOKENOMICS_OWN_TIMEOUT_MS = 12000;
  const tokenomicsPromise = marketPromise
    .catch(() => null)
    .then((marketCacheResult) => {
      const market = marketCacheResult?.data || null;
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
  ]);

  const [
    marketResult,
    onchainResult,
    socialResult,
    githubResult,
    tokenomicsResult,
    dexResult,
    redditResult,
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
        source: fromCache ? (stale ? 'stale-cache' : 'cache') : 'fresh',
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

  // --- Phase 2: Dependent collectors (need market/onchain/dex data) ---
  // Extract contract address from market data if available
  const marketData = market.data || {};
  const onchainData = onchain.data || {};
  const dexData = dex.data || {};

  // CoinGecko platforms data for contract verification
  const platforms = marketData?.platforms || null;
  // Contract address — from market platforms or existing field
  const contractAddress = marketData?.contract_address || null;

  const phase2Results = await Promise.allSettled([
    withTimeout(
      maybeCached('holders', () => collectHolders(projectName, contractAddress)),
      'holders',
      15000,
    ),
    withTimeout(
      maybeCached('ecosystem', () => collectEcosystem(projectName, onchainData, dexData)),
      'ecosystem',
      10000,
    ),
    withTimeout(
      maybeCached('contract', () => collectContractStatus(projectName, platforms, contractAddress)),
      'contract',
      12000,
    ),
  ]);

  const [holdersResult, ecosystemResult, contractResult] = phase2Results;

  const holders = unwrapCache(holdersResult, 'holders');
  const ecosystem = unwrapCache(ecosystemResult, 'ecosystem');
  const contract = unwrapCache(contractResult, 'contract');

  const collectorsInfo = {
    market: { ok: market.ok, error: market.error, source: market.source },
    onchain: { ok: onchain.ok, error: onchain.error, source: onchain.source },
    social: { ok: social.ok, error: social.error, source: social.source },
    github: { ok: github.ok, error: github.error, source: github.source },
    tokenomics: { ok: tokenomics.ok, error: tokenomics.error, source: tokenomics.source },
    dex: { ok: dex.ok, error: dex.error, source: dex.source },
    reddit: { ok: reddit.ok, error: reddit.error, source: reddit.source },
    holders: { ok: holders.ok, error: holders.error, source: holders.source },
    ecosystem: { ok: ecosystem.ok, error: ecosystem.error, source: ecosystem.source },
    contract: { ok: contract.ok, error: contract.error, source: contract.source },
  };

  const dataSourceSummary = buildDataSourceSummary(collectorsInfo);

  return {
    project_name: projectName,
    market: market.data,
    onchain: onchain.data,
    social: social.data,
    github: github.data,
    tokenomics: tokenomics.data,
    dex: dex.data,
    reddit: reddit.data,
    holders: holders.data,
    ecosystem: ecosystem.data,
    contract: contract.data,
    metadata: {
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      collectors: collectorsInfo,
      data_sources: dataSourceSummary,
    },
  };
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
};
