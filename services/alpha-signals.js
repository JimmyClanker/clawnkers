/**
 * alpha-signals.js — Round 15
 * Detects positive alpha signals from raw scanner data and scores.
 */

function safeN(v, fb = 0) {
  return Number.isFinite(Number(v)) ? Number(v) : fb;
}

/**
 * Detect alpha signals in a project scan.
 * @param {object} rawData - raw collector data
 * @param {object} scores  - calculateScores() result
 * @returns {Array<{signal: string, strength: 'strong'|'moderate'|'weak', detail: string}>}
 */
export function detectAlphaSignals(rawData = {}, scores = {}) {
  const signals = [];
  const market     = rawData.market     ?? {};
  const onchain    = rawData.onchain    ?? {};
  const social     = rawData.social     ?? {};
  const github     = rawData.github     ?? {};
  const dex        = rawData.dex        ?? rawData.dexData ?? {};
  const sector     = rawData.sector     ?? rawData.sector_comparison ?? {};

  // 1. Volume spike without price move
  const mcap   = safeN(market.market_cap);
  const volume = safeN(market.total_volume);
  const change24h = safeN(market.price_change_pct_24h);
  if (mcap > 0 && volume > 0) {
    const volRatio = volume / mcap;
    if (volRatio > 0.3 && Math.abs(change24h) < 5) {
      signals.push({
        signal: 'volume_spike_no_price_move',
        strength: volRatio > 0.6 ? 'strong' : 'moderate',
        detail: `Vol/MCap ratio ${volRatio.toFixed(2)} (>${0.3}) with only ${change24h.toFixed(1)}% 24h price move — potential accumulation.`,
      });
    }
  }

  // 2. Recent release detection — new release within 30 days = active shipping
  const latestRelease = github.latest_release;
  if (latestRelease && latestRelease.days_since_release != null && latestRelease.days_since_release <= 30) {
    signals.push({
      signal: 'recent_release',
      strength: latestRelease.days_since_release <= 7 ? 'strong' : 'moderate',
      detail: `New release "${latestRelease.tag}" published ${latestRelease.days_since_release}d ago${latestRelease.prerelease ? ' (pre-release)' : ''} — team is actively shipping.`,
    });
  }

  // 2b. Dev acceleration
  const commitTrend = github.commit_trend;
  if (commitTrend === 'accelerating') {
    const commits30d = safeN(github.commits_30d);
    const commits30dPrev = safeN(github.commits_30d_prev);
    const accelPct = commits30dPrev > 0
      ? ((commits30d - commits30dPrev) / commits30dPrev) * 100
      : 0;
    signals.push({
      signal: 'dev_acceleration',
      strength: accelPct > 50 ? 'strong' : 'moderate',
      detail: `Commit trend is accelerating — commits_30d: ${commits30d} vs prev_30d: ${commits30dPrev} (+${accelPct.toFixed(0)}%).`,
    });
  }

  // 3. New exchange listings (exchange_count > 5)
  const exchangeCount = safeN(market.exchange_count ?? dex.exchange_count);
  if (exchangeCount > 5) {
    signals.push({
      signal: 'multi_exchange_listing',
      strength: exchangeCount > 15 ? 'strong' : exchangeCount > 8 ? 'moderate' : 'weak',
      detail: `Listed on ${exchangeCount} exchanges — broad distribution reduces single-venue liquidity risk.`,
    });
  }

  // 4. TVL growth > 20% in 7d
  const tvlChange7d = safeN(onchain.tvl_change_7d);
  if (tvlChange7d > 20) {
    signals.push({
      signal: 'tvl_growth_spike',
      strength: tvlChange7d > 50 ? 'strong' : tvlChange7d > 30 ? 'moderate' : 'weak',
      detail: `TVL grew ${tvlChange7d.toFixed(1)}% in 7d — strong capital inflow into the protocol.`,
    });
  }

  // 5. High sentiment score with significant mentions
  const sentimentScore = safeN(social.sentiment_score, NaN);
  const mentions = safeN(social.filtered_mentions ?? social.mentions);
  if (Number.isFinite(sentimentScore) && sentimentScore > 0.5 && mentions >= 5) {
    signals.push({
      signal: 'strong_positive_sentiment',
      strength: sentimentScore > 0.75 ? 'strong' : 'moderate',
      detail: `Sentiment score ${sentimentScore.toFixed(2)} with ${mentions} (filtered) mentions — strong community conviction.`,
    });
  }

  // 6. Improving sector position
  const sectorRank = safeN(sector.rank ?? sector.sector_rank, NaN);
  const sectorPrevRank = safeN(sector.prev_rank ?? sector.sector_prev_rank, NaN);
  if (Number.isFinite(sectorRank) && Number.isFinite(sectorPrevRank) && sectorRank < sectorPrevRank) {
    const improvement = sectorPrevRank - sectorRank;
    signals.push({
      signal: 'improving_sector_position',
      strength: improvement > 10 ? 'strong' : improvement > 3 ? 'moderate' : 'weak',
      detail: `Sector rank improved from #${sectorPrevRank} to #${sectorRank} (+${improvement} positions).`,
    });
  }

  // 7. Round 4: CoinGecko trending — rare attention signal
  if (market.is_trending === true) {
    signals.push({
      signal: 'coingecko_trending',
      strength: 'strong',
      detail: `Project is in CoinGecko trending list — elevated retail attention and discovery traffic.`,
    });
  }

  // 8. Round 4: Near ATH breakout (within 10% of ATH)
  const athDistancePct = safeN(market.ath_distance_pct, NaN);
  if (Number.isFinite(athDistancePct) && athDistancePct >= -10 && athDistancePct < 0) {
    signals.push({
      signal: 'near_ath_breakout',
      strength: athDistancePct >= -5 ? 'strong' : 'moderate',
      detail: `Price is only ${Math.abs(athDistancePct).toFixed(1)}% below ATH — potential breakout setup.`,
    });
  }

  // 9. Round 4: High DEX liquidity with growing DEX pair count (expansion)
  const dexPairCount = safeN(dex.dex_pair_count ?? 0);
  const dexLiquidity = safeN(dex.dex_liquidity_usd ?? 0);
  if (dexPairCount >= 5 && dexLiquidity >= 500_000) {
    signals.push({
      signal: 'strong_dex_presence',
      strength: dexPairCount >= 15 ? 'strong' : dexPairCount >= 8 ? 'moderate' : 'weak',
      detail: `${dexPairCount} DEX pairs with $${(dexLiquidity / 1_000_000).toFixed(2)}M total liquidity — robust on-chain market making.`,
    });
  }

  // 10. Round 3: DEX buy pressure signal
  if (dex.pressure_signal === 'buy_pressure' && dex.buy_sell_ratio != null) {
    signals.push({
      signal: 'dex_buy_pressure',
      strength: dex.buy_sell_ratio >= 1.3 ? 'strong' : 'moderate',
      detail: `DEX buy/sell txn ratio is ${dex.buy_sell_ratio} (${dex.buys_24h} buys vs ${dex.sells_24h} sells in 24h) — net buy pressure on-chain.`,
    });
  }

  // 11. Round 3: revenue-positive signal — protocol generating meaningful fees
  const revEfficiency = safeN(onchain.revenue_efficiency ?? 0);
  const fees7d = safeN(onchain.fees_7d ?? 0);
  if (fees7d > 100_000 && revEfficiency > 50) {
    signals.push({
      signal: 'revenue_generating',
      strength: fees7d > 1_000_000 ? 'strong' : 'moderate',
      detail: `Protocol generated $${(fees7d / 1000).toFixed(0)}K fees in 7d with revenue efficiency of $${revEfficiency.toFixed(0)}/M TVL/wk.`,
    });
  }

  // 12. Round 42: Institutional interest from social mentions
  const institutionalMentions = safeN(social.institutional_mentions ?? 0);
  if (institutionalMentions >= 3) {
    signals.push({
      signal: 'institutional_interest',
      strength: institutionalMentions >= 6 ? 'strong' : 'moderate',
      detail: `${institutionalMentions} recent news items mention institutional interest, whale activity, or fund investments — smart money attention.`,
    });
  }

  // 12. Round 31: Low P/TVL signal — price-to-TVL ratio below 1x = potentially undervalued
  const ptvlData = rawData.sector_comparison?.price_to_tvl;
  if (ptvlData && ptvlData.context === 'potentially-undervalued' && ptvlData.ratio != null && ptvlData.ratio < 1) {
    signals.push({
      signal: 'low_price_to_tvl',
      strength: ptvlData.ratio < 0.5 ? 'strong' : 'moderate',
      detail: `P/TVL ratio ${ptvlData.ratio.toFixed(2)}x vs sector median ${ptvlData.sector_median?.toFixed(2) ?? 'n/a'}x — potentially undervalued relative to locked capital.`,
    });
  }

  // 13. Round 31: High treasury balance signal — runway indicator
  const treasuryBalance = safeN(onchain.treasury_balance ?? 0);
  const marketCap = safeN(market.market_cap ?? 0);
  if (treasuryBalance > 1_000_000 && marketCap > 0) {
    const treasuryPctMcap = (treasuryBalance / marketCap) * 100;
    if (treasuryPctMcap > 10) {
      signals.push({
        signal: 'strong_treasury',
        strength: treasuryPctMcap > 30 ? 'strong' : 'moderate',
        detail: `Protocol treasury of $${(treasuryBalance / 1_000_000).toFixed(1)}M is ${treasuryPctMcap.toFixed(0)}% of market cap — strong operational runway.`,
      });
    }
  }

  // 14. Round 31: Multi-chain expansion — protocol on 5+ chains signals ecosystem traction
  const chainCount = Array.isArray(onchain.chains) ? onchain.chains.length : 0;
  if (chainCount >= 5 && !signals.some((s) => s.signal === 'strong_dex_presence')) {
    signals.push({
      signal: 'multichain_expansion',
      strength: chainCount >= 10 ? 'strong' : 'moderate',
      detail: `Protocol deployed on ${chainCount} chains — broad multichain coverage reduces single-chain risk and expands addressable liquidity.`,
    });
  }

  // 15. Round 55: Governance activity — active on-chain governance = community engagement
  const governanceProposals = safeN(onchain.governance_proposals_30d ?? 0);
  const governanceParticipation = safeN(onchain.governance_participation_pct ?? 0);
  if (governanceProposals >= 3 || governanceParticipation >= 10) {
    signals.push({
      signal: 'active_governance',
      strength: governanceProposals >= 10 ? 'strong' : 'moderate',
      detail: `${governanceProposals} governance proposals in 30 days${governanceParticipation > 0 ? ` with ${governanceParticipation.toFixed(0)}% token holder participation` : ''} — active decentralized governance.`,
    });
  }

  // 16. Round 55: Partnership or integration news from social
  const partnershipMentions = safeN(social.partnership_mentions ?? 0);
  if (partnershipMentions >= 2) {
    signals.push({
      signal: 'partnership_news',
      strength: partnershipMentions >= 5 ? 'strong' : 'moderate',
      detail: `${partnershipMentions} recent mentions of partnerships or protocol integrations — expanding ecosystem presence.`,
    });
  }

  // 17. Round 55: ATL recovery with momentum — price recovering strongly from bottom
  const atlDist = safeN(market.atl_distance_pct, NaN);
  const c7d = safeN(market.price_change_pct_7d, NaN);
  if (Number.isFinite(atlDist) && Number.isFinite(c7d) && atlDist > 20 && atlDist < 100 && c7d > 15) {
    signals.push({
      signal: 'atl_recovery_momentum',
      strength: c7d > 40 ? 'strong' : 'moderate',
      detail: `Price is ${atlDist.toFixed(1)}% above ATL and rising +${c7d.toFixed(1)}% this week — recovery momentum building.`,
    });
  }

  // 18. Round 68: High fees/TVL efficiency — extremely capital-efficient protocol
  const tvlForEfficiency = safeN(onchain.tvl ?? 0);
  const fees7dForEfficiency = safeN(onchain.fees_7d ?? 0);
  if (tvlForEfficiency > 1_000_000 && fees7dForEfficiency > 0) {
    const feesPerMTvl = (fees7dForEfficiency / (tvlForEfficiency / 1_000_000));
    if (feesPerMTvl > 10_000) { // $10K+ fees per $1M TVL per week
      signals.push({
        signal: 'high_fee_efficiency',
        strength: feesPerMTvl > 50_000 ? 'strong' : 'moderate',
        detail: `Protocol generates $${(fees7dForEfficiency / 1000).toFixed(0)}K fees/week on $${(tvl / 1_000_000).toFixed(1)}M TVL — capital efficiency of $${feesPerMTvl.toFixed(0)}/M TVL/week.`,
      });
    }
  }

  // Deduplicate signals by signal key (keep first occurrence)
  const seen = new Set();
  return signals.filter((s) => {
    if (seen.has(s.signal)) return false;
    seen.add(s.signal);
    return true;
  });
}
