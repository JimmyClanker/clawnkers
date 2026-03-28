/**
 * coinpaprika.js — Round 700 (AutoResearch batch)
 * Collects supplemental market data from CoinPaprika's free public API.
 * No API key required. Use as a fallback/supplement to CoinGecko.
 *
 * Key data points: developer stats, social stats, market overview,
 * exchange count, ICO info.
 */

import { fetchJson } from './fetch.js';

const BASE_URL = 'https://api.coinpaprika.com/v1';
const TIMEOUT_MS = 10000;

function createEmptyResult(projectName) {
  return {
    project_name: projectName,
    paprika_id: null,
    description: null,
    proof_type: null,
    open_source: null,
    hardware_wallet: null,
    platform: null,
    development_status: null,
    // Community stats (often different from CoinGecko)
    reddit_subscribers_paprika: null,
    twitter_followers_paprika: null,
    // Team info
    team_size: null,
    // Links
    source_code_url: null,
    website_url: null,
    // Market summary
    beta_value: null,
    rank: null,
    circulating_supply_paprika: null,
    total_supply_paprika: null,
    max_supply_paprika: null,
    error: null,
  };
}

/**
 * Normalize project name to CoinPaprika coin ID format.
 * CoinPaprika IDs are like 'btc-bitcoin', 'eth-ethereum', 'sol-solana'.
 */
async function resolveCoinId(projectName) {
  try {
    const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(projectName)}&c=currencies&limit=3`;
    const data = await fetchJson(searchUrl, { timeoutMs: TIMEOUT_MS });
    const currencies = data?.currencies;
    if (!Array.isArray(currencies) || currencies.length === 0) return null;
    // Best match: exact symbol or name match first, then first result
    const lower = projectName.toLowerCase();
    const exact = currencies.find(
      (c) => c.symbol?.toLowerCase() === lower || c.name?.toLowerCase() === lower
    );
    return (exact || currencies[0])?.id || null;
  } catch {
    return null;
  }
}

/**
 * Collect supplemental data from CoinPaprika.
 * @param {string} projectName
 * @returns {Promise<object>}
 */
export async function collectCoinpaprika(projectName) {
  const fallback = createEmptyResult(projectName);

  try {
    const coinId = await resolveCoinId(projectName);
    if (!coinId) {
      return { ...fallback, error: `No CoinPaprika coin found for "${projectName}"` };
    }

    const coinUrl = `${BASE_URL}/coins/${coinId}`;
    const data = await fetchJson(coinUrl, { timeoutMs: TIMEOUT_MS });

    if (!data || data.error) {
      return { ...fallback, error: data?.error || 'CoinPaprika coin fetch failed' };
    }

    // Team size extraction
    const teamSize = Array.isArray(data.team) ? data.team.length : null;

    // Website + source code links
    let websiteUrl = null;
    let sourceCodeUrl = null;
    if (Array.isArray(data.links)) {
      for (const link of data.links) {
        if (link.type === 'website' && !websiteUrl) websiteUrl = link.url;
        if (link.type === 'source_code' && !sourceCodeUrl) sourceCodeUrl = link.url;
      }
    }
    // Also check links_extended
    if (Array.isArray(data.links_extended)) {
      for (const link of data.links_extended) {
        if (link.type === 'website' && !websiteUrl) websiteUrl = link.url;
        if ((link.type === 'source_code' || link.type === 'github') && !sourceCodeUrl) sourceCodeUrl = link.url;
      }
    }

    return {
      ...fallback,
      paprika_id: coinId,
      description: typeof data.description === 'string' ? data.description.slice(0, 300) : null,
      proof_type: data.proof_type || null,
      open_source: data.open_source ?? null,
      hardware_wallet: data.hardware_wallet ?? null,
      platform: data.platform || null,
      development_status: data.development_status || null,
      team_size: teamSize,
      website_url: websiteUrl,
      source_code_url: sourceCodeUrl,
      rank: data.rank || null,
      circulating_supply_paprika: data.circulating_supply != null ? Number(data.circulating_supply) : null,
      total_supply_paprika: data.total_supply != null ? Number(data.total_supply) : null,
      max_supply_paprika: data.max_supply != null ? Number(data.max_supply) : null,
      beta_value: data.beta_value != null ? Number(data.beta_value) : null,
    };
  } catch (err) {
    return { ...fallback, error: err.message || 'CoinPaprika collection failed' };
  }
}
