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
export function detectNarrativeMomentum(rawData = {}) {
  const social = rawData.social ?? {};
  const narratives = Array.isArray(social.key_narratives) ? social.key_narratives : [];
  const recentNews = Array.isArray(social.recent_news) ? social.recent_news : [];

  // Build a corpus from key_narratives and recent news titles
  const corpus = [
    ...narratives,
    ...recentNews.map((n) => n?.title ?? ''),
  ].join(' ').toLowerCase();

  // Detect which macro narratives are present
  const activeNarratives = [];
  for (const [narrative, keywords] of Object.entries(NARRATIVE_CLUSTERS)) {
    const hit = keywords.some((kw) => corpus.includes(kw));
    if (hit) activeNarratives.push(narrative);
  }

  // Bullish narratives
  const bullishNarratives = new Set(['real_yield', 'ai_agents', 'liquid_staking', 'rwa', 'institutional', 'layer2_scaling']);
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

  return {
    active_narratives: activeNarratives,
    narrative_count: activeNarratives.length,
    dominant_narrative: dominantNarrative,
    narrative_alignment: narrativeAlignment,
    detail,
  };
}
