import { fetchJson } from './fetch.js';

const MESSARI_BASE = 'https://data.messari.io/api/v1/assets';

function emptyTokenomicsResult(projectName, coinGeckoId, marketData) {
  const circulatingSupply = marketData?.circulating_supply ?? null;
  const totalSupply = marketData?.total_supply ?? null;
  const maxSupply = marketData?.max_supply ?? null;
  const effectiveMaxSupply = maxSupply || totalSupply || null;
  // Round 184 (AutoResearch): clamp to [0, 100] and guard NaN/Infinity
  const rawPctCirculating = (circulatingSupply != null && effectiveMaxSupply && Number(effectiveMaxSupply) > 0)
    ? (circulatingSupply / Number(effectiveMaxSupply)) * 100
    : null;
  const pctCirculating = (rawPctCirculating != null && Number.isFinite(rawPctCirculating))
    ? Math.max(0, Math.min(100, rawPctCirculating))
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
// Round 108 (AutoResearch): better fallback when Messari doesn't have launch_date
function pluckVestingInfo(profileData, marketData = null) {
  const economics = profileData?.data?.profile?.economics;
  
  const launchDate = economics?.consensus?.launch_date || economics?.launch_date || null;
  const vestingSchedule = economics?.token?.token_sale?.vesting_schedule || null;
  const teamAllocationPct = economics?.token?.token_allocation?.team_allocation_pct ||
    economics?.token?.sale_allocation?.team_pct || null;

  // Round 108 (AutoResearch): fallback launch date to CoinGecko genesis_date when Messari lacks data
  const effectiveLaunchDate = launchDate || marketData?.genesis_date || null;

  if (!effectiveLaunchDate && !vestingSchedule && !teamAllocationPct) return null;

  return {
    launch_date: effectiveLaunchDate,
    launch_date_source: launchDate ? 'messari' : (effectiveLaunchDate ? 'coingecko_genesis' : null),
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

  // FIX (28 Mar 2026): Previous estimates were wildly inaccurate (e.g. 30% for HYPE).
  // Low circulating % does NOT mean high inflation — it means tokens are locked/vesting.
  // Inflation = rate at which NEW tokens enter circulation, not total locked supply.
  // Most well-designed protocols unlock 5-15% of total supply per year via vesting.
  // Conservative estimates based on typical unlock schedules:
  if (pct >= 95) return 1.0;   // Nearly fully circulating
  if (pct >= 80) return 3.0;   // Most supply already out
  if (pct >= 60) return 6.0;   // Moderate remaining unlocks
  if (pct >= 40) return 10.0;  // Significant supply still locked, typical vesting
  return 12.0;                  // Early stage — but 30% was absurd, most unlock 8-15%/yr
}

export async function collectTokenomics(projectName, coinGeckoId, marketData = null) {
  const fallback = emptyTokenomicsResult(projectName, coinGeckoId, marketData);

  try {
    const slugs = buildMessariSlugCandidates(projectName, coinGeckoId, marketData);
    // Round 538 (AutoResearch): use a per-endpoint timeout to prevent one slow endpoint
    // from blocking the other. Both fetches happen in parallel; each has a 10s timeout.
    const withEndpointTimeout = (promise, label) => Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Messari ${label} endpoint timeout`)), 10000)
      ),
    ]);
    const [profileResult, metricsResult] = await Promise.allSettled([
      withEndpointTimeout(fetchMessariEndpoint(slugs, 'profile'), 'profile'),
      withEndpointTimeout(fetchMessariEndpoint(slugs, 'metrics'), 'metrics'),
    ]);

    const profileData = profileResult.status === 'fulfilled' ? profileResult.value?.data : null;
    const metricsData = metricsResult.status === 'fulfilled' ? metricsResult.value?.data : null;

    const vestingInfo = pluckVestingInfo(profileData, marketData);

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
      // Round 208 (AutoResearch): unlock_risk_label — combines overhang + team allocation for quick assessment
      unlock_risk_label: (() => {
        const overhang = fallback.unlock_overhang_pct;
        const teamAlloc = vestingInfo?.team_allocation_pct != null ? Number(vestingInfo.team_allocation_pct) : null;
        // Critical if team > 40% OR overhang > 60%
        if ((teamAlloc != null && teamAlloc > 40) || (overhang != null && overhang > 60)) return 'critical';
        // High if team > 25% OR overhang > 40%
        if ((teamAlloc != null && teamAlloc > 25) || (overhang != null && overhang > 40)) return 'high';
        // Moderate if overhang > 20%
        if (overhang != null && overhang > 20) return 'moderate';
        if (overhang != null) return 'low';
        return null;
      })(),
      // Round 193 (AutoResearch): include which slugs were tried so debugging is easier
      // Round 539 (AutoResearch): distinguish timeout vs not-found vs unexpected for clearer diagnostics
      error: (() => {
        if (profileData || metricsData) return null;
        const triedSlugs = slugs.slice(0, 4).join(', ');
        const profileErr = profileResult.status === 'rejected' ? profileResult.reason?.message : null;
        const metricsErr = metricsResult.status === 'rejected' ? metricsResult.reason?.message : null;
        const anyTimeout = [profileErr, metricsErr].some(e => e?.includes('timeout'));
        if (anyTimeout) return `Messari timeout — data unavailable for "${projectName}"`;
        return `Messari tokenomics unavailable (tried: ${triedSlugs}${slugs.length > 4 ? '…' : ''})`;
      })(),
    };
  } catch (error) {
    const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
    return {
      ...fallback,
      error: isTimeout ? `Messari timeout — data unavailable for "${projectName}"` : error.message,
    };
  }
}
