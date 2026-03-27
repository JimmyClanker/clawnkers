/**
 * Category-Adaptive Weighting — Clawnkers Scoring Engine v2 (Phase 3)
 *
 * Each weight set MUST sum to 1.0.
 * Boot-time validation runs automatically on import.
 */

export const CATEGORY_WEIGHTS = {
  meme_token: {
    market: 0.10, onchain: 0.05, social: 0.35, development: 0.03,
    tokenomics: 0.07, distribution: 0.25, risk: 0.15,
  },
  defi_lending: {
    market: 0.12, onchain: 0.30, social: 0.08, development: 0.15,
    tokenomics: 0.15, distribution: 0.10, risk: 0.10,
  },
  defi_dex: {
    market: 0.12, onchain: 0.28, social: 0.10, development: 0.15,
    tokenomics: 0.15, distribution: 0.10, risk: 0.10,
  },
  layer_1: {
    market: 0.12, onchain: 0.22, social: 0.12, development: 0.22,
    tokenomics: 0.12, distribution: 0.10, risk: 0.10,
  },
  layer_2: {
    market: 0.10, onchain: 0.25, social: 0.10, development: 0.25,
    tokenomics: 0.12, distribution: 0.08, risk: 0.10,
  },
  ai_infrastructure: {
    market: 0.10, onchain: 0.15, social: 0.20, development: 0.25,
    tokenomics: 0.10, distribution: 0.10, risk: 0.10,
  },
  nft_gaming: {
    market: 0.12, onchain: 0.15, social: 0.25, development: 0.18,
    tokenomics: 0.10, distribution: 0.10, risk: 0.10,
  },
  // Round 33 (AutoResearch): Real World Assets — regulatory/institutional signals matter more
  rwa: {
    market: 0.15, onchain: 0.25, social: 0.08, development: 0.12,
    tokenomics: 0.18, distribution: 0.12, risk: 0.10,
  },
  // Round 33 (AutoResearch): DePIN — hardware/network deployment + development are key
  depin: {
    market: 0.10, onchain: 0.20, social: 0.12, development: 0.28,
    tokenomics: 0.12, distribution: 0.08, risk: 0.10,
  },
  // Round 146 (AutoResearch): Cross-chain bridge — security/risk is paramount, onchain TVL matters
  // Bridge hacks are the #1 exploit vector; risk weight is highest of any category
  cross_chain_bridge: {
    market: 0.10, onchain: 0.25, social: 0.05, development: 0.18,
    tokenomics: 0.12, distribution: 0.12, risk: 0.18,
  },
  // Round 146 (AutoResearch): Derivatives/Perps — onchain volume + market structure matters
  derivatives: {
    market: 0.12, onchain: 0.30, social: 0.10, development: 0.15,
    tokenomics: 0.13, distribution: 0.10, risk: 0.10,
  },
  // Round R27 (AutoResearch batch): Privacy protocols — regulatory risk is critical, dev activity key
  // Mixers/privacy coins face regulatory headwinds; risk weight elevated, social weight reduced
  privacy_protocol: {
    market: 0.10, onchain: 0.15, social: 0.06, development: 0.25,
    tokenomics: 0.14, distribution: 0.12, risk: 0.18,
  },
  // Round R27: Oracle networks — data integrity + security is paramount, dev activity core signal
  oracle: {
    market: 0.10, onchain: 0.20, social: 0.08, development: 0.28,
    tokenomics: 0.12, distribution: 0.10, risk: 0.12,
  },
  // Round R27: Liquid staking — onchain TVL & security are the core value drivers
  liquid_staking: {
    market: 0.10, onchain: 0.30, social: 0.08, development: 0.18,
    tokenomics: 0.14, distribution: 0.12, risk: 0.08,
  },
  // Round 153 (AutoResearch): Yield aggregators — compounding/APY strategy quality drives value
  // TVL stickiness + revenue capture are key; dev slightly above average for strategy innovation
  yield_aggregator: {
    market: 0.10, onchain: 0.32, social: 0.07, development: 0.17,
    tokenomics: 0.14, distribution: 0.10, risk: 0.10,
  },
  // Round 153 (AutoResearch): Prediction markets — onchain volume + market resolution matters
  // More social/narrative driven than pure DeFi; dev activity important for market creation
  prediction_market: {
    market: 0.12, onchain: 0.25, social: 0.18, development: 0.15,
    tokenomics: 0.12, distribution: 0.10, risk: 0.08,
  },
  // Round 233 (AutoResearch nightly): Payments/stablecoin infrastructure
  // Adoption metrics + distribution are critical; dev activity and onchain tx volume matter more than TVL
  payments: {
    market: 0.12, onchain: 0.20, social: 0.12, development: 0.20,
    tokenomics: 0.12, distribution: 0.14, risk: 0.10,
  },
  // Round 232 (AutoResearch nightly): Consumer crypto apps (Base/Farcaster/social protocols)
  // User adoption and social signals drive value; dev activity is critical for app quality
  consumer_crypto: {
    market: 0.10, onchain: 0.15, social: 0.28, development: 0.22,
    tokenomics: 0.10, distribution: 0.10, risk: 0.05,
  },
  // Round 232 (AutoResearch nightly): Infrastructure/tooling (wallets, indexers, data protocols)
  // Usage metrics + development quality are primary; social less important for B2B infra
  infra_tooling: {
    market: 0.10, onchain: 0.18, social: 0.08, development: 0.32,
    tokenomics: 0.12, distribution: 0.10, risk: 0.10,
  },
  default: {
    market: 0.14, onchain: 0.18, social: 0.14, development: 0.18,
    tokenomics: 0.14, distribution: 0.12, risk: 0.10,
  },
};

/** Map from raw CoinGecko / DeFiLlama category slugs → Clawnkers category keys. */
export const CATEGORY_MAP = {
  lending: 'defi_lending',
  'borrowing-lending': 'defi_lending',
  dexes: 'defi_dex',
  dex: 'defi_dex',
  yield: 'yield_aggregator',
  'yield-aggregator': 'yield_aggregator',
  'yield-optimizer': 'yield_aggregator',
  'prediction-market': 'prediction_market',
  'prediction-markets': 'prediction_market',
  polymarket: 'prediction_market',
  'layer-1': 'layer_1',
  'layer-2': 'layer_2',
  meme: 'meme_token',
  'meme-token': 'meme_token',
  'dog-themed': 'meme_token',
  'cat-themed': 'meme_token',
  'artificial-intelligence': 'ai_infrastructure',
  ai: 'ai_infrastructure',
  gaming: 'nft_gaming',
  nft: 'nft_gaming',
  metaverse: 'nft_gaming',
  'play-to-earn': 'nft_gaming',
  // Round 33 (AutoResearch): RWA and DePIN mappings
  'real-world-assets': 'rwa',
  'real-world-asset': 'rwa',
  rwa: 'rwa',
  'tokenized-asset': 'rwa',
  'tokenized-securities': 'rwa',
  depin: 'depin',
  'decentralized-physical-infrastructure': 'depin',
  'iot-network': 'depin',
  // Round 146 (AutoResearch): Cross-chain bridge and derivatives
  'cross-chain': 'cross_chain_bridge',
  bridge: 'cross_chain_bridge',
  bridges: 'cross_chain_bridge',
  'cross-chain-communication': 'cross_chain_bridge',
  derivatives: 'derivatives',
  perpetuals: 'derivatives',
  'decentralized-derivatives': 'derivatives',
  'options': 'derivatives',
  // Round 122 (AutoResearch): Additional common CoinGecko/DeFiLlama slugs
  stablecoin: 'default',
  'stablecoins': 'default',
  oracle: 'oracle',               // Round R27: oracles get dedicated weights
  'oracle-network': 'oracle',
  'data-oracle': 'oracle',
  infrastructure: 'layer_1',      // generic infra → treat like L1 (dev-heavy)
  privacy: 'privacy_protocol',    // Round R27: privacy protocols get dedicated weights
  'privacy-coins': 'privacy_protocol',
  'privacy-protocol': 'privacy_protocol',
  mixer: 'privacy_protocol',
  'liquid-staking': 'liquid_staking', // Round R27: liquid staking dedicated weights
  'liquid-staking-tokens': 'liquid_staking',
  restaking: 'liquid_staking',
  'insurance': 'defi_lending',    // DeFi insurance is onchain-risk heavy
  'fan-token': 'meme_token',      // fan tokens behave like memes: social-driven
  'sports': 'meme_token',
  // Round 344 (AutoResearch): Additional category slug mappings
  'staking': 'liquid_staking',          // generic 'staking' → liquid_staking weights (dev + onchain focused)
  'staking-pool': 'liquid_staking',
  'eth-staking': 'liquid_staking',
  'sol-staking': 'liquid_staking',
  'governance': 'layer_1',              // governance tokens behave like L1: dev + onchain heavy
  'governance-token': 'layer_1',
  'dao': 'layer_1',
  'decentralized-autonomous-organization': 'layer_1',
  'launchpad': 'consumer_crypto',       // launchpads are community/social driven
  'ido-platform': 'consumer_crypto',
  'asset-management': 'defi_lending',   // asset management is onchain TVL-driven
  'portfolio-management': 'defi_lending',
  'aggregator': 'defi_dex',             // DEX aggregators → defi_dex weights
  'dex-aggregator': 'defi_dex',
  'swap-aggregator': 'defi_dex',
  // Round 232: consumer crypto & infra
  'social-fi': 'consumer_crypto',
  socialfi: 'consumer_crypto',
  'consumer-crypto': 'consumer_crypto',
  'farcaster': 'consumer_crypto',
  'tooling': 'infra_tooling',
  'infrastructure-service': 'infra_tooling',
  'data-protocol': 'infra_tooling',
  'indexer': 'infra_tooling',
  'analytics': 'infra_tooling',
  'data-availability': 'layer_2',
  'rollup': 'layer_2',
  'rollup-as-a-service': 'layer_2',
  // Round 233: payments category mappings
  'payments': 'payments',
  'payment': 'payments',
  'payment-solutions': 'payments',
  'cross-border-payments': 'payments',
  'remittance': 'payments',
  'stablecoin-payment': 'payments',
};

// ─── Boot-time validation ────────────────────────────────────────────────────

const DIMS = ['market', 'onchain', 'social', 'development', 'tokenomics', 'distribution', 'risk'];

for (const [catKey, weights] of Object.entries(CATEGORY_WEIGHTS)) {
  const sum = DIMS.reduce((acc, d) => acc + (weights[d] ?? 0), 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(
      `[category-weights] Weight set "${catKey}" does not sum to 1.0 (got ${sum.toFixed(6)}). Fix before proceeding.`
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Try to resolve a raw category string against CATEGORY_MAP.
 * Normalises to lowercase + trimmed for comparison.
 * @param {string|undefined} raw
 * @returns {string|null} Clawnkers category key, or null if not found
 */
function resolveCategory(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const normalised = raw.trim().toLowerCase();
  return CATEGORY_MAP[normalised] ?? null;
}

/**
 * Try each string in an array against CATEGORY_MAP, return first match.
 * @param {string[]} arr
 * @returns {string|null}
 */
function resolveCategoryFromArray(arr) {
  if (!Array.isArray(arr)) return null;
  for (const item of arr) {
    const resolved = resolveCategory(item);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Interpolate weights toward default when confidence is low.
 * If confidence >= 0.5 the category weights are used as-is.
 * Below 0.5 they are blended with default proportional to confidence.
 *
 * @param {object} categoryWeights  - weights for the detected category
 * @param {number} confidence       - 0 to 1
 * @returns {object} effective weights (still sums to 1.0)
 */
function interpolateWeights(categoryWeights, confidence) {
  if (confidence >= 0.5) return { ...categoryWeights };
  const defaultW = CATEGORY_WEIGHTS.default;
  const effective = {};
  for (const dim of DIMS) {
    effective[dim] = categoryWeights[dim] * confidence + defaultW[dim] * (1 - confidence);
  }
  return effective;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Determine the best-fit Clawnkers category for a token and return effective
 * dimension weights adjusted by confidence.
 *
 * This is a pure function — no side effects, no async.
 *
 * @param {object} rawData - full collector data object
 * @returns {{ weights: object, category: string, source: string, confidence: number }}
 */
export function getCategoryWeights(rawData = {}) {
  const market     = rawData?.market    ?? {};
  const onchain    = rawData?.onchain   ?? {};
  const analysis   = rawData?.analysis  ?? {};
  const ecosystem  = rawData?.ecosystem ?? {};
  const social     = rawData?.social    ?? {};
  const github     = rawData?.github    ?? {};

  // 1. CoinGecko categories array (highest confidence)
  const coingeckoCategories = market?.categories;
  if (Array.isArray(coingeckoCategories) && coingeckoCategories.length > 0) {
    const resolved = resolveCategoryFromArray(coingeckoCategories);
    if (resolved) {
      const confidence = 0.9;
      // Round 136 (AutoResearch): meme_token large-cap blending
      // High-mcap meme tokens ($1B+) behave more like L1s in market dynamics.
      // Blend meme weights toward L1 proportionally: $1B = 0% L1, $10B+ = 30% L1 (log10 scale).
      // Round 332 (AutoResearch): fixed comment — formula starts at 0% at $1B, reaches 30% at $10B+.
      let effectiveWeights = interpolateWeights(CATEGORY_WEIGHTS[resolved], confidence);
      if (resolved === 'meme_token') {
        const mcap = safeNum(market?.market_cap ?? 0);
        if (mcap >= 1_000_000_000) {
          const blendFactor = Math.min((Math.log10(mcap / 1e9) / Math.log10(10)) * 0.3, 0.3); // 0 at $1B, 0.3 at $10B+
          if (blendFactor > 0) {
            const l1W = CATEGORY_WEIGHTS.layer_1;
            for (const dim of DIMS) {
              effectiveWeights[dim] = effectiveWeights[dim] * (1 - blendFactor) + l1W[dim] * blendFactor;
            }
            // Renormalize to ensure sum = 1.0
            const total = DIMS.reduce((a, d) => a + effectiveWeights[d], 0);
            for (const dim of DIMS) effectiveWeights[dim] = effectiveWeights[dim] / total;
          }
        }
      }
      return {
        weights: effectiveWeights,
        category: resolved,
        source: 'coingecko_categories',
        confidence,
      };
    }
  }

  // 2. DeFiLlama category string (equally high confidence)
  if (onchain?.category) {
    const resolved = resolveCategory(onchain.category);
    if (resolved) {
      const confidence = 0.9;
      return {
        weights: interpolateWeights(CATEGORY_WEIGHTS[resolved], confidence),
        category: resolved,
        source: 'defillama_category',
        confidence,
      };
    }
  }

  // 3. LLM analysis / ecosystem category (lower confidence)
  const llmCategory = analysis?.project_category ?? ecosystem?.category ?? null;
  if (llmCategory) {
    const resolved = resolveCategory(llmCategory);
    if (resolved) {
      const confidence = 0.7;
      return {
        weights: interpolateWeights(CATEGORY_WEIGHTS[resolved], confidence),
        category: resolved,
        source: 'llm_ecosystem',
        confidence,
      };
    }
  }

  // 4. Heuristic: DeFi protocol (TVL > 0 AND fees > 0)
  const tvl  = safeNum(onchain?.tvl);
  const fees = safeNum(onchain?.fees_7d ?? onchain?.fees_30d);
  if (tvl > 0 && fees > 0) {
    const confidence = 0.5;
    return {
      weights: interpolateWeights(CATEGORY_WEIGHTS.defi_lending, confidence),
      category: 'defi_inferred',
      source: 'heuristic_defi',
      confidence,
    };
  }

  // 5. Heuristic: Meme token (social mentions > 500, no TVL, no github activity)
  const mentions = safeNum(social?.filtered_mentions ?? social?.mentions ?? 0);
  const hasGithub = !github?.error && (
    safeNum(github?.commits_90d) > 0 ||
    safeNum(github?.stars) > 0 ||
    safeNum(github?.contributors) > 0
  );
  if (mentions > 500 && tvl === 0 && !hasGithub) {
    const confidence = 0.5;
    return {
      weights: interpolateWeights(CATEGORY_WEIGHTS.meme_token, confidence),
      category: 'meme_inferred',
      source: 'heuristic_meme',
      confidence,
    };
  }

  // 6. Fallback: default weights at low confidence
  const confidence = 0.3;
  return {
    weights: interpolateWeights(CATEGORY_WEIGHTS.default, confidence),
    category: 'default',
    source: 'fallback',
    confidence,
  };
}
