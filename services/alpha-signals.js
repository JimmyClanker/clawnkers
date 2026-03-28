import { safeNum } from '../utils/math.js';
/**
 * alpha-signals.js — Round 15
 * Detects positive alpha signals from raw scanner data and scores.
 */


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
  const mcap   = safeNum(market.market_cap);
  const volume = safeNum(market.total_volume);
  const change24h = safeNum(market.price_change_pct_24h);
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
    const commits30d = safeNum(github.commits_30d);
    const commits30dPrev = safeNum(github.commits_30d_prev);
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
  const exchangeCount = safeNum(market.exchange_count ?? dex.exchange_count);
  if (exchangeCount > 5) {
    signals.push({
      signal: 'multi_exchange_listing',
      strength: exchangeCount > 15 ? 'strong' : exchangeCount > 8 ? 'moderate' : 'weak',
      detail: `Listed on ${exchangeCount} exchanges — broad distribution reduces single-venue liquidity risk.`,
    });
  }

  // 4. TVL growth > 20% in 7d
  const tvlChange7d = safeNum(onchain.tvl_change_7d);
  if (tvlChange7d > 20) {
    signals.push({
      signal: 'tvl_growth_spike',
      strength: tvlChange7d > 50 ? 'strong' : tvlChange7d > 30 ? 'moderate' : 'weak',
      detail: `TVL grew ${tvlChange7d.toFixed(1)}% in 7d — strong capital inflow into the protocol.`,
    });
  }

  // 5. High sentiment score with significant mentions
  const sentimentScore = safeNum(social.sentiment_score, NaN);
  const mentions = safeNum(social.filtered_mentions ?? social.mentions);
  if (Number.isFinite(sentimentScore) && sentimentScore > 0.5 && mentions >= 5) {
    signals.push({
      signal: 'strong_positive_sentiment',
      strength: sentimentScore > 0.75 ? 'strong' : 'moderate',
      detail: `Sentiment score ${sentimentScore.toFixed(2)} with ${mentions} (filtered) mentions — strong community conviction.`,
    });
  }

  // 6. Improving sector position
  const sectorRank = safeNum(sector.rank ?? sector.sector_rank, NaN);
  const sectorPrevRank = safeNum(sector.prev_rank ?? sector.sector_prev_rank, NaN);
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
  const athDistancePct = safeNum(market.ath_distance_pct, NaN);
  if (Number.isFinite(athDistancePct) && athDistancePct >= -10 && athDistancePct < 0) {
    signals.push({
      signal: 'near_ath_breakout',
      strength: athDistancePct >= -5 ? 'strong' : 'moderate',
      detail: `Price is only ${Math.abs(athDistancePct).toFixed(1)}% below ATH — potential breakout setup.`,
    });
  }

  // 9. Round 4: High DEX liquidity with growing DEX pair count (expansion)
  const dexPairCount = safeNum(dex.dex_pair_count ?? 0);
  const dexLiquidity = safeNum(dex.dex_liquidity_usd ?? 0);
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
  const revEfficiency = safeNum(onchain.revenue_efficiency ?? 0);
  const fees7d = safeNum(onchain.fees_7d ?? 0);
  if (fees7d > 100_000 && revEfficiency > 50) {
    signals.push({
      signal: 'revenue_generating',
      strength: fees7d > 1_000_000 ? 'strong' : 'moderate',
      detail: `Protocol generated $${(fees7d / 1000).toFixed(0)}K fees in 7d with revenue efficiency of $${revEfficiency.toFixed(0)}/M TVL/wk.`,
    });
  }

  // 12. Round 42: Institutional interest from social mentions
  const institutionalMentions = safeNum(social.institutional_mentions ?? 0);
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
  const treasuryBalance = safeNum(onchain.treasury_balance ?? 0);
  const marketCap = safeNum(market.market_cap ?? 0);
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
  const governanceProposals = safeNum(onchain.governance_proposals_30d ?? 0);
  const governanceParticipation = safeNum(onchain.governance_participation_pct ?? 0);
  if (governanceProposals >= 3 || governanceParticipation >= 10) {
    signals.push({
      signal: 'active_governance',
      strength: governanceProposals >= 10 ? 'strong' : 'moderate',
      detail: `${governanceProposals} governance proposals in 30 days${governanceParticipation > 0 ? ` with ${governanceParticipation.toFixed(0)}% token holder participation` : ''} — active decentralized governance.`,
    });
  }

  // 16. Round 55: Partnership or integration news from social
  const partnershipMentions = safeNum(social.partnership_mentions ?? 0);
  if (partnershipMentions >= 2) {
    signals.push({
      signal: 'partnership_news',
      strength: partnershipMentions >= 5 ? 'strong' : 'moderate',
      detail: `${partnershipMentions} recent mentions of partnerships or protocol integrations — expanding ecosystem presence.`,
    });
  }

  // 17. Round 55: ATL recovery with momentum — price recovering strongly from bottom
  const atlDist = safeNum(market.atl_distance_pct, NaN);
  const c7d = safeNum(market.price_change_pct_7d, NaN);
  if (Number.isFinite(atlDist) && Number.isFinite(c7d) && atlDist > 20 && atlDist < 100 && c7d > 15) {
    signals.push({
      signal: 'atl_recovery_momentum',
      strength: c7d > 40 ? 'strong' : 'moderate',
      detail: `Price is ${atlDist.toFixed(1)}% above ATL and rising +${c7d.toFixed(1)}% this week — recovery momentum building.`,
    });
  }

  // 18. Round 68: High fees/TVL efficiency — extremely capital-efficient protocol
  const tvlForEfficiency = safeNum(onchain.tvl ?? 0);
  const fees7dForEfficiency = safeNum(onchain.fees_7d ?? 0);
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
    const topRank = safeNum(market.market_cap_rank, 0);
    signals.push({
      signal: 'coingecko_trending',
      strength: topRank > 0 && topRank <= 50 ? 'strong' : 'moderate',
      detail: `${market.name ?? projectName} is currently trending on CoinGecko — elevated discovery and retail interest.`,
    });
  }

  // 20. Round 3 (AutoResearch batch): Strong longer-term trend (200d positive)
  const c200d = safeNum(market.price_change_pct_200d, NaN);
  const c1y   = safeNum(market.price_change_pct_1y, NaN);
  if (Number.isFinite(c200d) && c200d > 50 && Number.isFinite(c1y) && c1y > 50) {
    signals.push({
      signal: 'strong_long_term_trend',
      strength: c200d > 200 ? 'strong' : 'moderate',
      detail: `+${c200d.toFixed(0)}% over 200 days and +${c1y.toFixed(0)}% over 1 year — sustained long-term uptrend, not just a short-term spike.`,
    });
  }

  // 21. Round 4 (AutoResearch batch): High CEX volume share — institutional distribution
  const cexVolumePct = safeNum(market.cex_volume_pct, NaN);
  if (Number.isFinite(cexVolumePct) && cexVolumePct >= 75 && safeNum(market.total_volume) > 500_000) {
    signals.push({
      signal: 'high_cex_volume_share',
      strength: cexVolumePct >= 90 ? 'strong' : 'moderate',
      detail: `${cexVolumePct.toFixed(0)}% of trading volume flows through CEXs — strong institutional and retail accessibility.`,
    });
  }

  // 22. Round 32 (AutoResearch): SUPPLY_SHOCK — circulating supply compressed, low FDV overhang
  const circulatingSupply = safeNum(market.circulating_supply);
  const totalSupply = safeNum(market.total_supply);
  const fdvMcapRatio = safeNum(market.fdv_mcap_ratio ?? onchain.fdv_mcap_ratio, NaN);
  if (circulatingSupply > 0 && totalSupply > 0 && Number.isFinite(fdvMcapRatio)) {
    const supplyPct = (circulatingSupply / totalSupply) * 100;
    // Supply shock: low circulating % (<30%) + FDV/MCap < 2 = supply compressed
    if (supplyPct < 30 && fdvMcapRatio < 2.0) {
      signals.push({
        signal: 'supply_shock',
        strength: supplyPct < 20 ? 'strong' : 'moderate',
        detail: `Circulating supply ${supplyPct.toFixed(1)}% of total, FDV/MCap ${fdvMcapRatio.toFixed(1)}x — low float, compressed supply.`,
      });
    }
  }

  // 23. Round 33 (AutoResearch): CROSS_CHAIN_TVL_GROWTH — TVL growing on multiple chains simultaneously
  if (Array.isArray(onchain.chains) && onchain.chains.length >= 3) {
    const growingChains = onchain.chains.filter(ch => safeNum(ch.tvl_change_7d, 0) > 15);
    if (growingChains.length >= 2) {
      const totalChainTvl = onchain.chains.reduce((sum, ch) => sum + safeNum(ch.tvl), 0);
      signals.push({
        signal: 'cross_chain_tvl_growth',
        strength: growingChains.length >= 3 ? 'strong' : 'moderate',
        detail: `TVL growing >15% on ${growingChains.length} chains (total ${onchain.chains.length} chains, $${(totalChainTvl / 1_000_000).toFixed(1)}M TVL) — multichain capital inflow.`,
      });
    }
  }

  // ── Price-based alpha signals (migrated from price-alerts.js) ──

  const c1hPrice = safeNum(market.price_change_pct_1h, NaN);
  const c30dPrice = safeNum(market.price_change_pct_30d, NaN);
  const athPrice = safeNum(market.ath, NaN);

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
  const veryRecentCount = safeNum(social.very_recent_news_count ?? 0);
  if (newsMomentum === 'accelerating' && veryRecentCount >= 3) {
    signals.push({
      signal: 'accelerating_news_coverage',
      strength: veryRecentCount >= 5 ? 'strong' : 'moderate',
      detail: `${veryRecentCount} news items in the last 3 days vs overall window — coverage is accelerating, suggesting a fresh catalyst or rising narrative interest.`,
    });
  }

  // Round 8 (AutoResearch nightly): Revenue-to-fees ratio above 30% = strong value capture
  const revenueToFees = safeNum(rawData?.onchain?.revenue_to_fees_ratio ?? null, NaN);
  if (Number.isFinite(revenueToFees) && revenueToFees >= 0.30) {
    signals.push({
      signal: 'strong_revenue_capture',
      strength: revenueToFees >= 0.50 ? 'strong' : 'moderate',
      detail: `Protocol captures ${(revenueToFees * 100).toFixed(0)}% of fees as revenue — strong value accrual to token holders.`,
    });
  }

  // Round 8 (AutoResearch nightly): Liquidity health score above 70 = well-distributed DEX presence
  const liqHealth = safeNum(rawData?.dex?.liquidity_health_score ?? null, NaN);
  if (Number.isFinite(liqHealth) && liqHealth >= 70) {
    signals.push({
      signal: 'strong_dex_liquidity_health',
      strength: liqHealth >= 85 ? 'strong' : 'moderate',
      detail: `DEX liquidity health score is ${liqHealth}/100 — deep, diversified liquidity across multiple venues.`,
    });
  }

  // Round 49 (AutoResearch): Short interest proxy signal — extreme sell pressure + high FDV overhang
  // These conditions suggest informed sellers (team, VCs) may be distributing
  const shortFdv = safeNum(market.fully_diluted_valuation ?? 0);
  const shortMcap = safeNum(market.market_cap ?? 0);
  const shortFdvRatio = shortMcap > 0 && shortFdv > 0 ? shortFdv / shortMcap : null;
  const shortBuySellRatio = safeNum(dex.buy_sell_ratio ?? 0);
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
  const btcDominance = safeNum(market.btc_dominance ?? 0);
  const globalMcapChange = safeNum(market.market_cap_change_pct_24h_global ?? 0);
  if (btcDominance > 0 && btcDominance < 45 && globalMcapChange > 2) {
    signals.push({
      signal: 'altcoin_season_macro',
      strength: btcDominance < 40 ? 'strong' : 'moderate',
      detail: `BTC dominance at ${btcDominance.toFixed(1)}% (below 45%) with +${globalMcapChange.toFixed(1)}% global market cap growth — altcoin rotation window open.`,
    });
  }

  // Round R11: Strong recovery signal — price bouncing off ATL with volume
  const atlDistSig = safeNum(market.atl_distance_pct ?? null, null);
  const change7dSig = safeNum(market.price_change_pct_7d ?? 0);
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
  const fees7dFS = safeNum(onchain.fees_7d ?? 0);
  const revenue7dFS = safeNum(onchain.revenue_7d ?? 0);
  const tvlFS = safeNum(onchain.tvl ?? 0);
  if (fees7dFS > 200_000 && revenue7dFS === 0 && tvlFS > 5_000_000) {
    signals.push({
      signal: 'fee_switch_candidate',
      strength: fees7dFS > 1_000_000 ? 'strong' : 'moderate',
      detail: `Protocol generates $${(fees7dFS / 1000).toFixed(0)}K/week in fees but retains $0 revenue — fee switch activation would immediately create token value accrual.`,
    });
  }

  // Round 152 (AutoResearch): Smart accumulation — DEX buy pressure + low volume volatility + flat price
  // Classic smart money accumulation: high buy/sell ratio + stable price = quiet hand-over-fist buying
  const buySellSig = safeNum(dex.buy_sell_ratio ?? 0);
  const c24hSig = safeNum(market.price_change_pct_24h ?? 0);
  const c7dSig = safeNum(market.price_change_pct_7d ?? 0);
  if (buySellSig >= 1.2 && Math.abs(c24hSig) < 5 && Math.abs(c7dSig) < 10) {
    signals.push({
      signal: 'smart_accumulation_pattern',
      strength: buySellSig >= 1.4 ? 'strong' : 'moderate',
      detail: `Strong DEX buy pressure (${buySellSig.toFixed(2)} ratio) with only ${c24hSig.toFixed(1)}% 24h move — classic accumulation: buyers absorbing supply without moving price.`,
    });
  }

  // Round 230 (AutoResearch): Veteran protocol with strong fees signal
  // A protocol that's been live for 2+ years and still generating significant fees is battle-tested
  const protocolAgeDays = safeNum(onchain.protocol_age_days ?? 0);
  const fees7dVet = safeNum(onchain.fees_7d ?? 0);
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
  const spikeRatio = safeNum(dex.buy_sell_ratio ?? 0);
  if ((volumeSpike === 'extreme_spike' || volumeSpike === 'spike') && spikeRatio >= 1.1) {
    signals.push({
      signal: 'volume_spike_buy_pressure',
      strength: volumeSpike === 'extreme_spike' && spikeRatio >= 1.3 ? 'strong' : 'moderate',
      detail: `Volume spike (${volumeSpike}) with net buy pressure (ratio ${spikeRatio.toFixed(2)}) — potential breakout; confirm with price action.`,
    });
  }

  // Round 219 (AutoResearch): Revenue trend improvement + fee efficiency = fundamental momentum
  const revTrend = onchain.revenue_trend;
  const revEff = safeNum(onchain.revenue_efficiency ?? 0);
  if (revTrend === 'improving' && revEff > 50) {
    signals.push({
      signal: 'revenue_momentum',
      strength: revEff > 200 ? 'strong' : 'moderate',
      detail: `Revenue improving week-over-week with $${revEff.toFixed(0)}/M TVL/week efficiency — fundamentals strengthening.`,
    });
  }

  // Round 232 (AutoResearch nightly): Social velocity spike — mentions growing fast vs momentum data
  const mentionVelocity = rawData?.momentum?.social?.velocity_pct;
  const filteredMentionsForVel = safeNum(social.filtered_mentions ?? social.mentions);
  if (mentionVelocity != null && mentionVelocity >= 150 && filteredMentionsForVel >= 10) {
    signals.push({
      signal: 'social_velocity_spike',
      strength: mentionVelocity >= 300 ? 'strong' : 'moderate',
      detail: `Social mention velocity +${mentionVelocity.toFixed(0)}% vs prior period with ${filteredMentionsForVel} filtered mentions — rapid community growth suggests incoming narrative momentum.`,
    });
  }

  // Round 231 (AutoResearch nightly): Long-term reset breakout
  const lthSignal = detectLongTermHolderSignal(market);
  if (lthSignal) signals.push(lthSignal);

  // Round 233b (AutoResearch nightly): High protocol efficiency signal
  // Protocols with high efficiency score (>70) are efficiently deploying their TVL to generate revenue
  const protocolEffScoreAlpha = safeNum(onchain.protocol_efficiency_score ?? null, null);
  const tvlForAlpha = safeNum(onchain.tvl ?? 0);
  if (protocolEffScoreAlpha !== null && protocolEffScoreAlpha >= 70 && tvlForAlpha >= 10_000_000) {
    signals.push({
      signal: 'high_fee_efficiency',
      strength: protocolEffScoreAlpha >= 85 ? 'strong' : 'moderate',
      detail: `Protocol efficiency score ${protocolEffScoreAlpha}/100 — capital is being deployed effectively with strong fee generation and revenue capture.`,
    });
  }

  // Round 233 (AutoResearch nightly): P/TVL undervaluation signal
  // When market cap is below TVL (P/TVL < 1), token is priced below on-chain value
  const mcapPtvl = safeNum(market.market_cap ?? 0);
  const tvlPtvl = safeNum(onchain.tvl ?? 0);
  if (mcapPtvl > 0 && tvlPtvl > 0) {
    const ptvl = mcapPtvl / tvlPtvl;
    if (ptvl < 1.0 && tvlPtvl > 5_000_000) {
      signals.push({
        signal: 'low_price_to_tvl',
        strength: ptvl < 0.5 ? 'strong' : 'moderate',
        detail: `P/TVL ratio ${ptvl.toFixed(2)}x — market cap ($${(mcapPtvl/1e6).toFixed(1)}M) is below TVL ($${(tvlPtvl/1e6).toFixed(1)}M), suggesting the token may be undervalued relative to on-chain capital.`,
      });
    }
  }

  // Round 234 (AutoResearch): FDV/MCap efficiency — low future inflation risk
  const fdvSig = detectFdvEfficiencySignal(market);
  if (fdvSig) signals.push(fdvSig);

  // Round 234b (AutoResearch): Multi-chain expansion signal
  // When a protocol is deployed on 4+ chains and TVL is growing, cross-chain expansion is a bullish catalyst
  const chainCount234 = Array.isArray(onchain.chains) ? onchain.chains.length : 0;
  const tvlChange7d234 = safeNum(onchain.tvl_change_7d);
  if (chainCount234 >= 4 && tvlChange7d234 > 10) {
    signals.push({
      signal: 'multi_chain_expansion',
      strength: chainCount234 >= 8 && tvlChange7d234 > 25 ? 'strong' : 'moderate',
      detail: `Deployed on ${chainCount234} chains with +${tvlChange7d234.toFixed(1)}% TVL growth (7d) — active multi-chain expansion with capital inflows across ecosystems.`,
    });
  }

  // Round 235 (AutoResearch): Price above MA7 with increasing volume — classic breakout setup
  const priceVsMa7 = market.price_vs_ma7;
  const volTrend7d = market.volume_trend_7d;
  if (priceVsMa7?.above_ma7 && priceVsMa7.pct_vs_ma7 > 3 && volTrend7d === 'increasing') {
    signals.push({
      signal: 'ma7_breakout_with_volume',
      strength: priceVsMa7.pct_vs_ma7 > 8 ? 'strong' : 'moderate',
      detail: `Price is ${priceVsMa7.pct_vs_ma7.toFixed(1)}% above 7-day MA with increasing volume trend — price-volume confirmation of bullish momentum.`,
    });
  }

  // Round 235b (AutoResearch): Volume increasing but price flat — silent accumulation upgrade
  if (volTrend7d === 'increasing' && safeNum(market.price_change_pct_7d) != null && Math.abs(safeNum(market.price_change_pct_7d)) < 5) {
    signals.push({
      signal: 'volume_building_flat_price',
      strength: 'moderate',
      detail: `Volume trend increasing over 7 days while price change is ${safeNum(market.price_change_pct_7d).toFixed(1)}% — accumulation building under the surface.`,
    });
  }

  // Round 236b (AutoResearch): CEX listing mention signal — significant catalyst
  // Even rumors of major exchange listings drive significant price action
  const listingMentions = safeNum(social.listing_mentions ?? 0);
  if (listingMentions >= 2) {
    signals.push({
      signal: 'exchange_listing_catalyst',
      strength: listingMentions >= 5 ? 'strong' : 'moderate',
      detail: `${listingMentions} news articles mention potential exchange listings — CEX listings typically drive 20-100%+ price increases upon announcement.`,
    });
  }

  // Round 236 (AutoResearch): 52-week high breakout signal
  // Price approaching or at 52w high = powerful momentum signal used by institutional traders
  const vs52w = market.price_vs_52w;
  if (vs52w?.tier === 'near_high' && vs52w.pct_from_52w_high > -5) {
    signals.push({
      signal: '52w_high_breakout',
      strength: vs52w.pct_from_52w_high > -2 ? 'strong' : 'moderate',
      detail: `Price is ${Math.abs(vs52w.pct_from_52w_high).toFixed(1)}% from its 52-week high ($${vs52w.high_52w}) — near-ATH momentum suggests strong demand and potential breakout.`,
    });
  }

  // Round 234 (AutoResearch): Strong narrative alignment signal
  const narrativeStrength = rawData?.narrative_strength;
  if (narrativeStrength && narrativeStrength.score >= 60) {
    signals.push({
      signal: 'strong_narrative_alignment',
      strength: narrativeStrength.score >= 80 ? 'strong' : 'moderate',
      detail: `Narrative strength score ${narrativeStrength.score}/100 — ${narrativeStrength.detail} Strong macro tailwinds can amplify price performance regardless of fundamentals.`,
    });
  }

  // Round 235 (AutoResearch): Fee acceleration signal — fundamentals improving faster than TVL growth
  const feeAccel = onchain.fee_revenue_acceleration;
  const dailyFeeRate = safeNum(onchain.daily_fee_rate_annualized ?? 0);
  if (feeAccel === 'accelerating' && dailyFeeRate > 2) {
    signals.push({
      signal: 'fee_revenue_acceleration',
      strength: dailyFeeRate > 10 ? 'strong' : 'moderate',
      detail: `Revenue accelerating with ${dailyFeeRate.toFixed(2)}% annualized daily fee rate — protocol is extracting more value from its capital as adoption grows.`,
    });
  }

  // Round 237d (AutoResearch nightly): low_bus_factor_risk_cleared signal
  // When bus_factor_score is high AND recent release exists, single-dev risk is manageable
  const busFScore = safeNum(github.bus_factor_score ?? 0);
  const hasRecentRelease = github.has_recent_release === true;
  if (busFScore >= 75 && hasRecentRelease) {
    signals.push({
      signal: 'distributed_dev_plus_active_shipping',
      strength: busFScore >= 90 ? 'strong' : 'moderate',
      detail: `Dev contribution Gini score ${busFScore}/100 (high distribution) with recent release — well-distributed team actively shipping reduces key-person risk.`,
    });
  }

  // Round 237 (AutoResearch nightly): community_score_leader — top community score vs peers
  // CoinGecko's community score aggregates Twitter + Telegram + Reddit followers into one metric.
  // A score >70 means the project has a large, established following relative to crypto-wide median.
  const communityScore = safeNum(social.community_score ?? market.community_score ?? 0);
  if (communityScore >= 70) {
    signals.push({
      signal: 'community_score_leader',
      strength: communityScore >= 85 ? 'strong' : 'moderate',
      detail: `Community score ${communityScore}/100 — top-tier social following (Twitter + Telegram + Reddit) indicates broad awareness and established holder base.`,
    });
  }

  // Round 237b (AutoResearch nightly): news_acceleration — rising recent news coverage signals fresh catalyst
  const newsMomentum237 = social.news_momentum;
  const recentNewsCount = safeNum(social.very_recent_news_count ?? 0);
  const filteredMentionsForNM = safeNum(social.filtered_mentions ?? social.mentions ?? 0);
  if (newsMomentum237 === 'accelerating' && recentNewsCount >= 3 && filteredMentionsForNM >= 5) {
    signals.push({
      signal: 'news_acceleration',
      strength: recentNewsCount >= 6 ? 'strong' : 'moderate',
      detail: `${recentNewsCount} of ${filteredMentionsForNM} news articles published in last 3 days — accelerating news coverage suggests a recent catalyst driving media attention.`,
    });
  }

  // Round 237c (AutoResearch nightly): governance_activity — DAO votes signal active community engagement
  const governanceMentions = safeNum(social.governance_mentions ?? 0);
  if (governanceMentions >= 3) {
    signals.push({
      signal: 'governance_activity',
      strength: governanceMentions >= 6 ? 'strong' : 'moderate',
      detail: `${governanceMentions} recent governance/DAO mentions — active on-chain governance participation signals healthy community decision-making.`,
    });
  }

  // Round 238 (AutoResearch): Airdrop catalyst signal — community demand driver
  const airdropMentions = safeNum(social.airdrop_mentions ?? 0);
  if (airdropMentions >= 2) {
    signals.push({
      signal: 'airdrop_catalyst',
      strength: airdropMentions >= 5 ? 'strong' : 'moderate',
      detail: `${airdropMentions} news articles cover airdrops/token distributions — upcoming airdrops drive wallet activity, new user acquisition, and short-term price demand.`,
    });
  }

  // Round 238b (AutoResearch): Volume acceleration on DEX — m5 + h1 both bullish = momentum burst
  const m5Change = safeNum(dex.dex_price_change_m5 ?? NaN);
  const h1Change = safeNum(dex.dex_price_change_h1 ?? NaN);
  if (Number.isFinite(m5Change) && Number.isFinite(h1Change) && m5Change > 3 && h1Change > 5) {
    signals.push({
      signal: 'dex_momentum_burst',
      strength: m5Change > 8 || h1Change > 15 ? 'strong' : 'moderate',
      detail: `DEX price up ${m5Change.toFixed(1)}% in 5m and ${h1Change.toFixed(1)}% in 1h — ultra-short-term momentum burst, potential breakout in progress.`,
    });
  }

  // Round 381 (AutoResearch): Wire in detectRecentAthMomentum — recent ATH is a strong alpha signal
  const athMomentumSignal = detectRecentAthMomentum(rawData);
  if (athMomentumSignal) signals.push(athMomentumSignal);

  // Round 381 (AutoResearch): Narrative freshness signal — fresh narratives = active catalyst cycle
  const narrativeFreshness = safeNum(social.narrative_freshness_score ?? null, null);
  if (narrativeFreshness !== null && narrativeFreshness >= 60) {
    signals.push({
      signal: 'fresh_narrative_momentum',
      strength: narrativeFreshness >= 80 ? 'strong' : 'moderate',
      detail: `Narrative freshness score ${narrativeFreshness}/100 — most social coverage driven by events from last 3 days. Active catalyst cycle in progress.`,
    });
  }

  // Round 383 (AutoResearch): Wire in new signal detectors
  const lowFloatMomSignal = detectLowFloatMomentum(rawData);
  if (lowFloatMomSignal) signals.push(lowFloatMomSignal);

  // detectNarrativeDecay is a weakness/caution signal, not strictly an alpha signal
  // but we surface it so the LLM and report can address narrative exhaustion risk
  const narrativeDecaySignal = detectNarrativeDecay(rawData);
  if (narrativeDecaySignal) signals.push(narrativeDecaySignal);

  // Reddit sentiment momentum — improving Reddit activity = community acceleration
  const redditSentMom = rawData?.reddit?.sentiment_momentum;
  if (redditSentMom === 'improving' && (rawData?.reddit?.post_count ?? 0) >= 5) {
    signals.push({
      signal: 'reddit_sentiment_accelerating',
      strength: (rawData?.reddit?.avg_post_score ?? 0) > 50 ? 'strong' : 'moderate',
      detail: `Reddit sentiment improving in last 24h vs full week (${rawData.reddit.post_count} posts, avg score ${rawData.reddit.avg_post_score ?? 'n/a'}) — community momentum building.`,
    });
  }

  // Round 469 (AutoResearch): social_leads_price — high social conviction + price not moved yet
  // Classic leading indicator: KOLs and community bullish, but price hasn't reacted → early entry
  const socialSentiment469 = safeNum(social.sentiment_score ?? NaN);
  const kolSentiment = social.kol_sentiment ?? null;
  const xSocial469 = rawData.x_social ?? {};
  const priceChange24h469 = safeNum(market.price_change_pct_24h ?? NaN);
  const priceChange7d469 = safeNum(market.price_change_pct_7d ?? NaN);
  if (
    Number.isFinite(socialSentiment469) && socialSentiment469 > 0.6 &&
    (kolSentiment === 'bullish' || xSocial469.kol_sentiment === 'bullish') &&
    Number.isFinite(priceChange24h469) && Number.isFinite(priceChange7d469) &&
    priceChange24h469 < 3 && priceChange7d469 < 10
  ) {
    signals.push({
      signal: 'social_leads_price',
      strength: socialSentiment469 > 0.75 ? 'strong' : 'moderate',
      detail: `Strong social sentiment (${socialSentiment469.toFixed(2)}) + KOL bullish conviction, but price only ${priceChange24h469.toFixed(1)}% 24h / ${priceChange7d469.toFixed(1)}% 7d — social narrative leading price, potential early entry before broader market reaction.`,
    });
  }

  // Round 467 (AutoResearch): sector_outperforming_btc — project's sector is beating BTC this week
  // When a sector is outperforming BTC (beta-adjusted), it indicates sector rotation flow
  const sectorPerf7d = safeNum(sector.sector_performance_7d ?? NaN);
  const btcPerf7d = safeNum(market.btc_price_change_7d ?? NaN);
  const projectPerf7d = safeNum(market.price_change_pct_7d ?? NaN);
  if (Number.isFinite(sectorPerf7d) && Number.isFinite(btcPerf7d) && sectorPerf7d > btcPerf7d + 5) {
    const relativeOut = sectorPerf7d - btcPerf7d;
    signals.push({
      signal: 'sector_outperforming_btc',
      strength: relativeOut > 15 ? 'strong' : 'moderate',
      detail: `${sector.sector_name ?? 'Sector'} outperforming BTC by +${relativeOut.toFixed(1)}% this week (sector: +${sectorPerf7d.toFixed(1)}% vs BTC: +${btcPerf7d.toFixed(1)}%) — capital rotating into this sector.`,
    });
  }
  // Also check if THIS project is outperforming its own sector
  if (Number.isFinite(projectPerf7d) && Number.isFinite(sectorPerf7d) && projectPerf7d > sectorPerf7d + 5) {
    signals.push({
      signal: 'outperforming_sector',
      strength: projectPerf7d > sectorPerf7d + 15 ? 'strong' : 'moderate',
      detail: `Project outperforming its sector by +${(projectPerf7d - sectorPerf7d).toFixed(1)}% this week (+${projectPerf7d.toFixed(1)}% vs sector +${sectorPerf7d.toFixed(1)}%) — idiosyncratic strength, project-specific catalyst likely.`,
    });
  }

  // Round 464 (AutoResearch): supply_unlock_risk — upcoming token unlock is negative for price
  // Supply unlock detector: if unlock > 5% of supply within 30 days = significant overhang risk
  const supplyUnlock = rawData?.supply_unlock ?? rawData?.onchain?.supply_unlock ?? null;
  if (supplyUnlock && typeof supplyUnlock === 'object') {
    const unlockPct = safeNum(supplyUnlock.pct_of_supply_30d ?? supplyUnlock.unlock_pct ?? 0);
    const daysToUnlock = safeNum(supplyUnlock.days_to_next_unlock ?? 999);
    if (unlockPct >= 5 && daysToUnlock <= 30) {
      signals.push({
        signal: 'upcoming_supply_unlock_risk',
        strength: unlockPct >= 15 || daysToUnlock <= 7 ? 'strong' : 'moderate',
        detail: `Supply unlock of ${unlockPct.toFixed(1)}% of circulating supply expected in ${daysToUnlock}d — historically creates selling pressure. Consider reducing position size or waiting for unlock to pass.`,
      });
    }
  } else {
    // Check via market data: circulating_to_max_ratio changing + decreasing supply → unlock pressure
    const maxSupply = safeNum(market.max_supply ?? 0);
    const circulatingSupply452 = safeNum(market.circulating_supply ?? 0);
    if (maxSupply > 0 && circulatingSupply452 > 0) {
      const supplyUtilization = circulatingSupply452 / maxSupply;
      // If supply util is 30-70% it's mid-unlock phase — potentially concerning if price is at highs
      if (supplyUtilization >= 0.3 && supplyUtilization <= 0.7) {
        // Only surface this if price is at high (near ATH) — unlock at ATH = sell pressure setup
        const athDist464 = safeNum(market.ath_distance_pct ?? NaN);
        if (Number.isFinite(athDist464) && athDist464 > -20) {
          signals.push({
            signal: 'mid_unlock_near_ath_caution',
            strength: 'weak',
            detail: `${(supplyUtilization * 100).toFixed(0)}% of max supply circulating — mid-unlock phase with price near ATH (${Math.abs(athDist464).toFixed(1)}% from ATH). Early investors/team may have unlock incentive to sell.`,
          });
        }
      }
    }
  }

  // Round 462 (AutoResearch): net_buying_pressure_composite — multi-source buy pressure confirmation
  // Fires when 3 independent buy pressure signals align: DEX buys + CEX volume + 24h price
  const dexBuySell = safeNum(dex.buy_sell_ratio ?? 0);
  const cexVolChange = safeNum(market.volume_change_pct_24h ?? NaN);
  const price24hChange = safeNum(market.price_change_pct_24h ?? NaN);
  let buyPressureScore = 0;
  if (dexBuySell >= 1.15) buyPressureScore++;
  if (Number.isFinite(cexVolChange) && cexVolChange > 20) buyPressureScore++;
  if (Number.isFinite(price24hChange) && price24hChange > 3) buyPressureScore++;
  if (dex.pressure_signal === 'buy_pressure') buyPressureScore++;
  if (buyPressureScore >= 3) {
    signals.push({
      signal: 'net_buying_pressure_composite',
      strength: buyPressureScore >= 4 ? 'strong' : 'moderate',
      detail: `Composite buy pressure confirmed (${buyPressureScore}/4 signals): DEX ratio ${dexBuySell.toFixed(2)}${Number.isFinite(cexVolChange) ? `, CEX vol +${cexVolChange.toFixed(0)}%` : ''}${Number.isFinite(price24hChange) ? `, price +${price24hChange.toFixed(1)}% 24h` : ''} — multiple independent sources confirming net buying.`,
    });
  }

  // Round 460 (AutoResearch): active_addresses_growth — growing active addresses = increasing adoption
  // When active_addresses_7d is growing vs active_addresses_30d average, organic usage is expanding
  const activeAddresses7d = safeNum(onchain.active_addresses_7d ?? 0);
  const activeAddresses30d = safeNum(onchain.active_addresses_30d ?? 0);
  if (activeAddresses7d > 0 && activeAddresses30d > 0) {
    // Weekly rate vs monthly rate: if 7d rate (×4) > 30d count × 1.3
    const weeklyRate = activeAddresses7d * 4; // annualize to 4 weeks
    if (weeklyRate > activeAddresses30d * 1.3 && activeAddresses7d > 500) {
      const growthPct = ((weeklyRate / activeAddresses30d) - 1) * 100;
      signals.push({
        signal: 'active_addresses_growth',
        strength: weeklyRate > activeAddresses30d * 2 ? 'strong' : 'moderate',
        detail: `Active addresses accelerating: ${activeAddresses7d.toLocaleString()} last 7d (${growthPct.toFixed(0)}% above monthly run rate of ${(activeAddresses30d / 4).toLocaleString()}/wk) — organic usage adoption growing.`,
      });
    }
  }

  // Round 457 (AutoResearch): high_token_velocity — on-chain transactions per day / circulating supply
  // High velocity = token actively used (not just held), DeFi utility demand
  const dailyTxns = safeNum(onchain.daily_transactions ?? 0);
  const circulatingTokens = safeNum(market.circulating_supply ?? 0);
  const tokenPrice = safeNum(market.current_price ?? market.price ?? 0);
  if (dailyTxns > 1000 && circulatingTokens > 0 && tokenPrice > 0) {
    // Token velocity = daily volume / market cap (simplified)
    const dailyVolume = safeNum(market.total_volume ?? 0);
    const tokenVelocityPct = (dailyVolume / (circulatingTokens * tokenPrice)) * 100;
    if (tokenVelocityPct > 10) { // >10% of circulating supply transacted daily = very active
      signals.push({
        signal: 'high_token_velocity',
        strength: tokenVelocityPct > 30 ? 'strong' : 'moderate',
        detail: `Token velocity ${tokenVelocityPct.toFixed(1)}% — ${tokenVelocityPct.toFixed(1)}% of circulating supply transacted daily (${dailyTxns.toLocaleString()} daily transactions). Active on-chain utility demand.`,
      });
    }
  }

  // Round 455 (AutoResearch): deep_liquidity_pool — total liquidity (DEX + CEX depth) > 5% MCap
  // High liquidity relative to market cap = institutional market making, reduced slippage, institutional interest
  const dexLiquidityAbs = safeNum(dex.dex_liquidity_usd ?? 0);
  const totalLiquidityEst = dexLiquidityAbs; // in future could add cex_depth
  const mcapForLiq = safeNum(market.market_cap ?? 0);
  if (dexLiquidityAbs > 0 && mcapForLiq > 0) {
    const liqRatio = dexLiquidityAbs / mcapForLiq;
    if (liqRatio >= 0.05 && dexLiquidityAbs >= 1_000_000) {
      signals.push({
        signal: 'deep_liquidity_pool',
        strength: liqRatio >= 0.10 ? 'strong' : 'moderate',
        detail: `DEX liquidity $${(dexLiquidityAbs / 1e6).toFixed(2)}M is ${(liqRatio * 100).toFixed(1)}% of market cap — deep on-chain liquidity supports large orders without significant slippage. Institutional market maker presence.`,
      });
    }
  }

  // Round 452 (AutoResearch): high_developer_activity composite signal
  // Combines: stars growth + forks + recent releases + commit acceleration for a dev health verdict
  const starsGrowth30d = safeNum(github.stars_growth_30d ?? 0);
  const forkCount = safeNum(github.forks ?? 0);
  const openIssues = safeNum(github.open_issues ?? 0);
  const recentPRs = safeNum(github.recent_prs_30d ?? 0);
  const commits30d = safeNum(github.commits_30d ?? 0);
  // Composite: 3+ indicators all showing growth = strong development signal
  let devActivityScore = 0;
  if (starsGrowth30d > 100) devActivityScore++;
  if (forkCount > 500) devActivityScore++;
  if (recentPRs > 20) devActivityScore++;
  if (commits30d > 100) devActivityScore++;
  if (github.commit_trend === 'accelerating') devActivityScore++;
  if (openIssues > 50 && openIssues < 500) devActivityScore++; // healthy: busy but not abandoned
  if (devActivityScore >= 4) {
    signals.push({
      signal: 'high_developer_activity',
      strength: devActivityScore >= 5 ? 'strong' : 'moderate',
      detail: `Strong developer activity composite (${devActivityScore}/6 indicators): stars growth +${starsGrowth30d}, ${forkCount} forks, ${commits30d} commits/30d${recentPRs > 0 ? `, ${recentPRs} recent PRs` : ''}. Active development reduces execution risk.`,
    });
  }

  // Round 451 (AutoResearch): stablecoin_exposure_risk_cleared — protocol predominantly uses blue-chip stablecoins
  // When a DeFi protocol's TVL is primarily USDC/USDT/DAI (vs algorithmic stablecoins), systemic risk is lower
  const stablecoinComposition = rawData?.onchain?.stablecoin_composition ?? null;
  if (stablecoinComposition && typeof stablecoinComposition === 'object') {
    const blueChipPct = safeNum(stablecoinComposition.blue_chip_pct ?? 0);
    const algorithmicPct = safeNum(stablecoinComposition.algorithmic_pct ?? 0);
    if (blueChipPct >= 80 && algorithmicPct < 10) {
      signals.push({
        signal: 'low_stablecoin_systemic_risk',
        strength: blueChipPct >= 95 ? 'strong' : 'moderate',
        detail: `${blueChipPct.toFixed(0)}% of protocol TVL in blue-chip stablecoins (USDC/USDT/DAI), ${algorithmicPct.toFixed(0)}% algorithmic — low systemic stablecoin risk.`,
      });
    }
  }

  // Round 449 (AutoResearch): protocol_upgrade_catalyst — upcoming upgrade/v2 signals
  // Protocol upgrades (v2 launch, L2 migration, tokenomics overhaul) are high-impact catalysts
  const narratives449 = Array.isArray(social.key_narratives) ? social.key_narratives : [];
  const hasUpgradeCatalyst = narratives449.some(n =>
    /v\d\s*launch|protocol upgrade|mainnet launch|migration|token upgrade|v2|v3|upgrade vote|hard fork|new version/i.test(n)
  );
  if (hasUpgradeCatalyst) {
    const upgradeMentions = safeNum(social.upgrade_mentions ?? 0);
    signals.push({
      signal: 'protocol_upgrade_catalyst',
      strength: upgradeMentions >= 5 ? 'strong' : 'moderate',
      detail: `Protocol upgrade/v2/migration narrative detected in social mentions${upgradeMentions > 0 ? ` (${upgradeMentions} mentions)` : ''} — major protocol upgrades historically drive 30-150%+ price appreciation.`,
    });
  }

  // Round 445 (AutoResearch): holder_distribution_improving — Gini index improving = healthier token distribution
  // When holder concentration decreases (more distributed), it reduces whale dump risk
  // tokenomics.holder_gini < 0.7 AND gini improving trend = bullish tokenomics signal
  const holderGini = safeNum(rawData?.tokenomics?.holder_gini ?? null, NaN);
  const holderGiniTrend = rawData?.tokenomics?.holder_gini_trend ?? null;
  if (Number.isFinite(holderGini) && holderGini < 0.7) {
    signals.push({
      signal: 'healthy_holder_distribution',
      strength: holderGini < 0.5 ? 'strong' : 'moderate',
      detail: `Holder Gini coefficient ${holderGini.toFixed(3)} — well-distributed token ownership (< 0.7) reduces whale manipulation risk. ${holderGiniTrend === 'improving' ? 'Distribution improving over time.' : ''}`,
    });
  } else if (Number.isFinite(holderGini) && holderGiniTrend === 'improving') {
    signals.push({
      signal: 'holder_distribution_improving',
      strength: 'moderate',
      detail: `Holder Gini coefficient ${holderGini.toFixed(3)} improving trend — token is becoming more broadly distributed, reducing concentration risk over time.`,
    });
  }

  // Round 444 (AutoResearch): on_chain_fee_velocity — fees growing faster than TVL = expanding protocol margins
  // If fees_7d/tvl ratio is higher than fees_30d/tvl × 1.3, protocol is extracting more value per dollar locked
  const fees7dVelocity = safeNum(onchain.fees_7d ?? 0);
  const fees30dVelocity = safeNum(onchain.fees_30d ?? 0);
  const tvlVelocity = safeNum(onchain.tvl ?? 0);
  if (fees7dVelocity > 0 && fees30dVelocity > 0 && tvlVelocity > 1_000_000) {
    // Annualize: fees7d×52 vs fees30d×12 — if weekly rate accelerating
    const annualizedWeeklyRate = fees7dVelocity * 52;
    const annualizedMonthlyRate = fees30dVelocity * 12;
    if (annualizedWeeklyRate > annualizedMonthlyRate * 1.3 && fees7dVelocity > 50_000) {
      signals.push({
        signal: 'on_chain_fee_velocity',
        strength: annualizedWeeklyRate > annualizedMonthlyRate * 2 ? 'strong' : 'moderate',
        detail: `Weekly fee rate ($${(fees7dVelocity / 1000).toFixed(0)}K/wk) is ${((annualizedWeeklyRate / annualizedMonthlyRate - 1) * 100).toFixed(0)}% above monthly trend ($${(fees30dVelocity / 1000).toFixed(0)}K/mo ÷ 4 = ${(fees30dVelocity / 4000).toFixed(0)}K/wk) — fee extraction is accelerating, protocol utility growing faster than TVL.`,
      });
    }
  }

  // Round 439 (AutoResearch): multi_timeframe_momentum — 1h + 24h + 7d ALL positive = strong trend alignment
  // When short, medium, and long timeframes all confirm the trend, it's a high-conviction setup
  const mtf1h  = safeNum(market.price_change_pct_1h, NaN);
  const mtf24h = safeNum(market.price_change_pct_24h, NaN);
  const mtf7d_mtf = safeNum(market.price_change_pct_7d, NaN);
  if (Number.isFinite(mtf1h) && Number.isFinite(mtf24h) && Number.isFinite(mtf7d_mtf)) {
    if (mtf1h > 1 && mtf24h > 3 && mtf7d_mtf > 10) {
      signals.push({
        signal: 'multi_timeframe_momentum',
        strength: (mtf1h > 3 && mtf24h > 8 && mtf7d_mtf > 25) ? 'strong' : 'moderate',
        detail: `All timeframes aligned bullish: 1h +${mtf1h.toFixed(1)}%, 24h +${mtf24h.toFixed(1)}%, 7d +${mtf7d_mtf.toFixed(1)}% — multi-timeframe confirmation of uptrend.`,
      });
    } else if (mtf1h < -1 && mtf24h < -3 && mtf7d_mtf < -10) {
      signals.push({
        signal: 'multi_timeframe_bearish_alignment',
        strength: (mtf1h < -3 && mtf24h < -8 && mtf7d_mtf < -25) ? 'strong' : 'moderate',
        detail: `All timeframes aligned bearish: 1h ${mtf1h.toFixed(1)}%, 24h ${mtf24h.toFixed(1)}%, 7d ${mtf7d_mtf.toFixed(1)}% — multi-timeframe confirmation of downtrend. High risk.`,
      });
    }
  }

  // Round 440 (AutoResearch): momentum_score_alignment — alpha signal strength score correlates with price momentum
  // When oracle overall score is high AND price momentum is strong, it's a double-confirmation
  const oracleScore = safeNum(scores?.overall?.score, NaN);
  const momentumTier = market.price_momentum_tier;
  if (Number.isFinite(oracleScore) && oracleScore >= 7.0 && (momentumTier === 'strong_uptrend' || momentumTier === 'uptrend')) {
    signals.push({
      signal: 'score_momentum_alignment',
      strength: oracleScore >= 8.0 && momentumTier === 'strong_uptrend' ? 'strong' : 'moderate',
      detail: `Oracle score ${oracleScore.toFixed(1)}/10 + price momentum tier "${momentumTier}" — fundamental and technical alignment confirms high-conviction setup.`,
    });
  }

  // Round R10 (AutoResearch nightly): Wire in new R10 detectors
  const topTierCovSig = detectTopTierCoverage(rawData);
  if (topTierCovSig) signals.push(topTierCovSig);

  const momDivSig = detectMomentumDivergenceAlpha(rawData);
  if (momDivSig) signals.push(momDivSig);

  const liqQualSig = detectHighQualityLiquiditySetup(rawData);
  if (liqQualSig) signals.push(liqQualSig);

  // Round 384 (AutoResearch batch): new alpha detectors
  const tvlNearAthSig = detectTvlNearAth(rawData);
  if (tvlNearAthSig) signals.push(tvlNearAthSig);

  const microCapSig = detectMicroCapAlpha(rawData);
  if (microCapSig) signals.push(microCapSig);

  const deflationarySig = detectDeflationaryTokenomics(rawData);
  if (deflationarySig) signals.push(deflationarySig);

  // Round 66 (AutoResearch): Revenue vs market cap attractiveness — P/E-equivalent DeFi valuation
  const revVsMcapSig = detectRevenueVsMcapAttractiveness(rawData);
  if (revVsMcapSig) signals.push(revVsMcapSig);

  // Round 81 (AutoResearch): Sustained high volume-to-mcap signal
  const sustainedVolSig = detectSustainedVolumeAlpha(rawData);
  if (sustainedVolSig) signals.push(sustainedVolSig);

  // Round 82 (AutoResearch): Near-full distribution scarcity signal
  const nearFullDistSig = detectNearFullDistribution(rawData);
  if (nearFullDistSig) signals.push(nearFullDistSig);

  // Round 700 (AutoResearch batch): fee switch and cross-chain expansion signals
  const feeSwitchSig = detectFeeSwitch(rawData);
  if (feeSwitchSig) signals.push(feeSwitchSig);
  const crossChainSig = detectCrossChainExpansion(rawData);
  if (crossChainSig) signals.push(crossChainSig);

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
  
  // CONVICTION_SCORE: 5+ strong signals = composite conviction
  const strongCount = signals.filter(s => s.strength === 'strong').length;
  let bonus = 0;
  if (strongCount >= 5) {
    bonus += 10 * (strongCount - 4); // +10 per ogni strong oltre il 4°
  }

  // Round 441: theme clustering bonus — 3+ signals in same theme = correlated conviction
  // Themes: onchain (tvl/fees/revenue), social (sentiment/kol/narrative), technical (price/volume/momentum)
  const themeMap = {
    tvl_growth_spike: 'onchain', cross_chain_tvl_growth: 'onchain', tvl_acceleration: 'onchain',
    revenue_generating: 'onchain', high_fee_efficiency: 'onchain', fee_revenue_acceleration: 'onchain',
    strong_revenue_capture: 'onchain', revenue_momentum: 'onchain', fee_switch_candidate: 'onchain',
    veteran_protocol_strong_fees: 'onchain', low_price_to_tvl: 'onchain', ptvl_deep_value: 'onchain',
    strong_positive_sentiment: 'social', kol_bullish_x_sentiment: 'social', x_vs_web_bullish_divergence: 'social',
    accelerating_news_coverage: 'social', news_acceleration: 'social', social_velocity_spike: 'social',
    fresh_narrative_momentum: 'social', strong_narrative_alignment: 'social', partnership_news: 'social',
    institutional_interest: 'social', airdrop_catalyst: 'social',
    volume_spike_no_price_move: 'technical', near_ath_breakout: 'technical', ath_breakout: 'technical',
    ma7_breakout_with_volume: 'technical', dex_buy_pressure: 'technical', dex_momentum_burst: 'technical',
    volume_surge: 'technical', organic_volume_spike: 'technical', multi_timeframe_momentum: 'technical',
    smart_accumulation_pattern: 'technical', volume_spike_buy_pressure: 'technical',
    price_volume_divergence_bullish: 'technical', '52w_high_breakout': 'technical',
  };
  const themeCounts = {};
  for (const s of signals) {
    const theme = themeMap[s.signal];
    if (theme) themeCounts[theme] = (themeCounts[theme] ?? 0) + 1;
  }
  for (const count of Object.values(themeCounts)) {
    if (count >= 3) bonus += 8; // 3+ aligned signals in a theme = +8 pts
  }
  
  return Math.min(100, raw + bonus);
}

// Round 231 (AutoResearch nightly): Long-term holder signal — price well above ATH set long ago (reset pattern)
// If ATH is old AND price change over 1y is strongly positive, it suggests a true base breakout
export function detectLongTermHolderSignal(market = {}) {
  const c1y = Number(market.price_change_pct_1y ?? NaN);
  const athRecency = market.ath_recency;
  const change7d = Number(market.price_change_pct_7d ?? 0);
  if (!Number.isFinite(c1y) || c1y < 100) return null;
  if (athRecency === 'old_ath' || athRecency === 'moderate_ath') {
    if (change7d > 5) {
      return {
        signal: 'long_term_reset_breakout',
        strength: c1y > 500 ? 'strong' : 'moderate',
        detail: `+${c1y.toFixed(0)}% over 1 year with old ATH and +${change7d.toFixed(1)}% 7d — possible fresh breakout from long-term base.`,
      };
    }
  }
  return null;
}

// Round 234 (AutoResearch): FDV/MCap efficiency signal
// When FDV is close to MCap (>80% circulating), token is near full dilution = lower inflation risk
export function detectFdvEfficiencySignal(market = {}) {
  const mcap = Number(market.market_cap ?? 0);
  const fdv = Number(market.fully_diluted_valuation ?? 0);
  if (mcap <= 0 || fdv <= 0) return null;
  const ratio = mcap / fdv;
  if (ratio >= 0.8 && mcap > 5_000_000) {
    return {
      signal: 'low_fdv_inflation_risk',
      strength: ratio >= 0.95 ? 'strong' : 'moderate',
      detail: `MCap/FDV ratio ${(ratio * 100).toFixed(0)}% — ${(ratio * 100).toFixed(0)}% of supply already circulating, minimal future inflation dilution risk.`,
    };
  }
  return null;
}

// ─── Round 238 (AutoResearch nightly): New alpha signals ─────────────────────

/**
 * Detect near-ATH breakout signal — price within 5% of ATH is a momentum breakout zone.
 * Added to detectAlphaSignals via patch below.
 */
export function detectNearAthBreakout(rawData = {}) {
  const market = rawData.market ?? {};
  const athDist = Number(market.ath_distance_pct ?? NaN);
  if (!Number.isFinite(athDist)) return null;
  if (athDist >= -5 && athDist < 0) {
    return {
      signal: 'near_ath_breakout_attempt',
      strength: athDist >= -2 ? 'strong' : 'moderate',
      detail: `Price within ${Math.abs(athDist).toFixed(1)}% of ATH — breakout zone with strong momentum confirmation potential.`,
    };
  }
  return null;
}

/**
 * Revenue acceleration signal: revenue growing faster than TVL over 30d.
 */
export function detectRevenueAcceleration(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  if (onchain.fee_revenue_acceleration !== 'accelerating') return null;
  const fees7d = Number(onchain.fees_7d ?? 0);
  if (fees7d < 10_000) return null; // Min threshold for signal credibility
  return {
    signal: 'revenue_acceleration',
    strength: fees7d > 1_000_000 ? 'strong' : 'moderate',
    detail: `Protocol revenue is growing faster than TVL (fee_revenue_acceleration: accelerating). Weekly fees: $${fees7d.toLocaleString('en-US', { maximumFractionDigits: 0 })} — expanding margin signal.`,
  };
}

/**
 * Multi-chain expansion alpha: recently added to new chains = growth catalyst.
 */
export function detectMultichainExpansion(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  const chainCount = Array.isArray(onchain.chains) ? onchain.chains.length : 0;
  const tvl = Number(onchain.tvl ?? 0);
  if (chainCount >= 5 && tvl > 50_000_000) {
    return {
      signal: 'deep_multichain_presence',
      strength: chainCount >= 8 ? 'strong' : 'moderate',
      detail: `Deployed on ${chainCount} chains with $${(tvl / 1e6).toFixed(1)}M TVL — deep ecosystem integration reduces platform risk.`,
    };
  }
  return null;
}

// ─── Round 238b (AutoResearch nightly): P/TVL undervaluation signal ───────────

/**
 * P/TVL deep value signal: MCap < TVL = market pricing protocol below its locked value.
 * Classic DeFi "buy below book" opportunity signal.
 */
export function detectPtvlUndervaluation(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  const market = rawData.market ?? {};
  const tvl = Number(onchain.tvl ?? 0);
  const mcap = Number(market.market_cap ?? 0);
  if (tvl <= 0 || mcap <= 0 || tvl < 1_000_000) return null;
  const ptvl = mcap / tvl;
  if (ptvl < 0.5) {
    return {
      signal: 'ptvl_deep_value',
      strength: ptvl < 0.2 ? 'strong' : 'moderate',
      detail: `P/TVL ratio ${ptvl.toFixed(3)} — market cap ($${(mcap / 1e6).toFixed(1)}M) is below locked TVL ($${(tvl / 1e6).toFixed(1)}M). Historically a DeFi deep value entry zone.`,
    };
  }
  return null;
}

// ─── Round 356 (AutoResearch batch): New alpha signal detectors ───────────────

/**
 * Detect fee-switch activation or revenue-sharing announcement.
 * A protocol turning on fees is a strong tokenomics catalyst.
 */
export function detectFeeSwitchMomentum(rawData = {}) {
  const social = rawData.social ?? {};
  const narratives = Array.isArray(social.key_narratives) ? social.key_narratives : [];
  const hasFeeSwitch = narratives.some(n =>
    /fee.?switch|revenue.?shar|fee.?distribut|token.?buyback|yield.?token/i.test(n)
  );
  const fees7d = Number(rawData.onchain?.fees_7d ?? 0);
  if (hasFeeSwitch && fees7d > 0) {
    return {
      signal: 'fee_switch_momentum',
      strength: fees7d > 500_000 ? 'strong' : 'moderate',
      detail: `Fee-switch or revenue-sharing narrative detected in social mentions with $${(fees7d / 1000).toFixed(0)}K weekly fees — potential catalyst for token accrual.`,
    };
  }
  return null;
}

/**
 * Detect strong TVL inflow acceleration vs prior period.
 * TVL growing faster than its own 30d trend = institutional accumulation signal.
 */
export function detectTvlAcceleration(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  const tvl7d = Number(onchain.tvl_change_7d ?? NaN);
  const tvl30d = Number(onchain.tvl_change_30d ?? NaN);
  if (!Number.isFinite(tvl7d) || !Number.isFinite(tvl30d)) return null;
  const tvl = Number(onchain.tvl ?? 0);
  // 7d annualized rate faster than 30d annualized rate by >2x
  const annualized7d = tvl7d * 52;
  const annualized30d = tvl30d * 12;
  if (tvl > 5_000_000 && tvl7d > 5 && annualized7d > annualized30d * 2) {
    return {
      signal: 'tvl_acceleration',
      strength: tvl7d > 20 ? 'strong' : 'moderate',
      detail: `TVL growing at ${tvl7d.toFixed(1)}% weekly vs ${tvl30d.toFixed(1)}% monthly average — acceleration suggests fresh capital inflow, not just organic growth.`,
    };
  }
  return null;
}

/**
 * Round 381 (AutoResearch): Detect recent ATH as momentum confirmation signal.
 * A token setting a new ATH (or near ATH) within the last 30 days is in price discovery.
 * This is one of the strongest momentum signals in crypto markets.
 */
export function detectRecentAthMomentum(rawData = {}) {
  const market = rawData.market ?? {};
  const daysSinceAth = market.days_since_ath;
  const athRecency = market.ath_recency;
  const athDistancePct = Number(market.ath_distance_pct ?? -100);
  if (daysSinceAth == null) return null;
  // Within 30 days of ATH = strong momentum signal
  if (daysSinceAth <= 30) {
    return {
      signal: 'recent_ath_momentum',
      strength: daysSinceAth <= 7 ? 'strong' : 'moderate',
      detail: `New ATH set ${daysSinceAth}d ago — token is in active price discovery. Strong institutional and retail confirmation.`,
    };
  }
  // Within 90 days and still within 5% of ATH = near-ATH consolidation (potential breakout)
  if (daysSinceAth <= 90 && athDistancePct >= -5) {
    return {
      signal: 'ath_consolidation',
      strength: 'moderate',
      detail: `ATH set ${daysSinceAth}d ago, price ${Math.abs(athDistancePct).toFixed(1)}% below ATH — consolidating near highs, potential breakout zone.`,
    };
  }
  return null;
}

/**
 * Round 382 (AutoResearch): Detect wash-trading-free high volume — organic volume surge.
 * Volume spike WITHOUT wash trading risk = genuine demand signal.
 */
export function detectOrganicVolumeSpike(rawData = {}) {
  const market = rawData.market ?? {};
  const dex = rawData.dex ?? {};
  const mcap = Number(market.market_cap ?? 0);
  const vol = Number(market.total_volume ?? 0);
  const vol7dAvg = Number(market.volume_7d_avg ?? 0);
  if (mcap <= 0 || vol <= 0) return null;
  // Wash trading risk must be low to qualify as organic
  if (dex.wash_trading_risk && dex.wash_trading_risk !== 'low') return null;
  const velPct = (vol / mcap) * 100;
  const spikeMultiple = vol7dAvg > 0 ? vol / vol7dAvg : 0;
  if (velPct >= 20 && spikeMultiple >= 3) {
    return {
      signal: 'organic_volume_spike',
      strength: velPct >= 50 ? 'strong' : 'moderate',
      detail: `Volume at ${velPct.toFixed(1)}% of MCap (${spikeMultiple.toFixed(1)}x 7d avg) with no wash trading detected — organic demand surge. Median trade size $${dex.median_trade_size_usd?.toFixed(2) ?? 'n/a'} indicates retail/institutional buys.`,
    };
  }
  return null;
}

/**
 * Detect governance activity surge — proposals, votes, DAO participation.
 */
export function detectGovernanceSurge(rawData = {}) {
  const social = rawData.social ?? {};
  const narratives = Array.isArray(social.key_narratives) ? social.key_narratives : [];
  const hasGovernance = narratives.some(n =>
    /governance|dao vote|proposal|on-chain vote|snapshot vote|protocol upgrade/i.test(n)
  );
  if (!hasGovernance) return null;
  const sentiment = Number(social.sentiment_score ?? 0);
  if (hasGovernance && sentiment > 0.2) {
    return {
      signal: 'governance_momentum',
      strength: sentiment > 0.5 ? 'strong' : 'moderate',
      detail: `Active governance/DAO activity detected in social narratives with positive sentiment (${sentiment.toFixed(2)}) — community engagement and protocol direction clarity can drive price discovery.`,
    };
  }
  return null;
}

// ─── Round 383 (AutoResearch): Stale narrative decay detection ───────────────
/**
 * Detect when a bullish narrative is fading (narrative freshness declining).
 * A stale narrative with declining social activity = momentum exhaustion signal.
 * NOT an alpha buy signal, but surfaced here for cross-signal context.
 */
export function detectNarrativeDecay(rawData = {}) {
  const social = rawData.social ?? {};
  const freshness = Number(social.narrative_freshness_score ?? NaN);
  const mentions = Number(social.filtered_mentions ?? social.mentions ?? 0);
  const sentiment = Number(social.sentiment_score ?? 0);
  if (!Number.isFinite(freshness)) return null;
  // Stale + still positive sentiment + declining mentions = narrative exhaustion
  if (freshness < 20 && sentiment > 0.1 && mentions > 0 && mentions < 10) {
    return {
      signal: 'narrative_exhaustion',
      strength: 'weak',
      detail: `Narrative freshness score ${freshness}/100 with only ${mentions} mentions — bullish narrative appears stale. Social momentum may be exhausted despite positive sentiment.`,
    };
  }
  return null;
}

// ─── Round 383 (AutoResearch): Low circulating + strong momentum combination ─
/**
 * Detect low-float momentum: low circulating supply + strong price momentum.
 * Low-float tokens can move explosively when volume arrives because there are
 * fewer tokens available for sale — classic supply-demand imbalance.
 */
export function detectLowFloatMomentum(rawData = {}) {
  const market = rawData.market ?? {};
  const tokenomics = rawData.tokenomics ?? {};
  const pctCirculating = Number(tokenomics.pct_circulating ?? market.circulating_to_max_ratio != null ? (market.circulating_to_max_ratio ?? 0) * 100 : NaN);
  const momentum = market.price_momentum_tier;
  const vol = Number(market.total_volume ?? 0);
  const mcap = Number(market.market_cap ?? 0);
  if (!Number.isFinite(pctCirculating) || pctCirculating <= 0) return null;
  if (pctCirculating < 25 && (momentum === 'strong_uptrend' || momentum === 'uptrend') && mcap > 10_000_000) {
    const velPct = mcap > 0 ? (vol / mcap) * 100 : 0;
    return {
      signal: 'low_float_momentum',
      strength: pctCirculating < 15 ? 'strong' : 'moderate',
      detail: `Only ${pctCirculating.toFixed(1)}% of supply circulating with ${momentum} momentum — low-float structure amplifies price moves. Volume velocity ${velPct.toFixed(1)}% of MCap.`,
    };
  }
  return null;
}

// ─── Round R10 (AutoResearch nightly): New alpha signal detectors ─────────────

/**
 * Top-tier media coverage signal: multiple Tier-1 sources covering the project.
 * CoinDesk/Bloomberg/Blockworks coverage is a strong legitimacy + interest signal.
 */
export function detectTopTierCoverage(rawData = {}) {
  const social = rawData.social ?? {};
  const topTierCount = Number(social.top_tier_source_count ?? 0);
  if (topTierCount >= 3) {
    return {
      signal: 'top_tier_media_coverage',
      strength: topTierCount >= 5 ? 'strong' : 'moderate',
      detail: `${topTierCount} articles from Tier-1 crypto news sources (CoinDesk/Bloomberg/Blockworks etc.) — institutional-grade coverage signals legitimacy and market awareness.`,
    };
  }
  return null;
}

/**
 * Momentum divergence alpha: short-term momentum significantly stronger than long-term.
 * Positive divergence (24h accelerating vs 30d trend) = fresh catalyst driving price.
 */
export function detectMomentumDivergenceAlpha(rawData = {}) {
  const market = rawData.market ?? {};
  const divergence = Number(market.momentum_divergence ?? NaN);
  const priceChange24h = Number(market.price_change_pct_24h ?? 0);
  if (!Number.isFinite(divergence)) return null;
  // Strong positive divergence + actual positive 24h move = fresh momentum
  if (divergence > 500 && priceChange24h > 5) {
    return {
      signal: 'short_term_momentum_acceleration',
      strength: divergence > 2000 ? 'strong' : 'moderate',
      detail: `Momentum divergence: +${divergence.toFixed(0)} — 24h momentum accelerating well above 30d trend (${priceChange24h.toFixed(1)}% today vs ${(market.price_change_pct_30d ?? 0).toFixed(1)}% 30d). Fresh catalyst driving price discovery.`,
    };
  }
  return null;
}

/**
 * Detect liquidity trap avoidance: deep liquidity + low concentration + buy pressure.
 * This combination means you can enter AND exit without moving the market against you.
 */
export function detectHighQualityLiquiditySetup(rawData = {}) {
  const dex = rawData.dex ?? {};
  const market = rawData.market ?? {};
  const liq = Number(dex.dex_liquidity_usd ?? 0);
  const topPairLiqPct = Number(dex.top_pair_liquidity_pct ?? 100);
  const buySellRatio = Number(dex.buy_sell_ratio ?? 1);
  const mcap = Number(market.market_cap ?? 0);
  if (liq >= 1_000_000 && topPairLiqPct < 70 && buySellRatio > 1.1 && mcap > 0) {
    const liqToMcapPct = (liq / mcap) * 100;
    if (liqToMcapPct >= 2) {
      return {
        signal: 'high_quality_liquidity',
        strength: liq >= 5_000_000 ? 'strong' : 'moderate',
        detail: `$${(liq / 1e6).toFixed(1)}M DEX liquidity across multiple pools (largest pool ${topPairLiqPct.toFixed(0)}%), buy pressure ${buySellRatio.toFixed(2)}x. High liquidity-to-MCap ratio ${liqToMcapPct.toFixed(1)}% enables position entry/exit without slippage.`,
      };
    }
  }
  return null;
}

// ─── Round 384 (AutoResearch batch): New alpha detectors ─────────────────────

/**
 * R384-1: TVL near all-time-high signal — protocol near its maximum historical TVL
 * suggests strong fundamental momentum and market confidence.
 */
export function detectTvlNearAth(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  const tvlVsAthPct = Number(onchain.tvl_vs_ath_pct ?? NaN);
  const tvl = Number(onchain.tvl ?? 0);
  if (!Number.isFinite(tvlVsAthPct) || tvl < 1_000_000) return null;
  if (tvlVsAthPct >= -10 && tvlVsAthPct <= 5) {
    return {
      signal: 'tvl_near_ath',
      strength: tvlVsAthPct >= -5 ? 'strong' : 'moderate',
      detail: `Protocol TVL within ${Math.abs(tvlVsAthPct).toFixed(1)}% of its all-time-high (${(tvl / 1e6).toFixed(1)}M locked) — capital confidence at peak levels.`,
    };
  }
  return null;
}

/**
 * R384-2: Micro-cap with strong fundamentals — small cap + top-tier dev + positive sentiment
 * is the classic early alpha setup before larger market awareness.
 */
export function detectMicroCapAlpha(rawData = {}) {
  const market = rawData.market ?? {};
  const github = rawData.github ?? {};
  const social = rawData.social ?? {};
  const mcap = Number(market.market_cap ?? 0);
  // Micro-cap: $1M - $50M range
  if (mcap < 1_000_000 || mcap > 50_000_000) return null;
  const commits90d = Number(github.commits_90d ?? 0);
  const sentimentScore = Number(social.sentiment_score ?? 0);
  // Need strong dev + positive sentiment to qualify
  if (commits90d >= 20 && sentimentScore > 0.3) {
    return {
      signal: 'micro_cap_strong_fundamentals',
      strength: commits90d >= 50 && sentimentScore > 0.5 ? 'strong' : 'moderate',
      detail: `Micro-cap ($${(mcap / 1e6).toFixed(1)}M MCap) with active dev (${commits90d} commits/90d) and positive sentiment (${sentimentScore.toFixed(2)}) — potential undiscovered alpha.`,
    };
  }
  return null;
}

/**
 * R384-3: Deflationary tokenomics signal — negative inflation rate with real supply burning.
 */
export function detectDeflationaryTokenomics(rawData = {}) {
  const tokenomics = rawData.tokenomics ?? {};
  const inflationRate = Number(tokenomics.inflation_rate ?? NaN);
  const pctCirculating = Number(tokenomics.pct_circulating ?? 0);
  if (!Number.isFinite(inflationRate) || inflationRate >= 0) return null;
  if (pctCirculating > 50) { // meaningful deflationary signal needs reasonable circulation
    return {
      signal: 'deflationary_tokenomics',
      strength: inflationRate <= -3 && pctCirculating >= 70 ? 'strong' : 'moderate',
      detail: `Deflationary token: ${inflationRate.toFixed(1)}%/yr inflation with ${pctCirculating.toFixed(0)}% circulating — net supply contraction creates structural scarcity premium.`,
    };
  }
  return null;
}

/**
 * Round 66 (AutoResearch): Revenue vs market cap attractiveness signal.
 * When annualized protocol revenue > 5% of market cap, the token is attractively priced
 * on a DeFi P/E-equivalent basis (the market is pricing it at <20x annualized revenue).
 * Strong: annualized revenue > 10% of mcap (price = 10x revenue or less).
 */
export function detectRevenueVsMcapAttractiveness(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  const market = rawData.market ?? {};

  const revenue7d = Number(onchain.revenue_7d ?? NaN);
  const mcap = Number(market.market_cap ?? NaN);

  if (!Number.isFinite(revenue7d) || revenue7d <= 0) return null;
  if (!Number.isFinite(mcap) || mcap <= 0) return null;

  const annualizedRevenue = revenue7d * 52;
  const revenueYield = annualizedRevenue / mcap;

  if (revenueYield >= 0.10) {
    return {
      signal: 'revenue_vs_mcap_attractive',
      strength: 'strong',
      detail: `P/Revenue ratio ${(1 / revenueYield).toFixed(1)}x — annualized revenue $${(annualizedRevenue / 1e6).toFixed(1)}M vs $${(mcap / 1e6).toFixed(0)}M mcap (${(revenueYield * 100).toFixed(1)}% yield). Deeply undervalued on revenue basis.`,
    };
  } else if (revenueYield >= 0.05) {
    return {
      signal: 'revenue_vs_mcap_attractive',
      strength: 'moderate',
      detail: `P/Revenue ratio ${(1 / revenueYield).toFixed(1)}x — annualized revenue $${(annualizedRevenue / 1e6).toFixed(1)}M vs $${(mcap / 1e6).toFixed(0)}M mcap (${(revenueYield * 100).toFixed(1)}% yield). Attractive relative to DeFi peers.`,
    };
  }
  return null;
}

/**
 * Round 81 (AutoResearch): Sustained high volume-to-mcap signal.
 * Filters single-day volume spikes by checking that the token also shows
 * meaningful 7d price movement (confirming organic trading interest).
 */
export function detectSustainedVolumeAlpha(rawData = {}) {
  const market = rawData.market ?? {};
  const vol = Number(market.total_volume ?? NaN);
  const mcap = Number(market.market_cap ?? NaN);
  const change7d = Number(market.price_change_pct_7d ?? NaN);
  const volSpikeFlag = market.volume_spike_flag;

  if (!Number.isFinite(vol) || !Number.isFinite(mcap) || mcap <= 0) return null;
  const ratio = vol / mcap;

  // Require meaningful 7d activity AND volume ratio — filters single-day pumps
  if (ratio >= 0.15 && Number.isFinite(change7d) && Math.abs(change7d) > 5 && volSpikeFlag !== 'extreme_spike') {
    return {
      signal: 'sustained_high_volume_to_mcap',
      strength: ratio >= 0.3 ? 'strong' : 'moderate',
      detail: `Vol/MCap ratio ${ratio.toFixed(2)} with ${change7d > 0 ? '+' : ''}${change7d.toFixed(1)}% 7d price move — sustained elevated trading interest, not a one-day spike.`,
    };
  }
  return null;
}

/**
 * Round 82 (AutoResearch): Near-full distribution signal.
 * When a token is approaching full circulation (>85%) with low inflation,
 * supply scarcity becomes a structural tailwind.
 */
export function detectNearFullDistribution(rawData = {}) {
  const tokenomics = rawData.tokenomics ?? {};
  const pctCirculating = Number(tokenomics.pct_circulating ?? NaN);
  const inflationRate = Number(tokenomics.inflation_rate ?? NaN);

  if (!Number.isFinite(pctCirculating) || pctCirculating < 85) return null;
  // Require low or negative inflation to confirm scarcity signal
  if (Number.isFinite(inflationRate) && inflationRate > 5) return null; // high inflation cancels out

  return {
    signal: 'near_full_distribution',
    strength: pctCirculating >= 95 && (!Number.isFinite(inflationRate) || inflationRate <= 0) ? 'strong' : 'moderate',
    detail: `${pctCirculating.toFixed(0)}% of supply is circulating${Number.isFinite(inflationRate) ? ` with ${inflationRate.toFixed(1)}%/yr inflation` : ''} — minimal future dilution, supply scarcity is a structural tailwind.`,
  };
}

// ─── Round 700 (AutoResearch batch): New alpha signal detectors ───────────────

/**
 * R700-A: Protocol fee switch signal — when a protocol activates token buybacks
 * or redirects fees to token holders, it creates a strong fundamental catalyst.
 */
export function detectFeeSwitch(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  const social = rawData.social ?? {};
  const narratives = Array.isArray(social.key_narratives) ? social.key_narratives : [];
  const narrativesStr = narratives.join(' ').toLowerCase();
  const revenueToFeesRatio = Number(onchain.revenue_to_fees_ratio ?? NaN);

  // Revenue-to-fees ratio approaching 1.0 = near-full fee capture = approaching fee switch
  const highCapture = Number.isFinite(revenueToFeesRatio) && revenueToFeesRatio >= 0.7;
  const feeSwitchMention = /fee switch|buyback|revenue distribution|protocol revenue sharing|staker reward/.test(narrativesStr);

  if (highCapture && feeSwitchMention) {
    return {
      signal: 'fee_switch_catalyst',
      strength: 'strong',
      detail: `Fee capture ratio ${(revenueToFeesRatio * 100).toFixed(0)}% + "fee switch" narrative in social — strong catalyst: protocol revenue increasingly flowing to token holders.`,
    };
  }
  if (feeSwitchMention && Number.isFinite(onchain.fees_7d) && onchain.fees_7d > 0) {
    return {
      signal: 'fee_switch_catalyst',
      strength: 'moderate',
      detail: `"Fee switch / buyback" narrative active in social with $${(onchain.fees_7d / 1e3).toFixed(0)}K weekly protocol fees — fee redistribution catalyst materializing.`,
    };
  }
  return null;
}

/**
 * R700-B: Cross-chain expansion signal — when a protocol rapidly expands to new chains,
 * it signals TAM expansion and often drives a new wave of liquidity and users.
 */
export function detectCrossChainExpansion(rawData = {}) {
  const ecosystem = rawData.ecosystem ?? {};
  const dex = rawData.dex ?? {};
  const chainCount = Number(ecosystem.chain_count ?? NaN);
  const dexChains = Array.isArray(dex.dex_chains) ? dex.dex_chains.length : 0;
  const tvl7d = Number((rawData.onchain ?? {}).tvl_change_7d ?? NaN);

  const effectiveChains = Math.max(chainCount || 0, dexChains);
  if (effectiveChains >= 5) {
    const strength = effectiveChains >= 10 ? 'strong' : 'moderate';
    const tvlBonus = Number.isFinite(tvl7d) && tvl7d > 10 ? ` with +${tvl7d.toFixed(0)}% TVL growth` : '';
    return {
      signal: 'cross_chain_expansion',
      strength,
      detail: `Protocol deployed on ${effectiveChains} chains${tvlBonus} — multi-chain presence dramatically expands addressable liquidity and user base. Network effect compounding.`,
    };
  }
  return null;
}
