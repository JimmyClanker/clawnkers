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
        detail: `Protocol generates $${(fees7dForEfficiency / 1000).toFixed(0)}K fees/week on $${(tvlForEfficiency / 1_000_000).toFixed(1)}M TVL — capital efficiency of $${feesPerMTvl.toFixed(0)}/M TVL/week.`,
      });
    }
  }

  // 19. Round 2 (AutoResearch batch): Trending on CoinGecko
  if (market.is_trending === true) {
    const topRank = safeN(market.market_cap_rank, 0);
    signals.push({
      signal: 'coingecko_trending',
      strength: topRank > 0 && topRank <= 50 ? 'strong' : 'moderate',
      detail: `${market.name ?? projectName} is currently trending on CoinGecko — elevated discovery and retail interest.`,
    });
  }

  // 20. Round 3 (AutoResearch batch): Strong longer-term trend (200d positive)
  const c200d = safeN(market.price_change_pct_200d, NaN);
  const c1y   = safeN(market.price_change_pct_1y, NaN);
  if (Number.isFinite(c200d) && c200d > 50 && Number.isFinite(c1y) && c1y > 50) {
    signals.push({
      signal: 'strong_long_term_trend',
      strength: c200d > 200 ? 'strong' : 'moderate',
      detail: `+${c200d.toFixed(0)}% over 200 days and +${c1y.toFixed(0)}% over 1 year — sustained long-term uptrend, not just a short-term spike.`,
    });
  }

  // 21. Round 4 (AutoResearch batch): High CEX volume share — institutional distribution
  const cexVolumePct = safeN(market.cex_volume_pct, NaN);
  if (Number.isFinite(cexVolumePct) && cexVolumePct >= 75 && safeN(market.total_volume) > 500_000) {
    signals.push({
      signal: 'high_cex_volume_share',
      strength: cexVolumePct >= 90 ? 'strong' : 'moderate',
      detail: `${cexVolumePct.toFixed(0)}% of trading volume flows through CEXs — strong institutional and retail accessibility.`,
    });
  }

  // ── Price-based alpha signals (migrated from price-alerts.js) ──

  const c1hPrice = safeN(market.price_change_pct_1h, NaN);
  const c30dPrice = safeN(market.price_change_pct_30d, NaN);
  const athPrice = safeN(market.ath, NaN);

  // 22. Flash pump: 1h > +15% (caution: potential FOMO trap)
  if (Number.isFinite(c1hPrice) && c1hPrice >= 15) {
    signals.push({
      signal: 'flash_pump',
      strength: c1hPrice >= 30 ? 'strong' : 'moderate',
      detail: `Flash pump detected: +${c1hPrice.toFixed(1)}% in 1h. Potential FOMO trap — wait for consolidation before entering.`,
    });
  }

  // 23. ATH breakout: price at or above ATH (enhance existing near_ath_breakout signal)
  // Note: near_ath_breakout already exists (signal #8), so we only add breakout if ATH distance >= 0
  if (Number.isFinite(athDistancePct) && athDistancePct >= 0 && Number.isFinite(athPrice)) {
    signals.push({
      signal: 'ath_breakout',
      strength: 'strong',
      detail: `Price is at/above ATH ($${athPrice.toFixed(4)}) — confirmed breakout into price discovery territory.`,
    });
  }

  // 24. Recovery from prolonged downtrend: 7d positive after 30d negative
  // Note: c7d already declared at line 225
  if (Number.isFinite(c7d) && Number.isFinite(c30dPrice) && c7d >= 10 && c30dPrice <= -20) {
    signals.push({
      signal: 'recovery_from_low',
      strength: 'moderate',
      detail: `Recovery signal: +${c7d.toFixed(1)}% this week despite ${c30dPrice.toFixed(1)}% monthly drawdown — potential trend reversal forming.`,
    });
  }

  // 25. Volume surge: volume > 50% of market cap
  const volRatio = volume > 0 && mcap > 0 ? volume / mcap : 0;
  if (volRatio >= 0.5) {
    signals.push({
      signal: 'volume_surge',
      strength: volRatio >= 1.0 ? 'strong' : 'moderate',
      detail: `Extraordinary volume: $${(volume / 1e6).toFixed(1)}M (${(volRatio * 100).toFixed(0)}% of market cap in 24h) — unusually high trading interest.`,
    });
  }

  // Round 26 (AutoResearch nightly): Price-volume divergence from momentum service
  const pvDiv = rawData?.momentum?.price_vol_divergence ?? null;
  if (pvDiv === 'bullish_accumulation') {
    signals.push({
      signal: 'price_volume_divergence_bullish',
      strength: 'strong',
      detail: 'High trading volume with flat/minimal price movement — classic silent accumulation pattern, potential pre-breakout signal.',
    });
  } else if (pvDiv === 'bearish_low_vol_rally') {
    // Note: this is a warning, not a signal — handled in red-flags; skip here
  }

  // Round 13 (AutoResearch nightly): News momentum signal — accelerating news coverage
  const newsMomentum = social.news_momentum;
  const veryRecentCount = safeN(social.very_recent_news_count ?? 0);
  if (newsMomentum === 'accelerating' && veryRecentCount >= 3) {
    signals.push({
      signal: 'accelerating_news_coverage',
      strength: veryRecentCount >= 5 ? 'strong' : 'moderate',
      detail: `${veryRecentCount} news items in the last 3 days vs overall window — coverage is accelerating, suggesting a fresh catalyst or rising narrative interest.`,
    });
  }

  // Round 8 (AutoResearch nightly): Revenue-to-fees ratio above 30% = strong value capture
  const revenueToFees = safeN(rawData?.onchain?.revenue_to_fees_ratio ?? null, NaN);
  if (Number.isFinite(revenueToFees) && revenueToFees >= 0.30) {
    signals.push({
      signal: 'strong_revenue_capture',
      strength: revenueToFees >= 0.50 ? 'strong' : 'moderate',
      detail: `Protocol captures ${(revenueToFees * 100).toFixed(0)}% of fees as revenue — strong value accrual to token holders.`,
    });
  }

  // Round 8 (AutoResearch nightly): Liquidity health score above 70 = well-distributed DEX presence
  const liqHealth = safeN(rawData?.dex?.liquidity_health_score ?? null, NaN);
  if (Number.isFinite(liqHealth) && liqHealth >= 70) {
    signals.push({
      signal: 'strong_dex_liquidity_health',
      strength: liqHealth >= 85 ? 'strong' : 'moderate',
      detail: `DEX liquidity health score is ${liqHealth}/100 — deep, diversified liquidity across multiple venues.`,
    });
  }

  // Round 49 (AutoResearch): Short interest proxy signal — extreme sell pressure + high FDV overhang
  // These conditions suggest informed sellers (team, VCs) may be distributing
  const shortFdv = safeN(market.fully_diluted_valuation ?? 0);
  const shortMcap = safeN(market.market_cap ?? 0);
  const shortFdvRatio = shortMcap > 0 && shortFdv > 0 ? shortFdv / shortMcap : null;
  const shortBuySellRatio = safeN(dex.buy_sell_ratio ?? 0);
  if (shortFdvRatio !== null && shortFdvRatio > 5 && shortBuySellRatio > 0 && shortBuySellRatio < 0.6) {
    signals.push({
      signal: 'short_interest_proxy',
      strength: shortFdvRatio > 10 && shortBuySellRatio < 0.4 ? 'strong' : 'moderate',
      detail: `FDV/MCap ${shortFdvRatio.toFixed(1)}x combined with DEX sell pressure (ratio ${shortBuySellRatio}) suggests potential insider/VC distribution — high unlock overhang with active selling.`,
    });
  }

  // Round 45 (AutoResearch): Social divergence signal — X/Twitter vs Exa/Reddit sentiment divergence
  // When KOLs are bullish but web mentions are bearish (or vice versa), it's a contrarian signal
  const xSocial = rawData.x_social ?? {};
  if (!xSocial.error && xSocial.sentiment_score != null) {
    const exaSentScore = typeof social?.sentiment_score === 'number' ? social.sentiment_score : null;
    if (exaSentScore !== null) {
      const xScore = xSocial.sentiment_score; // -1 to +1
      const divergence = xScore - exaSentScore;
      // Significant divergence: X is much more bullish than web mentions
      if (divergence > 0.5 && xScore > 0.3) {
        signals.push({
          signal: 'x_vs_web_bullish_divergence',
          strength: divergence > 0.8 ? 'strong' : 'moderate',
          detail: `X/Twitter KOLs (${xScore.toFixed(2)}) are significantly more bullish than web/news sentiment (${exaSentScore.toFixed(2)}) — KOLs may be front-running a narrative shift.`,
        });
      // X is much more bearish than web mentions
      } else if (divergence < -0.5 && xScore < -0.3) {
        signals.push({
          signal: 'x_vs_web_bearish_divergence',
          strength: divergence < -0.8 ? 'strong' : 'moderate',
          detail: `X/Twitter KOLs (${xScore.toFixed(2)}) are significantly more bearish than web/news sentiment (${exaSentScore.toFixed(2)}) — possible early warning from informed traders.`,
        });
      }
    }
  }

  // Round 32 (AutoResearch): X/Twitter KOL bullish signal — notable accounts discussing bullishly
  if (!xSocial.error && xSocial.kol_sentiment === 'bullish') {
    const notableCount = Array.isArray(xSocial.notable_accounts) ? xSocial.notable_accounts.length : 0;
    if (notableCount >= 2 || xSocial.mention_volume === 'high') {
      signals.push({
        signal: 'kol_bullish_x_sentiment',
        strength: notableCount >= 3 ? 'strong' : 'moderate',
        detail: `${notableCount} notable X/Twitter accounts bullish${xSocial.mention_volume === 'high' ? ', high mention volume' : ''} — KOL consensus forming.`,
      });
    }
  }

  // Round 32 (AutoResearch): X/Twitter bearish warning — adds as signal for alert systems
  if (!xSocial.error && xSocial.kol_sentiment === 'bearish' && xSocial.mention_volume !== 'none') {
    signals.push({
      signal: 'kol_bearish_x_sentiment',
      strength: xSocial.sentiment_score != null && xSocial.sentiment_score < -0.5 ? 'strong' : 'moderate',
      detail: `X/Twitter KOL sentiment is bearish (score: ${xSocial.sentiment_score?.toFixed(2) ?? 'n/a'}) — influential accounts expressing concern.`,
    });
  }

  // Round R11 (AutoResearch batch): BTC risk-off macro context — btc_dominance rising = alt risk
  // If BTC dominance > 58% AND rising global market cap → alts outperforming BTC regime not confirmed
  const btcDominance = safeN(market.btc_dominance ?? 0);
  const globalMcapChange = safeN(market.market_cap_change_pct_24h_global ?? 0);
  if (btcDominance > 0 && btcDominance < 45 && globalMcapChange > 2) {
    signals.push({
      signal: 'altcoin_season_macro',
      strength: btcDominance < 40 ? 'strong' : 'moderate',
      detail: `BTC dominance at ${btcDominance.toFixed(1)}% (below 45%) with +${globalMcapChange.toFixed(1)}% global market cap growth — altcoin rotation window open.`,
    });
  }

  // Round R11: Strong recovery signal — price bouncing off ATL with volume
  const atlDistSig = safeN(market.atl_distance_pct ?? null, null);
  const change7dSig = safeN(market.price_change_pct_7d ?? 0);
  const volRatioSig = mcap > 0 && volume > 0 ? volume / mcap : 0;
  if (atlDistSig !== null && atlDistSig < 50 && atlDistSig > 10 && change7dSig > 15 && volRatioSig > 0.1) {
    signals.push({
      signal: 'low_base_recovery',
      strength: change7dSig > 30 ? 'strong' : 'moderate',
      detail: `Recovering from near-ATL base (${atlDistSig.toFixed(0)}% above ATL) with +${change7dSig.toFixed(0)}% 7d and high volume — potential bottom reversal.`,
    });
  }

  // Round 151 (AutoResearch): Fee switch candidate — protocol generates fees but captures zero revenue
  // This is a bullish setup: a governance vote to enable fee switch → direct value accrual to token
  const fees7dFS = safeN(onchain.fees_7d ?? 0);
  const revenue7dFS = safeN(onchain.revenue_7d ?? 0);
  const tvlFS = safeN(onchain.tvl ?? 0);
  if (fees7dFS > 200_000 && revenue7dFS === 0 && tvlFS > 5_000_000) {
    signals.push({
      signal: 'fee_switch_candidate',
      strength: fees7dFS > 1_000_000 ? 'strong' : 'moderate',
      detail: `Protocol generates $${(fees7dFS / 1000).toFixed(0)}K/week in fees but retains $0 revenue — fee switch activation would immediately create token value accrual.`,
    });
  }

  // Round 152 (AutoResearch): Smart accumulation — DEX buy pressure + low volume volatility + flat price
  // Classic smart money accumulation: high buy/sell ratio + stable price = quiet hand-over-fist buying
  const buySellSig = safeN(dex.buy_sell_ratio ?? 0);
  const c24hSig = safeN(market.price_change_pct_24h ?? 0);
  const c7dSig = safeN(market.price_change_pct_7d ?? 0);
  if (buySellSig >= 1.2 && Math.abs(c24hSig) < 5 && Math.abs(c7dSig) < 10) {
    signals.push({
      signal: 'smart_accumulation_pattern',
      strength: buySellSig >= 1.4 ? 'strong' : 'moderate',
      detail: `Strong DEX buy pressure (${buySellSig.toFixed(2)} ratio) with only ${c24hSig.toFixed(1)}% 24h move — classic accumulation: buyers absorbing supply without moving price.`,
    });
  }

  // Round 230 (AutoResearch): Veteran protocol with strong fees signal
  // A protocol that's been live for 2+ years and still generating significant fees is battle-tested
  const protocolAgeDays = safeN(onchain.protocol_age_days ?? 0);
  const fees7dVet = safeN(onchain.fees_7d ?? 0);
  if (protocolAgeDays >= 730 && fees7dVet > 500_000) {
    signals.push({
      signal: 'veteran_protocol_strong_fees',
      strength: fees7dVet > 2_000_000 ? 'strong' : 'moderate',
      detail: `Protocol ${Math.floor(protocolAgeDays / 365)}+ years old with $${(fees7dVet / 1000).toFixed(0)}K/week fees — battle-tested with proven product-market fit.`,
    });
  }

  // Round 219 (AutoResearch): Volume spike + buy pressure = high-conviction breakout signal
  // When volume spikes significantly AND buyers are in control, it's a potential breakout setup
  const volumeSpike = market.volume_spike_flag;
  const spikeRatio = safeN(dex.buy_sell_ratio ?? 0);
  if ((volumeSpike === 'extreme_spike' || volumeSpike === 'spike') && spikeRatio >= 1.1) {
    signals.push({
      signal: 'volume_spike_buy_pressure',
      strength: volumeSpike === 'extreme_spike' && spikeRatio >= 1.3 ? 'strong' : 'moderate',
      detail: `Volume spike (${volumeSpike}) with net buy pressure (ratio ${spikeRatio.toFixed(2)}) — potential breakout; confirm with price action.`,
    });
  }

  // Round 219 (AutoResearch): Revenue trend improvement + fee efficiency = fundamental momentum
  const revTrend = onchain.revenue_trend;
  const revEff = safeN(onchain.revenue_efficiency ?? 0);
  if (revTrend === 'improving' && revEff > 50) {
    signals.push({
      signal: 'revenue_momentum',
      strength: revEff > 200 ? 'strong' : 'moderate',
      detail: `Revenue improving week-over-week with $${revEff.toFixed(0)}/M TVL/week efficiency — fundamentals strengthening.`,
    });
  }

  // Deduplicate signals by signal key (keep first occurrence)
  const seen = new Set();
  return signals.filter((s) => {
    if (seen.has(s.signal)) return false;
    seen.add(s.signal);
    return true;
  });
}

/**
 * Round 53 (AutoResearch): Calculate a 0-100 signal strength score for an array of alpha signals.
 * Strong signals contribute more weight than weak ones; more signals = higher score (capped).
 *
 * @param {Array<{signal: string, strength: string}>} signals - result of detectAlphaSignals()
 * @returns {number} score 0-100
 */
export function getSignalStrengthScore(signals = []) {
  if (!Array.isArray(signals) || signals.length === 0) return 0;
  const WEIGHTS = { strong: 20, moderate: 12, weak: 6 };
  const raw = signals.reduce((sum, s) => sum + (WEIGHTS[s.strength] ?? 8), 0);
  return Math.min(100, raw);
}
