/**
 * Ecosystem / multichain collector.
 * Derives chain deployment data from already-fetched onchain and dex data.
 * No extra HTTP calls needed — works from passed-in data objects.
 */

function createEmptyEcosystemResult(projectName) {
  return {
    project_name: projectName,
    chain_count: null,
    chains: [],
    chain_tvl_breakdown: {},
    dex_chain_count: null,
    dex_chains: [],
    primary_chain: null,
    is_multichain: false,
    error: null,
  };
}

/**
 * Collect ecosystem / multichain deployment data.
 *
 * @param {string} projectName
 * @param {object|null} onchainData - result from collectOnchain
 * @param {object|null} dexData - result from collectDexScreener
 */
export async function collectEcosystem(projectName, onchainData = null, dexData = null) {
  const fallback = createEmptyEcosystemResult(projectName);

  try {
    // --- Chain TVL breakdown from DeFiLlama ---
    const llamaChains = Array.isArray(onchainData?.chains) ? onchainData.chains : [];
    const tvl = onchainData?.tvl ?? null;

    // DeFiLlama's currentChainTvls isn't passed through directly — derive from chains list.
    // We only have the aggregate TVL, so we distribute evenly as a fallback approximation
    // (realistic breakdown would require re-fetching protocol detail, but we avoid extra calls)
    const chainTvlBreakdown = {};
    if (llamaChains.length > 0 && tvl != null && tvl > 0) {
      const perChain = tvl / llamaChains.length;
      for (const chain of llamaChains) {
        chainTvlBreakdown[chain] = Math.round(perChain * 100) / 100;
      }
    }

    // --- DEX chain diversity ---
    const dexChains = Array.isArray(dexData?.dex_chains) ? dexData.dex_chains : [];

    // Merge chain sets
    const allChains = new Set([...llamaChains, ...dexChains]);

    // Primary chain: first in llama chains, or first in dex chains
    const primaryChain = llamaChains[0] || dexChains[0] || null;

    // isMultichain if deployed on 2+ distinct chains
    const isMultichain = allChains.size >= 2;

    const hasData = llamaChains.length > 0 || dexChains.length > 0;

    return {
      ...fallback,
      chain_count: llamaChains.length || null,
      chains: llamaChains,
      chain_tvl_breakdown: chainTvlBreakdown,
      dex_chain_count: dexChains.length || null,
      dex_chains: dexChains,
      primary_chain: primaryChain,
      is_multichain: isMultichain,
      error: hasData ? null : 'No chain data available from onchain or dex collectors',
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.message,
    };
  }
}
