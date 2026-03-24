import { collectMarket } from './market.js';
import { collectOnchain } from './onchain.js';
import { collectSocial } from './social.js';
import { collectGithub } from './github.js';
import { collectTokenomics } from './tokenomics.js';

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

function unwrapSettledResult(result, fallbackValue) {
  if (result.status === 'fulfilled') {
    return { data: result.value, error: result.value?.error || null };
  }

  return {
    data: fallbackValue,
    error: result.reason?.message || 'Unknown collector error',
  };
}

export async function collectAll(projectName, exaService) {
  const startedAt = Date.now();

  const marketPromise = collectMarket(projectName);
  const onchainPromise = collectOnchain(projectName);
  const socialPromise = collectSocial(projectName, exaService);
  const githubPromise = collectGithub(projectName);

  const results = await Promise.allSettled([
    withTimeout(marketPromise, 'market'),
    withTimeout(onchainPromise, 'onchain'),
    withTimeout(socialPromise, 'social'),
    withTimeout(githubPromise, 'github'),
    withTimeout(
      (async () => {
        const market = await marketPromise.catch(() => null);
        return collectTokenomics(projectName, market?.coin_id || null, market);
      })(),
      'tokenomics'
    ),
  ]);

  const [marketResult, onchainResult, socialResult, githubResult, tokenomicsResult] = results;
  const market = unwrapSettledResult(marketResult, null);
  const onchain = unwrapSettledResult(onchainResult, null);
  const social = unwrapSettledResult(socialResult, null);
  const github = unwrapSettledResult(githubResult, null);
  const tokenomics = unwrapSettledResult(tokenomicsResult, null);

  return {
    project_name: projectName,
    market: market.data,
    onchain: onchain.data,
    social: social.data,
    github: github.data,
    tokenomics: tokenomics.data,
    metadata: {
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      collectors: {
        market: { ok: !market.error, error: market.error },
        onchain: { ok: !onchain.error, error: onchain.error },
        social: { ok: !social.error, error: social.error },
        github: { ok: !github.error, error: github.error },
        tokenomics: { ok: !tokenomics.error, error: tokenomics.error },
      },
    },
  };
}

export {
  collectMarket,
  collectOnchain,
  collectSocial,
  collectGithub,
  collectTokenomics,
};
