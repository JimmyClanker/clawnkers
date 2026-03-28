import { fetchJson } from './fetch.js';

const ETHERSCAN_API_URL = 'https://api.etherscan.io/api';

function createEmptyHoldersResult(projectName) {
  return {
    project_name: projectName,
    contract_address: null,
    top10_holder_concentration_pct: null,
    top_holders: [],
    error: null,
  };
}

/**
 * Collect top holder concentration for an ERC20 token via Etherscan.
 * Requires ETHERSCAN_API_KEY env var — skips gracefully if missing.
 *
 * @param {string} projectName
 * @param {string|null} contractAddress - ERC20 contract address (0x...)
 */
export async function collectHolders(projectName, contractAddress = null) {
  const fallback = createEmptyHoldersResult(projectName);

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return { ...fallback, error: 'ETHERSCAN_API_KEY not set — skipped' };
  }

  if (!contractAddress) {
    return { ...fallback, error: 'No contract address provided — skipped' };
  }

  // Basic address validation
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    return { ...fallback, error: `Invalid contract address: ${contractAddress}` };
  }

  try {
    // Fetch token holder list (top 10)
    const url = `${ETHERSCAN_API_URL}?module=token&action=tokenholderlist&contractaddress=${encodeURIComponent(contractAddress)}&page=1&offset=10&apikey=${encodeURIComponent(apiKey)}`;
    const data = await fetchJson(url, { timeoutMs: 12000 });

    if (data?.status !== '1' || !Array.isArray(data?.result)) {
      const msg = data?.message || data?.result || 'Etherscan error';
      // Round 105 (AutoResearch): clarify "no data" vs API error
      const isNoData = String(msg).toLowerCase().includes('no data') || String(msg).toLowerCase().includes('no record');
      const errorDetail = isNoData
        ? `No holder data available from Etherscan for ${contractAddress} — token may be on a different chain or not indexed`
        : String(msg);
      return { ...fallback, contract_address: contractAddress, error: errorDetail };
    }

    const holders = data.result;

    // Round 105 (AutoResearch): if holders array is empty, surface better context
    if (holders.length === 0) {
      return {
        ...fallback,
        contract_address: contractAddress,
        error: `Etherscan returned 0 holders for ${contractAddress} — token may be new, non-ERC20, or on a different chain`,
      };
    }

    // Total supply for concentration calculation
    let totalSupply = null;
    try {
      const supplyUrl = `${ETHERSCAN_API_URL}?module=stats&action=tokensupply&contractaddress=${encodeURIComponent(contractAddress)}&apikey=${encodeURIComponent(apiKey)}`;
      const supplyData = await fetchJson(supplyUrl, { timeoutMs: 8000 });
      if (supplyData?.status === '1') {
        totalSupply = BigInt(supplyData.result || '0');
      }
    } catch {
      totalSupply = null;
    }

    // Compute top 10 concentration
    let top10ConcentrationPct = null;
    const topHolders = holders.map((h) => ({
      address: h.TokenHolderAddress || h.address,
      balance: h.TokenHolderQuantity || h.balance || null,
    }));

    if (totalSupply != null && totalSupply > 0n) {
      let top10Sum = 0n;
      for (const h of holders) {
        try {
          top10Sum += BigInt(h.TokenHolderQuantity || h.balance || '0');
        } catch {
          // Skip unparseable values
        }
      }
      top10ConcentrationPct = Number((top10Sum * 10000n) / totalSupply) / 100;
    }

    return {
      ...fallback,
      contract_address: contractAddress,
      top10_holder_concentration_pct: top10ConcentrationPct,
      top_holders: topHolders,
      error: null,
    };
  } catch (error) {
    // Round 549 (AutoResearch): classify Etherscan errors for clearer diagnostics
    const isTimeout = error.name === 'AbortError' || error.message?.includes('timed out');
    const isRateLimit = error.message?.includes('429') || error.message?.includes('rate-limited');
    const isCooldown = error.message?.includes('cooldown');
    let errorMsg;
    if (isTimeout) errorMsg = `Etherscan timeout for "${contractAddress}"`;
    else if (isRateLimit) errorMsg = `Etherscan rate-limited — retry later`;
    else if (isCooldown) errorMsg = `Etherscan in cooldown — too many recent failures`;
    else errorMsg = error.message;
    return {
      ...fallback,
      contract_address: contractAddress,
      error: errorMsg,
    };
  }
}
