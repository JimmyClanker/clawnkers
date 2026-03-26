/**
 * narrative-momentum.js — Round 26 (AutoResearch batch)
 * Measures the momentum of on-chain narratives and social sentiment vectors.
 * Returns a structured narrative health object for LLM context and frontend display.
 */

// Crypto narrative clusters — maps keywords to macro narratives
const NARRATIVE_CLUSTERS = {
  'real_yield': ['real yield', 'revenue sharing', 'revenue distribution', 'staking rewards', 'protocol revenue'],
  'ai_agents': ['ai agent', 'autonomous agent', 'agent protocol', 'onchain ai', 'machine learning', 'llm on chain'],
  'liquid_staking': ['liquid staking', 'liquid restaking', 'lst', 'lrt', 'staked eth', 'lsteth'],
  'defi_revival': ['defi summer', 'tvl growth', 'yield farming', 'liquidity mining', 'protocol adoption'],
  'layer2_scaling': ['layer 2', 'l2', 'rollup', 'zk proof', 'optimistic rollup', 'scaling solution'],
  'rwa': ['real world asset', 'rwa', 'tokenized asset', 'tokenized treasury', 'on-chain treasury'],
  'memecoins': ['meme', 'memecoin', 'dog coin', 'viral', 'pump'],
  'btc_ecosystem': ['bitcoin l2', 'ordinals', 'brc-20', 'runes', 'bitcoin defi'],
  'interoperability': ['cross-chain', 'interoperability', 'bridge', 'multichain', 'omnichain'],
  'institutional': ['institutional adoption', 'etf', 'treasury holding', 'corporate treasury', 'custody'],
};

/**
 * Detect which narratives are present in social data.
 *
 * @param {object} rawData - raw collector output
 * @returns {{
 *   active_narratives: string[],
 *   narrative_count: number,
 *   dominant_narrative: string|null,
 *   narrative_alignment: 'bullish'|'bearish'|'neutral',
 *   detail: string
 * }}
 */
// ── Round 1 (AutoResearch nightly): Merged extended narrative clusters ──────
const ALL_NARRATIVE_CLUSTERS = {
  ...NARRATIVE_CLUSTERS,
  'depin': ['depin', 'decentralized physical infrastructure', 'iot network', 'sensor network', 'hardware node'],
  'agentic_ai': ['agentic ai', 'ai agent', 'autonomous agent', 'mcp protocol', 'agent commerce', 'x402', 'machine economy'],
  'modular_blockchain': ['modular', 'data availability', 'da layer', 'eigen', 'restaking', 'avs'],
  'prediction_markets': ['prediction market', 'polymarket', 'futarchy', 'information market'],
  'zk_infra': ['zero knowledge', 'zk proof', 'zkvm', 'zkp', 'groth16', 'plonk', 'zk coprocessor'],
  'btc_fi': ['bitcoin fi', 'btcfi', 'wrapped btc', 'bitcoin yield', 'babylon', 'bitcoin staking'],
  // Round 236 (AutoResearch): new 2025 narrative clusters
  'tokenization_rwa': ['tokenized real estate', 'real estate token', 'private credit', 'tokenized bond', 'asset backed token', 'tokenized fund'],
  'hyperscaler_crypto': ['microsoft crypto', 'amazon blockchain', 'google web3', 'hyperscaler', 'cloud blockchain', 'enterprise blockchain'],
  'social_layer': ['decentralized social', 'farcaster', 'lens protocol', 'social graph', 'decentralized identity', 'soulbound', 'worldcoin'],
  'stablecoin_wars': ['new stablecoin', 'usdc competitor', 'native stablecoin', 'cbdc', 'digital dollar', 'paypal stablecoin'],
  'solana_ecosystem': ['solana ecosystem', 'solana defi', 'solana nft', 'sol season', 'pump fun', 'jupiter aggregator'],
  // Round 237 (AutoResearch nightly): 2026-specific emerging narratives
  'agent_commerce': ['agent commerce', 'x402', 'a2a', 'agent-to-agent', 'mcp payment', 'agentic economy', 'ai commerce protocol'],
  'bitcoin_mainstream': ['bitcoin strategic reserve', 'national bitcoin reserve', 'sovereign btc', 'senator bitcoin', 'state bitcoin bill'],
  'base_ecosystem': ['base ecosystem', 'coinbase layer2', 'base defi', 'base chain', 'base season'],
  'hyper_liquid': ['hyperliquid', 'hlp vault', 'hype token', 'perps dex', 'on-chain perps', 'decentralized derivatives'],
  'rwa_tokenization': ['tokenized treasury', 'blackrock onchain', 'franklin templeton', 'tokenized mmf', 'on-chain money market'],
};

export function detectNarrativeMomentum(rawData = {}) {
  const social = rawData.social ?? {};
  const narratives = Array.isArray(social.key_narratives) ? social.key_narratives : [];
  const recentNews = Array.isArray(social.recent_news) ? social.recent_news : [];

  // Build a corpus from key_narratives and recent news titles
  const corpus = [
    ...narratives,
    ...recentNews.map((n) => n?.title ?? ''),
  ].join(' ').toLowerCase();

  // Detect which macro narratives are present (extended cluster set)
  const activeNarratives = [];
  for (const [narrative, keywords] of Object.entries(ALL_NARRATIVE_CLUSTERS)) {
    const hit = keywords.some((kw) => corpus.includes(kw));
    if (hit) activeNarratives.push(narrative);
  }

  // Bullish narratives (extended)
  const bullishNarratives = new Set(['real_yield', 'ai_agents', 'agentic_ai', 'liquid_staking', 'rwa', 'institutional', 'layer2_scaling', 'zk_infra', 'depin', 'btc_fi', 'modular_blockchain']);
  const bearishNarratives = new Set(['memecoins']); // memes = volatile, not inherently bullish for fundamentals

  let bullScore = 0;
  let bearScore = 0;
  for (const n of activeNarratives) {
    if (bullishNarratives.has(n)) bullScore++;
    if (bearishNarratives.has(n)) bearScore++;
  }

  let narrativeAlignment = 'neutral';
  if (bullScore > bearScore && bullScore > 0) narrativeAlignment = 'bullish';
  else if (bearScore > bullScore && bearScore > 0) narrativeAlignment = 'bearish';

  const dominantNarrative = activeNarratives.length > 0 ? activeNarratives[0] : null;

  const detail = activeNarratives.length > 0
    ? `Active crypto narratives: ${activeNarratives.map((n) => n.replace(/_/g, ' ')).join(', ')}. Narrative alignment: ${narrativeAlignment}.`
    : 'No strong macro narrative detected in available data.';

  // Round 51 (AutoResearch): narrative_dominance_score — 0-100 how concentrated the narrative is
  // Low = scattered/unfocused; High = strong coherent story around the project
  // 1 narrative = 30, 2 = 50, 3 = 70, 4+ = 85, all bullish alignment = +15 bonus
  const narrativeDominanceBase = activeNarratives.length === 0 ? 0
    : activeNarratives.length === 1 ? 30
    : activeNarratives.length === 2 ? 50
    : activeNarratives.length === 3 ? 70
    : 85;
  const narrativeDominanceScore = Math.min(100, narrativeDominanceBase + (narrativeAlignment === 'bullish' ? 15 : 0));

  return {
    active_narratives: activeNarratives,
    narrative_count: activeNarratives.length,
    dominant_narrative: dominantNarrative,
    narrative_alignment: narrativeAlignment,
    narrative_dominance_score: narrativeDominanceScore,
    detail,
  };
}

