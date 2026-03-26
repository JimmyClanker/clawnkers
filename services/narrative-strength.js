/**
 * narrative-strength.js — Round 234 (AutoResearch)
 * Computes a 0-100 narrative strength score based on how many
 * active macro narratives a project aligns with and their momentum.
 * Works without any LLM — purely algorithmic.
 */

const NARRATIVE_WEIGHTS = {
  ai_agents:          { weight: 15, label: 'AI Agents' },
  depin:              { weight: 12, label: 'DePIN' },
  rwa:                { weight: 12, label: 'Real World Assets' },
  restaking:          { weight: 10, label: 'Restaking' },
  layer2_expansion:   { weight: 10, label: 'Layer 2 Expansion' },
  defi_renaissance:   { weight: 9,  label: 'DeFi Renaissance' },
  chain_abstraction:  { weight: 8,  label: 'Chain Abstraction' },
  solana_ecosystem:   { weight: 8,  label: 'Solana Ecosystem' },
  meme_supercycle:    { weight: 6,  label: 'Meme Supercycle' },
  btc_ecosystem:      { weight: 7,  label: 'Bitcoin Ecosystem' },
  etf_inflows:        { weight: 5,  label: 'ETF/Institutional Inflows' },
  gaming_nft:         { weight: 4,  label: 'Gaming & NFT' },
};

/**
 * Compute narrative strength score.
 *
 * @param {object} narrativeMomentum - from narrative-momentum service
 * @param {object} onchain - onchain collector data
 * @param {object} market  - market collector data
 * @returns {{ score: number, active_narratives: string[], strength: 'strong'|'moderate'|'weak'|'none', detail: string }}
 */
export function computeNarrativeStrength(narrativeMomentum = {}, onchain = {}, market = {}) {
  const activeNarratives = Array.isArray(narrativeMomentum?.active_narratives)
    ? narrativeMomentum.active_narratives
    : [];

  let totalScore = 0;
  const matchedLabels = [];

  for (const narrative of activeNarratives) {
    const entry = NARRATIVE_WEIGHTS[narrative];
    if (entry) {
      totalScore += entry.weight;
      matchedLabels.push(entry.label);
    }
  }

  // Alignment bonus: if narrative_alignment is 'strong', amplify
  const alignment = narrativeMomentum?.narrative_alignment;
  if (alignment === 'strong' && totalScore > 0) totalScore = Math.min(100, totalScore * 1.3);
  else if (alignment === 'weak' && totalScore > 0) totalScore = totalScore * 0.7;

  const finalScore = Math.min(100, Math.round(totalScore));

  const strength = finalScore >= 60 ? 'strong'
    : finalScore >= 30 ? 'moderate'
    : finalScore >= 10 ? 'weak'
    : 'none';

  const detail = matchedLabels.length > 0
    ? `Aligned with ${matchedLabels.length} active macro narrative${matchedLabels.length > 1 ? 's' : ''}: ${matchedLabels.join(', ')}.`
    : 'No active macro narrative alignment detected.';

  return {
    score: finalScore,
    active_narratives: matchedLabels,
    strength,
    detail,
    alignment: alignment ?? 'none',
  };
}
