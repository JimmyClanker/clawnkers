import { fetchJson } from './fetch.js';

const MESSARI_BASE = 'https://data.messari.io/api/v1/assets';

function emptyTokenomicsResult(projectName, coinGeckoId, marketData) {
  const circulatingSupply = marketData?.circulating_supply ?? null;
  const totalSupply = marketData?.total_supply ?? null;
  const maxSupply = marketData?.max_supply ?? null;

  return {
    project_name: projectName,
    coin_gecko_id: coinGeckoId || marketData?.coin_id || null,
    circulating_supply: circulatingSupply,
    total_supply: totalSupply,
    max_supply: maxSupply,
    pct_circulating:
      circulatingSupply != null && (maxSupply || totalSupply)
        ? (circulatingSupply / Number(maxSupply || totalSupply)) * 100
        : null,
    inflation_rate: null,
    token_distribution: null,
    roi_data: null,
    error: null,
  };
}

function buildMessariSlugCandidates(projectName, coinGeckoId, marketData = null) {
  const candidates = [
    coinGeckoId,
    projectName,
    marketData?.name,
    marketData?.symbol,
  ]
    .filter(Boolean)
    .flatMap((value) => {
      const source = String(value).toLowerCase();
      return [source, source.replace(/\s+/g, '-'), source.replace(/\s+/g, ''), source.replace(/[^a-z0-9-]/g, '')];
    });

  return [...new Set(candidates.filter(Boolean))];
}

async function fetchMessariEndpoint(slugs, endpoint) {
  for (const slug of slugs) {
    try {
      const data = await fetchJson(`${MESSARI_BASE}/${encodeURIComponent(slug)}/${endpoint}`);
      return { slug, data };
    } catch {
      // try next candidate
    }
  }

  return null;
}

function pluckTokenDistribution(profileData) {
  return (
    profileData?.data?.profile?.economics?.token?.token_usage ||
    profileData?.data?.profile?.economics?.token?.token_details ||
    profileData?.data?.profile?.economics?.token?.sale_allocation ||
    null
  );
}

function pluckInflation(metricsData) {
  return (
    metricsData?.data?.supply?.annual_inflation_percent ||
    metricsData?.data?.supply?.y_2050_issued_percent ||
    metricsData?.data?.roi_data?.percent_change_last_1_year ||
    null
  );
}

export async function collectTokenomics(projectName, coinGeckoId, marketData = null) {
  const fallback = emptyTokenomicsResult(projectName, coinGeckoId, marketData);

  try {
    const slugs = buildMessariSlugCandidates(projectName, coinGeckoId, marketData);
    const [profileResult, metricsResult] = await Promise.allSettled([
      fetchMessariEndpoint(slugs, 'profile'),
      fetchMessariEndpoint(slugs, 'metrics'),
    ]);

    const profileData = profileResult.status === 'fulfilled' ? profileResult.value?.data : null;
    const metricsData = metricsResult.status === 'fulfilled' ? metricsResult.value?.data : null;

    return {
      ...fallback,
      inflation_rate: pluckInflation(metricsData),
      token_distribution: pluckTokenDistribution(profileData),
      roi_data: metricsData?.data?.roi_data || metricsData?.data?.market_data?.roi_data || null,
      error:
        !profileData && !metricsData
          ? 'Messari tokenomics unavailable'
          : null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'Messari timeout' : error.message,
    };
  }
}
