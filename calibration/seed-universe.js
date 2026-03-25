/**
 * seed-universe.js — popola token_universe con ~150 token iniziali
 * Idempotente: usa INSERT OR IGNORE on coingecko_id
 *
 * Usage: node calibration/seed-universe.js
 * Exports: seedUniverse()
 */

import { getCalibrationDb } from './db.js';

const UNIVERSE = {
  // Top 50 by market cap — tier A (populated from CoinGecko API)
  top: [],

  // DeFi — tier A
  defi: [
    'aave', 'uniswap', 'maker', 'curve-dao-token', 'compound-governance-token',
    'lido-dao', 'rocket-pool', 'morpho', 'pendle', 'gmx',
    'dydx-chain', 'synthetix-network-token', 'sushi', 'balancer',
    'pancakeswap-token', 'joe', 'raydium', 'orca', 'jupiter-exchange-solana', 'aerodrome-finance',
  ],

  // AI / Infra — tier A
  ai: [
    'bittensor', 'render-token', 'fetch-ai', 'ocean-protocol', 'akash-network',
    'singularitynet', 'numeraire', 'arkham', 'worldcoin', 'the-graph',
    'chainlink', 'filecoin', 'arweave', 'livepeer', 'helium',
    'theta-token', 'iotex', 'golem', 'audius', 'phala-network',
  ],

  // Meme — tier B
  meme: [
    'dogecoin', 'shiba-inu', 'pepe', 'dogwifcoin', 'bonk',
    'floki', 'brett', 'book-of-meme', 'mog-coin', 'popcat',
    'cat-in-a-dogs-world', 'giga-chad', 'turbo', 'neiro-on-eth',
    'memecoin-2', 'myro', 'wen-4', 'slerf', 'jeo-boden', 'mother-iggy',
  ],

  // L1/L2 — tier A
  l1l2: [
    'ethereum', 'solana', 'avalanche-2', 'near', 'sui', 'aptos',
    'arbitrum', 'optimism', 'polygon-ecosystem-token', 'starknet',
    'sei-network', 'injective-protocol', 'celestia', 'mantle',
    'immutable-x', 'mina-protocol', 'kaspa', 'fantom', 'celo', 'metis-token',
  ],

  // Emerging — tier B (rotazione)
  emerging: [
    'ethena', 'jito-governance-token', 'ondo-finance', 'eigenlayer',
    'pyth-network', 'wormhole', 'layerzero', 'zksync', 'scroll',
    'monad', 'berachain', 'movement', 'hyperlane', 'eclipse-fi',
    'mode-token', 'merlin-chain', 'blast', 'manta-network', 'linea', 'taiko',
  ],
};

// Category mapping for coarse categorization
const CATEGORY_MAP = {
  defi: 'defi',
  ai: 'ai_infrastructure',
  meme: 'meme',
  l1l2: 'l1l2',
  emerging: 'emerging',
  top: null, // will be determined by CoinGecko data
};

const TIER_MAP = {
  defi: 'A',
  ai: 'A',
  meme: 'B',
  l1l2: 'A',
  emerging: 'B',
  top: 'A',
};

/**
 * Fetch top 50 tokens by market cap from CoinGecko (free, no key).
 */
export async function fetchTopTokens() {
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1';
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
  const data = await res.json();
  return data.map((coin) => ({
    coingecko_id: coin.id,
    symbol: (coin.symbol || '').toUpperCase(),
    name: coin.name,
    category: null,
    tier: 'A',
    group: 'top',
  }));
}

/**
 * Build the full token list from hardcoded groups + CoinGecko top.
 */
function buildTokenList(topTokens = []) {
  const seen = new Set();
  const tokens = [];

  function addToken({ coingecko_id, symbol, name, group }) {
    if (!coingecko_id) return;
    if (seen.has(coingecko_id)) return;
    seen.add(coingecko_id);

    // Derive category
    const category = CATEGORY_MAP[group] ?? null;
    const tier = TIER_MAP[group] ?? 'B';

    tokens.push({
      coingecko_id,
      symbol: symbol || coingecko_id.toUpperCase().slice(0, 10),
      name: name || coingecko_id,
      category,
      tier,
    });
  }

  // Add top tokens first (they have real symbol/name from API)
  for (const t of topTokens) {
    addToken({ ...t, group: 'top' });
  }

  // Add hardcoded groups
  for (const [group, ids] of Object.entries(UNIVERSE)) {
    if (group === 'top') continue;
    for (const id of ids) {
      addToken({ coingecko_id: id, symbol: id.split('-')[0].toUpperCase(), name: id, group });
    }
  }

  return tokens;
}

/**
 * Seed the token_universe table.
 * @param {object} opts
 * @param {object} [opts.db] - optional DB instance (for testing)
 * @param {Array} [opts.topTokens] - optional pre-fetched top tokens (for testing)
 * @param {boolean} [opts.skipFetch] - skip CoinGecko fetch (for testing)
 * @returns {{ inserted: number, skipped: number, total: number }}
 */
export async function seedUniverse({ db: injectedDb, topTokens: injectedTop, skipFetch = false } = {}) {
  const db = injectedDb || getCalibrationDb();

  let topTokens = injectedTop || [];
  if (!skipFetch && !injectedTop) {
    try {
      console.log('[seed-universe] Fetching top 50 tokens from CoinGecko...');
      topTokens = await fetchTopTokens();
      console.log(`[seed-universe] Fetched ${topTokens.length} top tokens`);
    } catch (err) {
      console.warn(`[seed-universe] CoinGecko fetch failed: ${err.message} — using hardcoded list only`);
      topTokens = [];
    }
  }

  const tokens = buildTokenList(topTokens);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO token_universe (symbol, name, coingecko_id, category, tier)
    VALUES (?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  let skipped = 0;

  const insertMany = db.transaction((list) => {
    for (const t of list) {
      const result = stmt.run(t.symbol, t.name, t.coingecko_id, t.category, t.tier);
      if (result.changes > 0) {
        inserted++;
      } else {
        skipped++;
      }
    }
  });

  insertMany(tokens);

  console.log(`[seed-universe] Done — inserted: ${inserted}, skipped: ${skipped}, total in list: ${tokens.length}`);
  return { inserted, skipped, total: tokens.length };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('seed-universe.js')) {
  seedUniverse()
    .then(({ inserted, skipped, total }) => {
      console.log(`\n✅ Token universe seeded: ${inserted} new, ${skipped} already present (${total} total)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[seed-universe] Fatal error:', err);
      process.exit(1);
    });
}

export { buildTokenList };
