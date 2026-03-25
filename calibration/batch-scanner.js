/**
 * batch-scanner.js — Periodic batch scan of token universe (NO LLM)
 *
 * Calls collectors + scoring algoritmico. Never calls LLM.
 * Rate limiting: 1.5s delay between tokens (CoinGecko free tier: 30 req/min).
 *
 * Usage: node calibration/batch-scanner.js --tier A --level 1 --limit 10
 * Exports: runBatchScan()
 */

import { getCalibrationDb } from './db.js';
import { storeScanSnapshot } from './snapshot-store.js';
import { calculateScores } from '../synthesis/scoring.js';

// Collectors
import { collectMarket } from '../collectors/market.js';
import { collectOnchain } from '../collectors/onchain.js';
import { collectDexScreener } from '../collectors/dexscreener.js';
import { collectGithub } from '../collectors/github.js';
import { collectSocial } from '../collectors/social.js';
import { collectReddit } from '../collectors/reddit.js';
import { collectHolders } from '../collectors/holders.js';
import { collectEcosystem } from '../collectors/ecosystem.js';
import { collectContractStatus } from '../collectors/contract.js';
import { collectTokenomics } from '../collectors/tokenomics.js';

const RATE_LIMIT_DELAY_MS = 1500;

/**
 * Sleep for ms milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safe collector call — never throws, returns error-annotated object on failure.
 */
async function safeCollect(name, fn) {
  try {
    const data = await fn();
    return data;
  } catch (err) {
    console.warn(`[batch-scanner] collector ${name} failed: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Fetch token data for a single token (level 0 = market+dex only, level 1 = all collectors).
 */
async function collectForToken(projectName, level = 1) {
  const market = await safeCollect('market', () => collectMarket(projectName));
  const dex = await safeCollect('dex', () => collectDexScreener(projectName));

  if (level === 0) {
    return {
      project_name: projectName,
      market,
      dex,
      metadata: { scan_level: 0, collected_at: new Date().toISOString() },
    };
  }

  // Level 1: all collectors
  const marketData = market || {};
  const [onchain, github, social, reddit] = await Promise.all([
    safeCollect('onchain', () => collectOnchain(projectName)),
    safeCollect('github', () => collectGithub(projectName)),
    safeCollect('social', () => collectSocial(projectName, null)),
    safeCollect('reddit', () => collectReddit(projectName)),
  ]);

  const contractAddress = marketData.contract_address || null;
  const platforms = marketData.platforms || null;

  const tokenomics = await safeCollect('tokenomics', () =>
    collectTokenomics(projectName, marketData.coin_id || null, marketData)
  );

  const [holders, ecosystem, contract] = await Promise.all([
    safeCollect('holders', () => collectHolders(projectName, contractAddress)),
    safeCollect('ecosystem', () => collectEcosystem(projectName, onchain || {}, dex || {})),
    safeCollect('contract', () => collectContractStatus(projectName, platforms, contractAddress)),
  ]);

  return {
    project_name: projectName,
    market,
    onchain,
    dex,
    github,
    social,
    reddit,
    holders,
    ecosystem,
    contract,
    tokenomics,
    metadata: { scan_level: 1, collected_at: new Date().toISOString() },
  };
}

/**
 * Run a periodic batch scan of tokens from the universe.
 *
 * @param {object} opts
 * @param {string} [opts.tier='A'] - 'A', 'B', or 'all'
 * @param {number} [opts.level=1] - 0 (market only) or 1 (full)
 * @param {number} [opts.limit=50] - max tokens to scan
 * @param {object} [opts.db] - optional DB instance (for testing)
 * @param {Function} [opts.collectFn] - optional collector override (for testing)
 * @param {Function} [opts.scoreFn] - optional scorer override (for testing)
 * @param {Function} [opts.snapshotFn] - optional snapshot store override (for testing)
 * @param {number} [opts.rateLimitMs=1500] - delay between tokens
 * @returns {Promise<object>} summary
 */
export async function runBatchScan({
  tier = 'A',
  level = 1,
  limit = 50,
  db: injectedDb,
  collectFn,
  scoreFn,
  snapshotFn,
  rateLimitMs = RATE_LIMIT_DELAY_MS,
} = {}) {
  const db = injectedDb || getCalibrationDb();

  // Build WHERE clause for tier filter
  let tierClause = '';
  const tierParams = [];
  if (tier === 'A') {
    tierClause = "WHERE tier = 'A' AND active = 1";
  } else if (tier === 'B') {
    tierClause = "WHERE tier = 'B' AND active = 1";
  } else {
    tierClause = 'WHERE active = 1';
  }

  const tokens = db.prepare(`
    SELECT id, symbol, name, coingecko_id, category, tier
    FROM token_universe
    ${tierClause}
    ORDER BY id ASC
    LIMIT ?
  `).all(limit);

  if (tokens.length === 0) {
    console.log('[batch-scanner] No tokens found in universe for tier:', tier);
    return { scanned: 0, succeeded: 0, failed: 0, tier, level, limit, tokens: [] };
  }

  console.log(`[batch-scanner] Starting batch scan: tier=${tier}, level=${level}, limit=${limit}, found=${tokens.length} tokens`);

  const results = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const projectName = token.coingecko_id || token.name;
    console.log(`[batch-scanner] [${i + 1}/${tokens.length}] Scanning ${projectName} (${token.symbol})...`);

    try {
      const rawData = collectFn
        ? await collectFn(projectName, level)
        : await collectForToken(projectName, level);

      // Calculate scores (algorithmic only, NO LLM)
      const scores = scoreFn
        ? scoreFn(rawData)
        : calculateScores(rawData);

      // Save snapshot
      let snapshotId = null;
      if (level >= 1) {
        snapshotId = snapshotFn
          ? await snapshotFn(projectName, rawData, scores)
          : await storeScanSnapshot(projectName, rawData, scores);
      }

      const result = {
        project: projectName,
        symbol: token.symbol,
        tier: token.tier,
        ok: true,
        overall_score: scores?.overall?.score ?? null,
        snapshot_id: snapshotId,
      };
      results.push(result);
      succeeded++;
      console.log(`[batch-scanner] ✓ ${projectName} — score: ${result.overall_score ?? 'n/a'}, snapshot: #${snapshotId ?? 'n/a'}`);
    } catch (err) {
      console.error(`[batch-scanner] ✗ ${projectName} — error: ${err.message}`);
      results.push({ project: projectName, symbol: token.symbol, tier: token.tier, ok: false, error: err.message });
      failed++;
    }

    // Rate limit delay (skip after last token)
    if (i < tokens.length - 1 && rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
  }

  const summary = {
    scanned: tokens.length,
    succeeded,
    failed,
    tier,
    level,
    limit,
    started_at: results[0]?.started_at ?? new Date().toISOString(),
    completed_at: new Date().toISOString(),
    tokens: results,
  };

  console.log(`[batch-scanner] Done — ${succeeded}/${tokens.length} succeeded, ${failed} failed`);
  return summary;
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('batch-scanner.js')) {
  const args = process.argv.slice(2);
  const getArg = (flag, def) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
  };

  const tier = getArg('--tier', 'A');
  const level = parseInt(getArg('--level', '1'), 10);
  const limit = parseInt(getArg('--limit', '10'), 10);

  runBatchScan({ tier, level, limit })
    .then((summary) => {
      console.log('\n✅ Batch scan complete:');
      console.log(JSON.stringify({ scanned: summary.scanned, succeeded: summary.succeeded, failed: summary.failed }, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[batch-scanner] Fatal error:', err);
      process.exit(1);
    });
}
