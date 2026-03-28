/**
 * sector-context.js — Round 6: Sector Context Engine
 *
 * Dynamic sector classification with sector-specific metric weights
 * and key performance indicators.
 */

const SECTOR_DEFINITIONS = {
  DeFi: {
    keywords: ['defi', 'dex', 'lending', 'yield', 'amm', 'liquidity', 'swap', 'borrow', 'lend'],
    keyMetrics: ['tvl', 'fees_7d', 'revenue_7d', 'volume_24h'],
    weights: { market: 0.15, onchain: 0.25, social: 0.10, development: 0.18, tokenomics: 0.14, distribution: 0.12, risk: 0.06 },
    description: 'DeFi protocols — TVL and fee revenue are primary value indicators.',
  },
  L1: {
    keywords: ['layer 1', 'l1', 'blockchain', 'chain', 'mainnet', 'consensus', 'validator'],
    keyMetrics: ['market_cap', 'development', 'active_addresses_7d', 'contributors'],
    weights: { market: 0.17, onchain: 0.16, social: 0.10, development: 0.25, tokenomics: 0.14, distribution: 0.12, risk: 0.06 },
    description: 'Layer 1 blockchains — developer activity and ecosystem growth matter most.',
  },
  L2: {
    keywords: ['layer 2', 'l2', 'rollup', 'zk', 'optimistic', 'scaling'],
    keyMetrics: ['tvl', 'fees_7d', 'active_addresses_7d', 'development'],
    weights: { market: 0.16, onchain: 0.22, social: 0.10, development: 0.22, tokenomics: 0.12, distribution: 0.12, risk: 0.06 },
    description: 'Layer 2 scaling solutions — onchain health and dev activity are key.',
  },
  Gaming: {
    keywords: ['gaming', 'game', 'play-to-earn', 'p2e', 'metaverse', 'nft game'],
    keyMetrics: ['social_mentions', 'market_cap', 'volume_24h'],
    weights: { market: 0.18, onchain: 0.12, social: 0.22, development: 0.18, tokenomics: 0.12, distribution: 0.12, risk: 0.06 },
    description: 'Gaming/Metaverse — social momentum and community engagement drive value.',
  },
  AI: {
    keywords: ['ai', 'artificial intelligence', 'machine learning', 'neural', 'agent', 'llm'],
    keyMetrics: ['development', 'social_mentions', 'market_cap'],
    weights: { market: 0.18, onchain: 0.12, social: 0.18, development: 0.22, tokenomics: 0.12, distribution: 0.12, risk: 0.06 },
    description: 'AI/ML protocols — development velocity and narrative momentum are primary.',
  },
  Meme: {
    keywords: ['meme', 'memecoin', 'doge', 'shib', 'pepe', 'dog', 'cat', 'frog'],
    keyMetrics: ['social_mentions', 'volume_24h', 'market_cap'],
    weights: { market: 0.20, onchain: 0.08, social: 0.28, development: 0.06, tokenomics: 0.14, distribution: 0.14, risk: 0.10 },
    description: 'Memecoins — social momentum and trading volume are everything. Dev matters least.',
  },
  RWA: {
    keywords: ['rwa', 'real world', 'tokenized', 'treasury', 'real estate', 'commodity'],
    keyMetrics: ['tvl', 'market_cap', 'tokenomics'],
    weights: { market: 0.18, onchain: 0.22, social: 0.08, development: 0.14, tokenomics: 0.18, distribution: 0.14, risk: 0.06 },
    description: 'Real World Assets — TVL and tokenomics structure are primary value drivers.',
  },
  Infrastructure: {
    keywords: ['infrastructure', 'infra', 'storage', 'compute', 'oracle', 'data', 'indexer', 'node'],
    keyMetrics: ['development', 'fees_7d', 'active_addresses_7d'],
    weights: { market: 0.16, onchain: 0.18, social: 0.10, development: 0.24, tokenomics: 0.14, distribution: 0.12, risk: 0.06 },
    description: 'Infrastructure protocols — dev activity and real usage/revenue are key.',
  },
  Oracle: {
    keywords: ['oracle', 'price feed', 'data feed', 'chainlink', 'band'],
    keyMetrics: ['development', 'fees_7d', 'contributors'],
    weights: { market: 0.16, onchain: 0.18, social: 0.10, development: 0.24, tokenomics: 0.14, distribution: 0.12, risk: 0.06 },
    description: 'Oracle networks — reliability and integration breadth are primary.',
  },
  DEX: {
    keywords: ['dex', 'decentralized exchange', 'swap', 'amm', 'uniswap', 'sushi'],
    keyMetrics: ['tvl', 'fees_7d', 'volume_24h', 'dex_liquidity_usd'],
    weights: { market: 0.14, onchain: 0.26, social: 0.10, development: 0.16, tokenomics: 0.14, distribution: 0.14, risk: 0.06 },
    description: 'DEXs — TVL, volume, and fee revenue are the core metrics.',
  },
  Lending: {
    keywords: ['lending', 'borrow', 'lend', 'money market', 'aave', 'compound'],
    keyMetrics: ['tvl', 'fees_7d', 'revenue_7d'],
    weights: { market: 0.14, onchain: 0.26, social: 0.08, development: 0.18, tokenomics: 0.14, distribution: 0.14, risk: 0.06 },
    description: 'Lending protocols — TVL utilization and revenue capture are primary.',
  },
  Bridge: {
    keywords: ['bridge', 'cross-chain', 'interoperability', 'multichain', 'omnichain'],
    keyMetrics: ['tvl', 'volume_24h', 'fees_7d'],
    weights: { market: 0.16, onchain: 0.22, social: 0.10, development: 0.18, tokenomics: 0.14, distribution: 0.12, risk: 0.08 },
    description: 'Bridge protocols — TVL and volume indicate trust and usage. Higher risk weight.',
  },
  NFT: {
    keywords: ['nft', 'collectible', 'art', 'pfp', 'marketplace'],
    keyMetrics: ['social_mentions', 'volume_24h', 'market_cap'],
    weights: { market: 0.18, onchain: 0.12, social: 0.24, development: 0.14, tokenomics: 0.14, distribution: 0.12, risk: 0.06 },
    description: 'NFT platforms — social buzz and trading volume drive value.',
  },
  Social: {
    keywords: ['social', 'social media', 'lens', 'farcaster', 'decentralized social'],
    keyMetrics: ['social_mentions', 'development', 'active_addresses_7d'],
    weights: { market: 0.16, onchain: 0.14, social: 0.24, development: 0.18, tokenomics: 0.12, distribution: 0.10, risk: 0.06 },
    description: 'Decentralized social — user activity and social metrics are primary.',
  },
  Privacy: {
    keywords: ['privacy', 'zero-knowledge', 'zk', 'mixer', 'anonymous', 'private'],
    keyMetrics: ['development', 'market_cap', 'tvl'],
    weights: { market: 0.18, onchain: 0.16, social: 0.10, development: 0.22, tokenomics: 0.14, distribution: 0.12, risk: 0.08 },
    description: 'Privacy protocols — development quality and regulatory risk are key.',
  },
  // Round 384 (AutoResearch batch): AI infrastructure sector
  AIInfrastructure: {
    keywords: ['ai agent', 'on-chain ai', 'decentralized ai', 'ai compute', 'zkml', 'ai inference', 'llm', 'neural', 'machine learning'],
    keyMetrics: ['development', 'fees_7d', 'social_mentions', 'active_addresses_7d'],
    weights: { market: 0.16, onchain: 0.16, social: 0.18, development: 0.24, tokenomics: 0.12, distribution: 0.10, risk: 0.04 },
    description: 'AI infrastructure — development velocity and real usage/API demand are primary.',
  },
  // Round 384: DePIN sector
  DePIN: {
    keywords: ['depin', 'decentralized physical', 'decentralized infrastructure', 'wireless', 'helium', 'hotspot', 'sensor', 'iot'],
    keyMetrics: ['development', 'active_addresses_7d', 'fees_7d', 'market_cap'],
    weights: { market: 0.16, onchain: 0.18, social: 0.14, development: 0.22, tokenomics: 0.14, distribution: 0.10, risk: 0.06 },
    description: 'DePIN — hardware adoption rate and real network revenue are key. Dev velocity and token economics matter for node incentives.',
  },
  // Round 700 (AutoResearch batch): Agent Commerce sector — new 2026 category
  AgentCommerce: {
    keywords: ['agent commerce', 'x402', 'acp protocol', 'agent-to-agent', 'mcp payment', 'machine payment', 'autonomous payment', 'agent economy', 'agent marketplace'],
    keyMetrics: ['fees_7d', 'development', 'active_addresses_7d', 'social_mentions'],
    weights: { market: 0.14, onchain: 0.20, social: 0.16, development: 0.26, tokenomics: 0.12, distribution: 0.08, risk: 0.04 },
    description: 'Agent Commerce — protocol adoption velocity and developer tooling are primary. Fee generation from machine-to-machine payments is the key fundamental metric.',
  },
  // Round 700 (AutoResearch batch): Bitcoin DeFi (BTCfi) sector
  BTCfi: {
    keywords: ['bitcoin defi', 'btcfi', 'bitcoin l2', 'bitcoin staking', 'bitcoin yield', 'babylon', 'ordinals defi', 'bitcoin liquidity', 'wrapped btc protocol'],
    keyMetrics: ['tvl', 'fees_7d', 'active_addresses_7d', 'market_cap'],
    weights: { market: 0.18, onchain: 0.25, social: 0.12, development: 0.18, tokenomics: 0.13, distribution: 0.10, risk: 0.04 },
    description: 'BTCfi — BTC TVL growth rate and security model are primary. Unlike EVM DeFi, smart contract simplicity and Bitcoin native custody are key differentiators.',
  },
};

/**
 * Classify a project into a sector based on available data.
 *
 * @param {object} rawData - raw collector output
 * @returns {object} sector context
 */
export function classifySector(rawData = {}) {
  const category = rawData?.onchain?.category?.toLowerCase() ?? '';
  const name = (rawData?.market?.name ?? rawData?.project_name ?? '').toLowerCase();
  const description = (rawData?.market?.description ?? '').toLowerCase();
  const chains = Array.isArray(rawData?.onchain?.chains) ? rawData.onchain.chains.join(' ').toLowerCase() : '';
  const narratives = Array.isArray(rawData?.social?.key_narratives) ? rawData.social.key_narratives.join(' ').toLowerCase() : '';

  const searchText = `${category} ${name} ${description} ${chains} ${narratives}`;

  // Score each sector by keyword matches
  let bestSector = null;
  let bestScore = 0;

  for (const [sector, def] of Object.entries(SECTOR_DEFINITIONS)) {
    let matchScore = 0;
    for (const kw of def.keywords) {
      if (searchText.includes(kw)) matchScore += 1;
    }
    // Bonus for exact category match
    if (category === sector.toLowerCase()) matchScore += 5;
    if (matchScore > bestScore) {
      bestScore = matchScore;
      bestSector = sector;
    }
  }

  // Default to DeFi if no match (most common)
  if (!bestSector || bestScore === 0) {
    bestSector = 'DeFi';
  }

  const sectorDef = SECTOR_DEFINITIONS[bestSector];

  return {
    sector: bestSector,
    confidence: bestScore >= 3 ? 'high' : bestScore >= 1 ? 'moderate' : 'low',
    description: sectorDef.description,
    key_metrics: sectorDef.keyMetrics,
    adjusted_weights: sectorDef.weights,
    match_score: bestScore,
  };
}

/**
 * Get sector-specific scoring weights.
 *
 * @param {string} sector - sector name
 * @returns {object} weights per dimension
 */
export function getSectorWeights(sector) {
  const def = SECTOR_DEFINITIONS[sector];
  if (!def) return SECTOR_DEFINITIONS.DeFi.weights;
  return def.weights;
}

/**
 * Round 382 (AutoResearch): Analyze trade size profile vs sector expectations.
 * Meme tokens typically have very small trades (retail); DeFi/L1 have larger institutional trades.
 * Returns qualitative assessment for LLM context.
 *
 * @param {string} sector - detected sector
 * @param {number|null} medianTradeSizeUsd - from dex collector
 * @returns {{ assessment: string, detail: string }|null}
 */
export function analyzeTradeSizeProfile(sector, medianTradeSizeUsd) {
  if (medianTradeSizeUsd == null || !Number.isFinite(medianTradeSizeUsd)) return null;
  const size = medianTradeSizeUsd;

  // Sector-specific trade size expectations
  const SECTOR_EXPECTATIONS = {
    Meme: { typical_min: 10, typical_max: 500, institutional_min: 5000 },
    DeFi: { typical_min: 100, typical_max: 10000, institutional_min: 50000 },
    L1: { typical_min: 100, typical_max: 5000, institutional_min: 25000 },
    L2: { typical_min: 50, typical_max: 3000, institutional_min: 20000 },
    Infrastructure: { typical_min: 200, typical_max: 8000, institutional_min: 40000 },
  };
  const exp = SECTOR_EXPECTATIONS[sector] || { typical_min: 50, typical_max: 5000, institutional_min: 20000 };

  let assessment, detail;
  if (size >= exp.institutional_min) {
    assessment = 'institutional';
    detail = `Avg trade $${size.toFixed(0)} indicates institutional/whale activity for ${sector} sector.`;
  } else if (size >= exp.typical_max) {
    assessment = 'large_retail';
    detail = `Avg trade $${size.toFixed(0)} is above typical ${sector} retail size — high-conviction retail or small institutional.`;
  } else if (size >= exp.typical_min) {
    assessment = 'organic_retail';
    detail = `Avg trade $${size.toFixed(0)} is within typical ${sector} retail range — organic activity pattern.`;
  } else {
    assessment = 'micro_retail';
    detail = `Avg trade $${size.toFixed(0)} is very small for ${sector} — may indicate bot activity or very early-stage retail.`;
  }

  return { assessment, detail, size, sector };
}
