import { fetchJson } from './fetch.js';

const ETHERSCAN_API_URL = 'https://api.etherscan.io/api';

function createEmptyContractResult(projectName) {
  return {
    project_name: projectName,
    is_verified: null,
    contract_address: null,
    platform: null,
    error: null,
  };
}

/**
 * Attempt to resolve a contract address from CoinGecko platform data.
 * Returns { address, platform } for the first EVM platform found.
 *
 * @param {Record<string, string>|null} platforms - coinData.platforms from CoinGecko
 */
function resolveContractAddress(platforms) {
  if (!platforms || typeof platforms !== 'object') return null;

  // Prefer Ethereum mainnet, then popular EVM chains
  const preferredOrder = ['ethereum', 'base', 'arbitrum-one', 'optimistic-ethereum', 'polygon-pos', 'binance-smart-chain'];
  for (const chain of preferredOrder) {
    if (platforms[chain] && /^0x[0-9a-fA-F]{40}$/.test(platforms[chain])) {
      return { address: platforms[chain], platform: chain };
    }
  }

  // Fallback: first EVM address found
  for (const [platform, address] of Object.entries(platforms)) {
    if (address && /^0x[0-9a-fA-F]{40}$/.test(address)) {
      return { address, platform };
    }
  }

  return null;
}

/**
 * Check if a smart contract is verified on Etherscan.
 * Requires ETHERSCAN_API_KEY env var — if missing, skips gracefully.
 *
 * @param {string} projectName
 * @param {Record<string, string>|null} platforms - CoinGecko platforms data (optional)
 * @param {string|null} contractAddress - override contract address
 */
export async function collectContractStatus(projectName, platforms = null, contractAddress = null) {
  const fallback = createEmptyContractResult(projectName);

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return { ...fallback, error: 'ETHERSCAN_API_KEY not set — skipped' };
  }

  // Resolve address: use explicit param first, then derive from platforms
  let resolvedAddress = contractAddress || null;
  let resolvedPlatform = null;

  if (!resolvedAddress && platforms) {
    const resolved = resolveContractAddress(platforms);
    if (resolved) {
      resolvedAddress = resolved.address;
      resolvedPlatform = resolved.platform;
    }
  }

  if (!resolvedAddress) {
    return { ...fallback, error: 'No contract address available — skipped' };
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(resolvedAddress)) {
    return { ...fallback, error: `Invalid contract address: ${resolvedAddress}` };
  }

  try {
    const url = `${ETHERSCAN_API_URL}?module=contract&action=getabi&address=${encodeURIComponent(resolvedAddress)}&apikey=${encodeURIComponent(apiKey)}`;
    const data = await fetchJson(url, { timeoutMs: 10000 });

    // Etherscan returns status "1" with ABI string if verified,
    // or status "0" with message "Contract source code not verified" if not
    const isVerified = data?.status === '1' && typeof data?.result === 'string' && data.result.length > 2;

    return {
      ...fallback,
      is_verified: isVerified,
      contract_address: resolvedAddress,
      platform: resolvedPlatform || 'ethereum',
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      contract_address: resolvedAddress,
      platform: resolvedPlatform,
      error: error.name === 'AbortError' ? 'Etherscan timeout' : error.message,
    };
  }
}
