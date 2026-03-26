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
  yield: 'defi_lending',
  'yield-aggregator': 'defi_lending',
  'liquid-staking': 'defi_lending',
  bridge: 'defi_dex',
  derivatives: 'defi_dex',
  perpetuals: 'defi_dex',
  'layer-1': 'layer_1',
  'layer-2': 'layer_2',
  rollup: 'layer_2',
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
  // Round 122 (AutoResearch): Additional common CoinGecko/DeFiLlama slugs
  stablecoin: 'default',
  'stablecoins': 'default',
  oracle: 'ai_infrastructure',    // oracles are infra; dev/onchain signals matter most
  'oracle-network': 'ai_infrastructure',
  infrastructure: 'layer_1',      // generic infra → treat like L1 (dev-heavy)
  'cross-chain': 'layer_2',       // bridges/cross-chain are layer_2-like
  privacy: 'layer_1',             // privacy protocols: dev + onchain matter
  'privacy-coins': 'layer_1',
  'insurance': 'defi_lending',    // DeFi insurance is onchain-risk heavy
  'prediction-market': 'defi_dex', // prediction markets: onchain volume/usage
  'fan-token': 'meme_token',      // fan tokens behave like memes: social-driven
  'sports': 'meme_token',
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
      // Blend meme weights toward L1 proportionally: $1B = 10% L1, $10B+ = 30% L1.
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
