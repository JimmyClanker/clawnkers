import { fetchJson } from './fetch.js';

const MESSARI_BASE = 'https://data.messari.io/api/v1/assets';

function emptyTokenomicsResult(projectName, coinGeckoId, marketData) {
  const circulatingSupply = marketData?.circulating_supply ?? null;
  const totalSupply = marketData?.total_supply ?? null;
  const maxSupply = marketData?.max_supply ?? null;
  const effectiveMaxSupply = maxSupply || totalSupply || null;
  const pctCirculating = (circulatingSupply != null && effectiveMaxSupply)
    ? (circulatingSupply / Number(effectiveMaxSupply)) * 100
    : null;

  // Unlock overhang: percentage of supply not yet circulating
  const unlockOverhangPct = pctCirculating != null ? Math.max(0, 100 - pctCirculating) : null;

  // Dilution risk tier: high >40% locked, medium 20-40%, low <20%
  let dilutionRisk = null;
  if (unlockOverhangPct != null) {
    if (unlockOverhangPct > 40) dilutionRisk = 'high';
    else if (unlockOverhangPct > 20) dilutionRisk = 'medium';
    else dilutionRisk = 'low';
  }

  return {
    project_name: projectName,
    coin_gecko_id: coinGeckoId || marketData?.coin_id || null,
    circulating_supply: circulatingSupply,
    total_supply: totalSupply,
    max_supply: maxSupply,
    pct_circulating: pctCirculating,
    unlock_overhang_pct: unlockOverhangPct,
    dilution_risk: dilutionRisk,
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

// Round 17: Extract vesting/launch date from Messari profile for unlock schedule estimate
function pluckVestingInfo(profileData) {
  const economics = profileData?.data?.profile?.economics;
  if (!economics) return null;

  const launchDate = economics?.consensus?.launch_date || economics?.launch_date || null;
  const vestingSchedule = economics?.token?.token_sale?.vesting_schedule || null;
  const teamAllocationPct = economics?.token?.token_allocation?.team_allocation_pct ||
    economics?.token?.sale_allocation?.team_pct || null;

  if (!launchDate && !vestingSchedule && !teamAllocationPct) return null;

  return {
    launch_date: launchDate,
    vesting_schedule_summary: vestingSchedule || null,
    team_allocation_pct: teamAllocationPct,
  };
}

/**
 * Round 53: Derive a simple inflation rate estimate from market data
 * when Messari doesn't have it — approximated from total supply / circulating supply growth.
 */
function estimateInflationFromMarket(marketData) {
  if (!marketData) return null;
  // If circulating supply is very close to max/total, inflation is low
  const circ = Number(marketData.circulating_supply ?? 0);
  const max  = Number(marketData.max_supply ?? marketData.total_supply ?? 0);
  if (circ <= 0 || max <= 0) return null;
  const pct = (circ / max) * 100;
  // Estimate: if 95%+ circulating, very low inflation; if <50%, potentially high
  if (pct >= 95) return 1.0;
  if (pct >= 80) return 5.0;
  if (pct >= 60) return 15.0;
  return 30.0; // rough estimate for early-stage with lots of supply locked
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

    const vestingInfo = pluckVestingInfo(profileData);

    const inflationFromMessari = pluckInflation(metricsData);
    // Round 53: fall back to market-based inflation estimate if Messari doesn't have it
    const inflationRate = inflationFromMessari ?? estimateInflationFromMarket(marketData);

    return {
      ...fallback,
      inflation_rate: inflationRate,
      inflation_source: inflationFromMessari != null ? 'messari' : (inflationRate != null ? 'estimated_from_supply' : null),
      token_distribution: pluckTokenDistribution(profileData),
      roi_data: metricsData?.data?.roi_data || metricsData?.data?.market_data?.roi_data || null,
      // Round 17: vesting info for unlock schedule context
      vesting_info: vestingInfo,
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
