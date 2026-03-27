import { safeNum } from '../utils/math.js';
/**
 * red-flags.js — Round 14
 * Detects qualitative red flags from raw scanner data and scores.
 */


/**
 * Detect red flags in a project scan.
 * @param {object} rawData - raw collector data keyed by section (market, onchain, social, github, tokenomics, dex, holders)
 * @param {object} scores  - calculateScores() result
 * @returns {Array<{flag: string, severity: 'critical'|'warning'|'info', detail: string}>}
 */
export function detectRedFlags(rawData = {}, scores = {}) {
  const flags = [];
  const market     = rawData.market     ?? {};
  const onchain    = rawData.onchain    ?? {};
  const social     = rawData.social     ?? {};
  const github     = rawData.github     ?? {};
  const tokenomics = rawData.tokenomics ?? {};

  // 1. Project age < 6 months
  const genesisDate = market.genesis_date ?? tokenomics.genesis_date;
  if (genesisDate) {
    const ageMs = Date.now() - new Date(genesisDate).getTime();
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonths < 6) {
      flags.push({
        flag: 'young_project',
        severity: ageMonths < 2 ? 'critical' : 'warning',
        detail: `Project is only ${ageMonths.toFixed(1)} months old — track record limited.`,
      });
    }
  }

  // 2. Market cap < $1M
  const mcap = safeNum(market.market_cap);
  if (mcap > 0 && mcap < 1_000_000) {
    flags.push({
      flag: 'low_market_cap',
      severity: 'critical',
      detail: `Market cap $${(mcap / 1000).toFixed(0)}K is below $1M — extremely illiquid and volatile.`,
    });
  }

  // 3. No GitHub repo
  // Round 338 (AutoResearch): use null check instead of falsy — stars=0 or commits=0 is real data, not missing
  if (github.error || (github.stars == null && github.commits_90d == null && github.contributors == null)) {
    flags.push({
      flag: 'no_github',
      severity: 'warning',
      detail: 'No GitHub repository data found — development activity unverifiable.',
    });
  }

  // 4. Whale concentration > 30%
  const holders = rawData.holders ?? rawData.holderData ?? {};
  // Round 345 (AutoResearch): include collector field name in fallback chain
  const whaleConcentration = safeNum(holders.top10_concentration ?? holders.concentration_pct ?? holders.top10_holder_concentration_pct);
  if (whaleConcentration > 30) {
    flags.push({
      flag: 'whale_concentration',
      severity: whaleConcentration > 60 ? 'critical' : 'warning',
      detail: `Top-10 wallets hold ${whaleConcentration.toFixed(1)}% of supply — concentration risk.`,
    });
  }

  // 5. No onchain data
  // Round 339 (AutoResearch): use null check — tvl=0 is valid data (new protocol), not missing data
  if (onchain.error || (onchain.tvl == null && onchain.tvl_change_7d == null && onchain.fees_7d == null)) {
    flags.push({
      flag: 'no_onchain_data',
      severity: 'info',
      detail: 'No onchain (DeFiLlama/similar) data available — protocol health unverifiable.',
    });
  }

  // 6. Declining TVL > 30%
  // Round 356 (AutoResearch): also check null — safeNum(undefined) = 0 which would not trigger,
  // but we only want to check if the field was actually provided
  const tvlChange7d  = onchain.tvl_change_7d  != null ? safeNum(onchain.tvl_change_7d)  : 0;
  const tvlChange30d = onchain.tvl_change_30d != null ? safeNum(onchain.tvl_change_30d) : 0;
  const hasTvlChangeData = onchain.tvl_change_7d != null || onchain.tvl_change_30d != null;
  if (hasTvlChangeData && (tvlChange7d < -30 || tvlChange30d < -30)) {
    const worst = Math.min(tvlChange7d, tvlChange30d);
    flags.push({
      flag: 'declining_tvl',
      severity: worst < -70 ? 'critical' : worst < -50 ? 'warning' : 'warning',
      detail: `TVL has declined ${Math.abs(worst).toFixed(1)}% recently — ${worst < -70 ? 'catastrophic TVL collapse' : 'protocol losing traction'}.`,
    });
  }

  // 7. Volume < $50K
  const volume = safeNum(market.total_volume);
  if (volume > 0 && volume < 50_000) {
    flags.push({
      flag: 'low_volume',
      severity: 'warning',
      detail: `24h trading volume $${(volume / 1000).toFixed(1)}K is very low — liquidity risk.`,
    });
  }

  // 8. All social sentiment bearish
  const bullish = safeNum(social.sentiment_counts?.bullish);
  const bearish  = safeNum(social.sentiment_counts?.bearish);
  const sentScore = safeNum(social.sentiment_score, NaN);
  const allBearish = (bullish === 0 && bearish > 0) ||
    (Number.isFinite(sentScore) && sentScore < -0.5);
  if (allBearish) {
    flags.push({
      flag: 'bearish_sentiment',
      severity: 'warning',
      detail: `Social sentiment is overwhelmingly bearish (score: ${Number.isFinite(sentScore) ? sentScore.toFixed(2) : 'n/a'}, bullish: ${bullish}, bearish: ${bearish}).`,
    });
  }

  // 9. No license on GitHub
  if (!github.error && github.stars != null && !github.license) {
    flags.push({
      flag: 'no_license',
      severity: 'info',
      detail: 'GitHub repository has no detected license — legal use unclear.',
    });
  }

  // 10. FDV/MCap > 10x
  const fdv = safeNum(market.fully_diluted_valuation ?? market.fdv);
  if (fdv > 0 && mcap > 0) {
    const fdvRatio = fdv / mcap;
    if (fdvRatio > 10) {
      flags.push({
        flag: 'extreme_fdv_ratio',
        severity: 'critical',
        detail: `FDV/MCap ratio is ${fdvRatio.toFixed(1)}x — massive token unlock overhang, severe dilution risk.`,
      });
    }
  }

  // 11. Round 5: GitHub inactive (commit_trend === 'inactive')
  if (github.commit_trend === 'inactive') {
    flags.push({
      flag: 'github_inactive',
      severity: 'warning',
      detail: `GitHub shows 0 commits in the last 30 days — development appears halted.`,
    });
  }

  // 12. Round 5: Severe price decline > 50% in 30d
  const change30d = safeNum(market.price_change_pct_30d);
  if (change30d < -50) {
    flags.push({
      flag: 'severe_price_decline',
      severity: 'critical',
      detail: `Price has declined ${Math.abs(change30d).toFixed(1)}% over 30 days — potential capitulation or fundamental failure.`,
    });
  }

  // 13. Round 5: Stablecoin depeg signal (price < $0.90 for named stablecoins)
  const tokenName = String(market.name || market.symbol || '').toLowerCase();
  const isStablecoin = /usd|dai|usdt|usdc|frax|tusd|lusd|susd|busd|crvusd|usde/i.test(tokenName);
  const price = safeNum(market.current_price ?? market.price);
  if (isStablecoin && price > 0 && (price < 0.96 || price > 1.04)) {
    flags.push({
      flag: 'stablecoin_depeg',
      severity: price < 0.90 || price > 1.10 ? 'critical' : 'warning',
      detail: `Stablecoin is trading at $${price.toFixed(4)} — ${price < 0.96 ? 'below' : 'above'} normal peg range of $0.96–$1.04.`,
    });
  }

  // 14. Round 4: Persistent DEX sell pressure (more sellers than buyers)
  const dex = rawData.dex ?? rawData.dexData ?? {};
  if (dex.pressure_signal === 'sell_pressure' && dex.buy_sell_ratio != null) {
    flags.push({
      flag: 'dex_sell_pressure',
      severity: dex.buy_sell_ratio <= 0.7 ? 'warning' : 'info',
      detail: `DEX buy/sell ratio is ${dex.buy_sell_ratio} — more sellers than buyers in 24h (${dex.sells_24h} sells vs ${dex.buys_24h} buys).`,
    });
  }

  // 15. Round 4: Extremely low DEX liquidity (< $50K)
  const dexLiquidity = safeNum(dex.dex_liquidity_usd ?? 0);
  if (dexLiquidity > 0 && dexLiquidity < 50_000) {
    flags.push({
      flag: 'very_low_dex_liquidity',
      severity: dexLiquidity < 10_000 ? 'critical' : 'warning',
      detail: `Total DEX liquidity is only $${(dexLiquidity / 1000).toFixed(1)}K — extreme slippage risk on any meaningful position.`,
    });
  }

  // 16. Round 4: Extremely high top-pair liquidity concentration (>90%)
  const topPairLiqPct = safeNum(dex.top_pair_liquidity_pct ?? 0);
  if (topPairLiqPct > 90 && dexLiquidity > 100_000) {
    flags.push({
      flag: 'single_pool_liquidity_concentration',
      severity: 'warning',
      detail: `${topPairLiqPct.toFixed(0)}% of DEX liquidity is concentrated in one pool — fragile liquidity profile.`,
    });
  }

  // 17. Round 18: High team allocation — potential insider sell pressure
  const vestingInfo = tokenomics.vesting_info;
  const teamAllocationPct = safeNum(vestingInfo?.team_allocation_pct ?? 0);
  if (teamAllocationPct > 25) {
    flags.push({
      flag: 'high_team_allocation',
      severity: teamAllocationPct > 40 ? 'critical' : 'warning',
      detail: `Team/insider allocation is ${teamAllocationPct.toFixed(0)}% of supply — elevated sell pressure risk when vesting unlocks.`,
    });
  }

  // Round 220 (AutoResearch): use unlock_risk_label from tokenomics collector for quick composite check
  // This catches critical unlock risk even when vesting_info isn't available (uses pct_circulating + overhang)
  const unlockRiskLabel = tokenomics.unlock_risk_label;
  const overhangPct = safeNum(tokenomics.unlock_overhang_pct ?? 0);
  if (unlockRiskLabel === 'critical' && teamAllocationPct <= 25) {
    // Only fire if the per-field check above didn't already flag it
    flags.push({
      flag: 'high_unlock_overhang',
      severity: 'warning',
      detail: `Token unlock overhang is ${overhangPct.toFixed(0)}% of max supply — large future supply increase could suppress price.`,
    });
  }

  // 18. Round 24: Social-sourced exploit mentions
  // Round 238 (AutoResearch): also check new hack_exploit_mentions field for richer coverage
  const exploitMentions = safeNum((social.exploit_mentions ?? 0) + (social.hack_exploit_mentions ?? 0));
  if (exploitMentions >= 2) {
    flags.push({
      flag: 'exploit_mentions_social',
      severity: exploitMentions >= 4 ? 'critical' : 'warning',
      detail: `${exploitMentions} recent news items mention exploits, hacks, or security vulnerabilities — verify protocol safety before entry.`,
    });
  }

  // 19. Round 24: Social-sourced unlock/vesting mentions (potential sell pressure)
  const unlockMentions = safeNum(social.unlock_mentions ?? 0);
  if (unlockMentions >= 2) {
    flags.push({
      flag: 'token_unlock_news',
      severity: 'warning',
      detail: `${unlockMentions} recent news items discuss token unlocks or vesting events — potential near-term sell pressure.`,
    });
  }

  // 20. Round 32: Revenue-to-fees ratio collapse — protocol not capturing value
  const revenueToFees = safeNum(rawData?.onchain?.revenue_to_fees_ratio ?? null, null);
  if (revenueToFees !== null && revenueToFees < 0.05 && safeNum(onchain.fees_7d) > 100_000) {
    flags.push({
      flag: 'low_revenue_capture',
      severity: 'warning',
      detail: `Revenue-to-fees ratio is ${(revenueToFees * 100).toFixed(1)}% — protocol generates fees but retains very little value for token holders.`,
    });
  }

  // 21. Round 32: No DEX pairs found at all (very low discoverability)
  // Note: `dex` already declared above at line ~167; reuse it
  if (dex.error && (dex.error === 'No DEX pairs found' || (dex.dex_pair_count === 0 && !dex.error))) {
    if (mcap > 0 && mcap < 50_000_000) {
      flags.push({
        flag: 'no_dex_pairs',
        severity: 'warning',
        detail: 'No DEX trading pairs detected — token may be exchange-only, reducing on-chain tradability and transparency.',
      });
    }
  }

  // 22. Round 32: Declining commit count + no CI = dev quality concerns
  if (github.commit_trend === 'decelerating' && github.has_ci === false && safeNum(github.commits_30d) < 5) {
    flags.push({
      flag: 'dev_quality_concern',
      severity: 'warning',
      detail: `Decelerating commits (${github.commits_30d ?? 0}/30d) with no CI/CD pipeline detected — development quality and velocity are declining.`,
    });
  }

  // 25. Round 42: Regulatory risk from social mentions
  const regulatoryMentions = safeNum(social.regulatory_mentions ?? 0);
  if (regulatoryMentions >= 2) {
    flags.push({
      flag: 'regulatory_risk_mentions',
      severity: regulatoryMentions >= 4 ? 'critical' : 'warning',
      detail: `${regulatoryMentions} recent news items mention regulatory risks, SEC/CFTC actions, or legal issues — verify jurisdiction risk before allocating.`,
    });
  }

  // 24. Round 40: Pump/dump pattern detection from DEX
  if (dex.pump_dump_signal === 'possible_pump') {
    flags.push({
      flag: 'dex_pump_pattern',
      severity: 'warning',
      detail: `DEX shows +${dex.dex_price_change_h1?.toFixed(1) ?? '?'}% in 1h and +${dex.dex_price_change_h24?.toFixed(1) ?? '?'}% in 24h — possible coordinated pump. Chasing this move is extremely high risk.`,
    });
  } else if (dex.pump_dump_signal === 'possible_dump') {
    flags.push({
      flag: 'dex_dump_pattern',
      severity: 'critical',
      detail: `DEX shows ${dex.dex_price_change_h1?.toFixed(1) ?? '?'}% in 1h and ${dex.dex_price_change_h24?.toFixed(1) ?? '?'}% in 24h — possible coordinated dump or protocol failure.`,
    });
  }

  // 23. Round 32: Near-ATL risk — price within 20% of all-time low
  const atlDistancePct = safeNum(market.atl_distance_pct ?? null, null);
  if (atlDistancePct !== null && atlDistancePct < 20 && atlDistancePct >= 0) {
    flags.push({
      flag: 'near_all_time_low',
      severity: atlDistancePct < 5 ? 'critical' : 'warning',
      detail: `Price is only ${atlDistancePct.toFixed(1)}% above all-time low — capitulation risk; structure is fragile near historical support.`,
    });
  }

  // 26. Round 56: Zero revenue despite significant fees — value extraction risk
  const fees7d = safeNum(onchain.fees_7d ?? 0);
  const revenue7d = safeNum(onchain.revenue_7d ?? 0);
  if (fees7d > 500_000 && revenue7d === 0) {
    flags.push({
      flag: 'zero_revenue_capture',
      severity: 'warning',
      detail: `Protocol generates $${(fees7d / 1000).toFixed(0)}K in fees but $0 revenue — all value flows to LPs, not token holders.`,
    });
  }

  // 27. Round 56: Extreme age imbalance — very old project with very low TVL/volume
  if (genesisDate) {
    const ageMs = Date.now() - new Date(genesisDate).getTime();
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30.44);
    const tvl = safeNum(onchain.tvl ?? 0);
    if (ageMonths > 24 && tvl < 100_000 && tvl > 0) {
      flags.push({
        flag: 'zombie_protocol',
        severity: 'warning',
        detail: `Protocol is ${ageMonths.toFixed(0)} months old but only has $${(tvl / 1000).toFixed(0)}K TVL — potential zombie project with no organic growth.`,
      });
    }
  }

  // Round 128 (AutoResearch): Suspicious volume spike — 24h vol > 5x typical (7d avg)
  // Sudden volume spikes without corresponding price context = possible wash trading or exit pump
  // Round 347 (AutoResearch): added $500K minimum — small absolute spikes are noise not signal
  const vol24h = safeNum(market.total_volume ?? 0);
  const vol7dAvg = safeNum(market.volume_7d_avg ?? 0);
  if (vol7dAvg > 0 && vol24h > 500_000 && vol24h > vol7dAvg * 5) {
    flags.push({
      flag: 'suspicious_volume_spike',
      severity: 'warning',
      detail: `24h volume ($${(vol24h / 1e6).toFixed(2)}M) is ${(vol24h / vol7dAvg).toFixed(1)}x above 7-day average ($${(vol7dAvg / 1e6).toFixed(2)}M) — possible wash trading, exit pump, or manipulation.`,
    });
  }

  // Round 143 (AutoResearch): Price pump without fundamental backing
  // +300% in 30d with no TVL or revenue growth = likely unsustainable pump
  const change30d_rf = safeNum(market.price_change_pct_30d ?? 0);
  const tvl_rf = safeNum(onchain.tvl ?? 0);
  const fees7d_rf = safeNum(onchain.fees_7d ?? 0);
  if (change30d_rf > 300) {
    const hasOnchainBacking = tvl_rf > 1_000_000 || fees7d_rf > 50_000;
    if (!hasOnchainBacking) {
      flags.push({
        flag: 'unsupported_price_pump',
        severity: change30d_rf > 1000 ? 'critical' : 'warning',
        detail: `Price up ${change30d_rf.toFixed(0)}% in 30 days with no significant TVL/revenue backing — classic pump pattern, extreme reversal risk.`,
      });
    }
  }

  // Round 133 (AutoResearch): Staking APY divergence — advertised vs actual APY mismatch
  // Large divergence signals unsustainable yield farming (Ponzi dynamics)
  const advertisedApy = safeNum(onchain.advertised_staking_apy ?? onchain.max_apy ?? 0);
  const actualApy = safeNum(onchain.realized_staking_apy ?? onchain.current_apy ?? 0);
  if (advertisedApy > 0 && actualApy > 0 && advertisedApy > 50) {
    const apyDivergencePct = ((advertisedApy - actualApy) / advertisedApy) * 100;
    if (apyDivergencePct > 70) {
      flags.push({
        flag: 'staking_apy_divergence',
        severity: 'warning',
        detail: `Staking APY divergence: advertised ${advertisedApy.toFixed(0)}% vs realized ${actualApy.toFixed(0)}% (${apyDivergencePct.toFixed(0)}% gap) — unsustainable yield mechanics, Ponzi risk.`,
      });
    }
  }

  // Round 128 (AutoResearch): Team/treasury wallet unusual activity
  // Sudden large team wallet movements = insider selling risk
  const teamWalletActivity = safeNum(market.team_wallet_activity_usd ?? 0);
  if (teamWalletActivity > 1_000_000) {
    flags.push({
      flag: 'team_wallet_spike',
      severity: teamWalletActivity > 10_000_000 ? 'critical' : 'warning',
      detail: `Unusual team/treasury wallet activity: $${(teamWalletActivity / 1e6).toFixed(2)}M moved recently — insider selling risk or treasury management action.`,
    });
  }

  // Round 237 (AutoResearch nightly): Falling social velocity — news declining AND bearish sentiment
  // Combination of low recent news + bearish tone = community losing interest while bears dominate
  const newsMomentum = social.news_momentum;
  const socialSentScore = safeNum(social.sentiment_score ?? 0);
  const filteredMentions = safeNum(social.filtered_mentions ?? social.mentions ?? 0);
  if (newsMomentum === 'declining' && socialSentScore < -0.2 && filteredMentions > 0) {
    flags.push({
      flag: 'falling_social_velocity',
      severity: 'warning',
      detail: `Social coverage is declining (${filteredMentions} mentions, momentum: ${newsMomentum}) with bearish sentiment (score ${socialSentScore.toFixed(2)}) — fading narrative + negative community tone.`,
    });
  }

  // Round 237b (AutoResearch nightly): competitor_content_ratio — high ratio means project only
  // appears as a competitor context item, not as the primary subject of coverage
  const competitorContentRatio = safeNum(social.competitor_content_ratio ?? null, null);
  if (competitorContentRatio !== null && competitorContentRatio > 0.6 && filteredMentions >= 5) {
    flags.push({
      flag: 'secondary_coverage_only',
      severity: 'info',
      detail: `${(competitorContentRatio * 100).toFixed(0)}% of social coverage frames this project in competitor context — it may be defined by rivals rather than its own narrative.`,
    });
  }

  // 28. Round 1 (AutoResearch batch): No social mentions at all — ghost project
  // Round 340 (AutoResearch): only fire if we have evidence the social search ran (has sentiment or narratives)
  // Prevents false positive when social collector never ran or returned no data object at all
  const mentions = safeNum(social.mentions ?? social.filtered_mentions ?? 0);
  const socialSearchRan = social.sentiment_score != null || Array.isArray(social.key_narratives) || social.bot_filtered_count != null;
  if (mentions === 0 && !social.error && socialSearchRan) {
    flags.push({
      flag: 'zero_social_mentions',
      severity: 'warning',
      detail: 'No social mentions detected — project may be unknown, abandoned, or too niche for signal collection.',
    });
  }

  // 29. Round 9 (AutoResearch batch): Very high inflation (>100% annualized)
  const inflationRate = safeNum(tokenomics.inflation_rate ?? 0);
  if (inflationRate > 100) {
    flags.push({
      flag: 'hyperinflationary',
      severity: 'critical',
      detail: `Annualized inflation rate is ${inflationRate.toFixed(0)}% — extreme dilution will erode token value unless matched by equally strong demand.`,
    });
  } else if (inflationRate > 50) {
    flags.push({
      flag: 'high_inflation',
      severity: 'warning',
      detail: `Annualized inflation rate is ${inflationRate.toFixed(0)}% — significant dilution pressure on existing holders.`,
    });
  }

  // 30. Round 19 (AutoResearch batch): Very low exchange count for established project
  const exchangeCount = safeNum(market.exchange_count ?? 0);
  const ageMs2 = genesisDate ? Date.now() - new Date(genesisDate).getTime() : 0;
  const ageMonths2 = ageMs2 / (1000 * 60 * 60 * 24 * 30.44);
  if (exchangeCount > 0 && exchangeCount <= 2 && ageMonths2 > 12 && safeNum(market.market_cap) > 5_000_000) {
    flags.push({
      flag: 'very_low_exchange_count',
      severity: 'warning',
      detail: `Only listed on ${exchangeCount} exchange(s) despite $${(safeNum(market.market_cap) / 1e6).toFixed(1)}M market cap and ${ageMonths2.toFixed(0)} months age — liquidity fragility risk.`,
    });
  }

  // ── Price-based red flags (migrated from price-alerts.js) ──

  const c1h = safeNum(market.price_change_pct_1h, null);
  const atl = safeNum(market.atl, null);

  // 31. Flash crash: 1h < -15%
  if (c1h !== null && c1h <= -15) {
    flags.push({
      flag: 'flash_crash',
      severity: c1h <= -30 ? 'critical' : 'warning',
      detail: `Flash crash: ${c1h.toFixed(1)}% in 1h. Possible forced selling, exploit, or panic — verify cause before buying dip.`,
    });
  }

  // 32. ATL proximity (within 10% above ATL)
  if (atlDistancePct !== null && atlDistancePct <= 10 && atlDistancePct >= 0) {
    flags.push({
      flag: 'atl_proximity',
      severity: atlDistancePct <= 3 ? 'critical' : 'warning',
      detail: `Price is only ${atlDistancePct.toFixed(1)}% above ATL ($${atl?.toFixed ? atl.toFixed(6) : atl}) — extreme downside risk, near capitulation zone.`,
    });
  }

  // Round 23 (AutoResearch nightly): Score anomaly — wildly uneven dimension scores signal fragility
  const scoreAnomaly = scores?.overall?.score_anomaly;
  const dimStddev = safeNum(scores?.overall?.dim_stddev ?? null, null);
  if (scoreAnomaly === 'high_variance' && dimStddev !== null) {
    flags.push({
      flag: 'uneven_dimension_scores',
      severity: 'warning',
      detail: `High variance across scoring dimensions (stddev ${dimStddev.toFixed(1)}) — project excels in some areas but has critical gaps in others. Concentrated risk.`,
    });
  }

  // Round 7 (AutoResearch nightly): Single-chain TVL dominance — concentration risk for multi-chain protocols
  const chainTvlDominance = safeNum(onchain.chain_tvl_dominance_pct ?? null, null);
  const chainCount = Array.isArray(onchain.chains) ? onchain.chains.length : 0;
  if (chainTvlDominance !== null && chainCount >= 3 && chainTvlDominance > 85) {
    flags.push({
      flag: 'single_chain_tvl_concentration',
      severity: 'warning',
      detail: `${chainTvlDominance.toFixed(0)}% of TVL is on one chain despite being deployed on ${chainCount} chains — multichain presence is superficial, not diversified.`,
    });
  }

  // Round 7 (AutoResearch nightly): Low revenue efficiency signal for established protocols
  const revenueEfficiency = safeNum(onchain.revenue_efficiency ?? null, null);
  const tvlForEff = safeNum(onchain.tvl ?? 0);
  if (revenueEfficiency !== null && tvlForEff > 10_000_000 && revenueEfficiency < 1) {
    flags.push({
      flag: 'very_low_revenue_efficiency',
      severity: 'info',
      detail: `Protocol generates only $${revenueEfficiency.toFixed(2)}/week per $1M TVL — extremely low capital efficiency compared to sector peers.`,
    });
  }

  // Round 151 (AutoResearch): Zombie token — established market cap but functionally untradeable DEX presence
  // A token with >$5M mcap and zero DEX liquidity after 12+ months = possible exchange-only ghost token
  const dexLiquidityForZombie = safeNum(dex.dex_liquidity_usd ?? 0);
  const mcapForZombie = safeNum(market.market_cap ?? 0);
  if (dexLiquidityForZombie === 0 && mcapForZombie > 5_000_000 && genesisDate) {
    const ageMonthsZ = (Date.now() - new Date(genesisDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonthsZ > 12) {
      flags.push({
        flag: 'zombie_token_no_dex',
        severity: 'warning',
        detail: `$${(mcapForZombie / 1e6).toFixed(1)}M market cap with zero DEX liquidity after ${ageMonthsZ.toFixed(0)} months — on-chain tradability unverified, possible illiquid token.`,
      });
    }
  }

  // Round 152 (AutoResearch): Negative real yield — emissions higher than fee revenue (Ponzi subsidy)
  // Net token inflation exceeds protocol revenue → yield is artificial, not sustainable
  const inflationForRY = safeNum(tokenomics.inflation_rate ?? 0);
  const fees7dForRY = safeNum(onchain.fees_7d ?? 0);
  const mcapForRY = safeNum(market.market_cap ?? 0);
  if (inflationForRY > 0 && fees7dForRY > 0 && mcapForRY > 0) {
    // Estimate weekly emission value: annual inflation% * mcap / 52 weeks
    const weeklyEmissionValue = (inflationForRY / 100) * mcapForRY / 52;
    if (weeklyEmissionValue > fees7dForRY * 3) {
      flags.push({
        flag: 'negative_real_yield',
        severity: 'warning',
        detail: `Weekly token emissions (~$${(weeklyEmissionValue / 1000).toFixed(0)}K estimated) exceed protocol fees ($${(fees7dForRY / 1000).toFixed(0)}K) by 3x+ — yield is inflation-subsidized, not sustainable.`,
      });
    }
  }

  // Round 232 (AutoResearch nightly): Old ATH stagnation — token hasn't recovered in 2+ years
  // Indicates structural demand failure; market has forgotten about this project
  const athRecency = market.ath_recency;
  const c200d = safeNum(market.price_change_pct_200d ?? null, null);
  if (athRecency === 'old_ath' && c200d !== null && c200d < -30) {
    flags.push({
      flag: 'old_ath_stagnation',
      severity: c200d < -60 ? 'warning' : 'info',
      detail: `All-time high was over 1 year ago and price is down ${Math.abs(c200d).toFixed(0)}% over 200 days — structural demand failure, not just a dip.`,
    });
  }

  // Round 233b (AutoResearch nightly): Very low protocol efficiency for established DeFi
  // A protocol with >$50M TVL and efficiency score <10 is barely extracting value from its capital
  const protocolEfficiency = safeNum(onchain.protocol_efficiency_score ?? null, null);
  if (protocolEfficiency !== null && protocolEfficiency < 10 && safeNum(onchain.tvl ?? 0) > 50_000_000) {
    flags.push({
      flag: 'very_low_protocol_efficiency',
      severity: 'warning',
      detail: `Protocol efficiency score is ${protocolEfficiency}/100 despite $${(safeNum(onchain.tvl) / 1e6).toFixed(0)}M TVL — token holders are poorly served by current fee/revenue structure.`,
    });
  }

  // Round 233 (AutoResearch nightly): Volume-to-market-cap anomaly — extremely low velocity
  // Vol/MCap < 0.001 (0.1%) for established tokens = near-dead trading / possible liquidity trap
  const vol24hForAnomaly = safeNum(market.total_volume ?? 0);
  const mcapForAnomaly = safeNum(market.market_cap ?? 0);
  if (vol24hForAnomaly > 0 && mcapForAnomaly > 10_000_000) {
    const volMcapRatio = vol24hForAnomaly / mcapForAnomaly;
    if (volMcapRatio < 0.001) {
      flags.push({
        flag: 'extremely_low_volume_velocity',
        severity: 'warning',
        detail: `Volume/MCap ratio is ${(volMcapRatio * 100).toFixed(3)}% — effectively illiquid relative to market cap. $${(vol24hForAnomaly / 1000).toFixed(0)}K traded vs $${(mcapForAnomaly / 1e6).toFixed(1)}M market cap.`,
      });
    }
  }

  // Round 233 (AutoResearch nightly): Community score collapse — large following but zero engagement signals
  // High follower count + zero recent mentions = ghost followers / dead community
  const communityScore = safeNum(market.community_score ?? null, null);
  const twitterFollowers = safeNum(market.twitter_followers ?? 0);
  const mentionsForCS = safeNum(social.mentions ?? social.filtered_mentions ?? 0);
  if (twitterFollowers > 100_000 && mentionsForCS === 0 && communityScore !== null && communityScore < 10) {
    flags.push({
      flag: 'ghost_community',
      severity: 'warning',
      detail: `${(twitterFollowers / 1000).toFixed(0)}K Twitter followers but zero recent social mentions and low community score — inflated follower count or dead community.`,
    });
  }

  // Round 236 (AutoResearch): commits_per_contributor too low = ghost contributors
  // Many contributors with very few commits = inflated team size claims
  const commitsPerContrib = safeNum(github.commits_per_contributor ?? null, null);
  if (commitsPerContrib !== null && commitsPerContrib < 1.5 && safeNum(github.contributors ?? 0) > 20) {
    flags.push({
      flag: 'ghost_contributors',
      severity: 'info',
      detail: `Only ${commitsPerContrib.toFixed(1)} commits per contributor over 90d despite ${github.contributors} contributors — many may be one-time committers, overstating team size.`,
    });
  }

  // Round 234 (AutoResearch): Extreme FDV overhang check
  const fdvFlag = checkFdvOverhang(market);
  if (fdvFlag) flags.push(fdvFlag);

  // Round 236 (AutoResearch): 52w low + FDV trap combo
  const lowRangeFlag = checkLowRangeFdvTrap(market);
  if (lowRangeFlag) flags.push(lowRangeFlag);

  // Round 234b (AutoResearch): Stale data warning — if market data is missing key fields after retries
  // Signals data collection failure rather than bad fundamentals
  if (!market.error && market.market_cap == null && market.price == null && market.current_price == null) {
    flags.push({
      flag: 'stale_market_data',
      severity: 'info',
      detail: 'Market data fields are empty despite no explicit error — CoinGecko may have rate-limited this project or the token is not indexed yet.',
    });
  }

  // Round 235 (AutoResearch): Low buy/sell ratio on DEX — sellers dominating
  const buys24h = safeNum(dex?.buys_24h ?? 0);
  const sells24h = safeNum(dex?.sells_24h ?? 0);
  const totalTxns = buys24h + sells24h;
  if (totalTxns >= 50 && buys24h > 0) {
    const buySellRatio = buys24h / sells24h;
    if (buySellRatio < 0.5) {
      flags.push({
        flag: 'sell_pressure_dominance',
        severity: 'warning',
        detail: `DEX buy/sell ratio is ${buySellRatio.toFixed(2)} (${buys24h} buys vs ${sells24h} sells in 24h) — sellers outnumber buyers 2:1+, indicating distribution phase.`,
      });
    }
  }

  // Round 351 (AutoResearch batch): Stale development check
  const staleDevFlag = detectStaleDevelopment(rawData);
  if (staleDevFlag) flags.push(staleDevFlag);

  // Round 352 (AutoResearch batch): Extremely low volume check
  const lowVolFlag = detectLowVolume(rawData);
  if (lowVolFlag) flags.push(lowVolFlag);

  // Round 382 (AutoResearch): Fee-revenue divergence check
  const feeRevDivFlag = detectFeeRevenueDivergence(rawData);
  if (feeRevDivFlag) flags.push(feeRevDivFlag);

  // Round 382 (AutoResearch): Inverted TVL/MCap check (mercenary capital risk)
  const invertedTvlFlag = detectInvertedTvlMcap(rawData);
  if (invertedTvlFlag) flags.push(invertedTvlFlag);

  // Round 382 (AutoResearch): Social-price divergence check
  const socialPriceFlag = detectSocialPriceDivergence(rawData);
  if (socialPriceFlag) flags.push(socialPriceFlag);

  // Round 383 (AutoResearch): New red flag detectors
  const highSellTaxFlag = detectHighSellTax(rawData);
  if (highSellTaxFlag) flags.push(highSellTaxFlag);

  const proxyContractFlag = detectProxyContractRisk(rawData);
  if (proxyContractFlag) flags.push(proxyContractFlag);

  const hyperinflationFlag = detectHyperinflation(rawData);
  if (hyperinflationFlag) flags.push(hyperinflationFlag);

  const mercenaryWhaleFlag = detectMercenaryTvlConcentration(rawData);
  if (mercenaryWhaleFlag) flags.push(mercenaryWhaleFlag);

  // Deduplicate flags by flag key (keep highest severity)
  const severityOrder = { critical: 3, warning: 2, info: 1 };
  const flagMap = new Map();
  for (const flag of flags) {
    const existing = flagMap.get(flag.flag);
    if (!existing || severityOrder[flag.severity] > severityOrder[existing.severity]) {
      flagMap.set(flag.flag, flag);
    }
  }
  return Array.from(flagMap.values());
}

// Round 234 (AutoResearch): Extreme FDV overhang — very little of supply in circulation
// When MCap/FDV < 0.1 (only 10% circulating), future unlocks will massively dilute existing holders
export function checkFdvOverhang(market = {}) {
  const mcap = Number(market.market_cap ?? 0);
  const fdv = Number(market.fully_diluted_valuation ?? 0);
  if (mcap <= 0 || fdv <= 0 || fdv <= mcap) return null;
  const ratio = mcap / fdv;
  if (ratio < 0.1 && mcap > 1_000_000) {
    return {
      flag: 'extreme_fdv_overhang',
      severity: ratio < 0.05 ? 'critical' : 'warning',
      detail: `Only ${(ratio * 100).toFixed(1)}% of total supply is circulating (MCap $${(mcap/1e6).toFixed(1)}M vs FDV $${(fdv/1e6).toFixed(1)}M) — massive future unlock pressure on current holders.`,
    };
  }
  return null;
}

// Round 236 (AutoResearch): Near 52-week low with high FDV overhang — double red flag
// Price at lows while most supply is unlocked = severe structural weakness
export function checkLowRangeFdvTrap(market = {}) {
  const vs52w = market.price_vs_52w;
  const mcap = Number(market.market_cap ?? 0);
  const fdv = Number(market.fully_diluted_valuation ?? 0);
  if (!vs52w || mcap <= 0 || fdv <= 0) return null;
  const fdvRatio = fdv / mcap;
  if (vs52w.tier === 'near_low' && fdvRatio > 3 && mcap > 500_000) {
    return {
      flag: 'low_range_fdv_trap',
      severity: 'critical',
      detail: `Price near 52-week low (${vs52w.pct_from_52w_high.toFixed(1)}% from 52w high) with FDV/MCap ratio ${fdvRatio.toFixed(1)}x — structural distribution trap: price at lows while major supply unlocks loom.`,
    };
  }
  return null;
}

// ─── Round 238 (AutoResearch nightly): Additional red flag detectors ──────────

/**
 * Detect 30-day revenue collapse — protocol losing monetization rapidly.
 * @param {object} rawData
 * @returns {object|null}
 */
export function detectRevenueCollapse(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  const fees7d = Number(onchain.fees_7d ?? 0);
  const fees30d = Number(onchain.fees_30d ?? 0);
  if (fees30d <= 0 || fees7d < 0) return null;
  // If last 7d fees are < 10% of (30d fees / 4 = weekly avg), revenue collapsed
  const weeklyAvg30d = fees30d / 4;
  if (weeklyAvg30d > 10_000 && fees7d > 0 && fees7d < weeklyAvg30d * 0.1) {
    return {
      flag: 'revenue_collapse',
      severity: 'critical',
      detail: `7d fees ($${fees7d.toLocaleString('en-US', { maximumFractionDigits: 0 })}) are <10% of 30d weekly avg ($${weeklyAvg30d.toLocaleString('en-US', { maximumFractionDigits: 0 })}) — protocol revenue has collapsed.`,
    };
  }
  return null;
}

/**
 * Detect social-price divergence: price up >30% but sentiment bearish/neutral.
 * Signals possible manipulation or smart money exit.
 */
export function detectSocialPriceDivergence(rawData = {}) {
  const market = rawData.market ?? {};
  const social = rawData.social ?? {};
  const change7d = Number(market.price_change_pct_7d ?? NaN);
  const sentScore = Number(social.sentiment_score ?? NaN);
  if (!Number.isFinite(change7d) || !Number.isFinite(sentScore)) return null;
  if (change7d > 30 && sentScore < -0.1) {
    return {
      flag: 'social_price_divergence',
      severity: 'warning',
      detail: `Price up ${change7d.toFixed(0)}% in 7d but sentiment is ${sentScore < -0.3 ? 'bearish' : 'slightly negative'} (${sentScore.toFixed(2)}) — community not participating in the pump, possible exit liquidity scenario.`,
    };
  }
  return null;
}

/**
 * Detect TVL-to-MCap imbalance: very high TVL vs tiny market cap = either unlocked alpha or red flag.
 * When TVL >> MCap, protocol may be bootstrapped with incentivized liquidity about to leave.
 */
export function detectInvertedTvlMcap(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  const market = rawData.market ?? {};
  const tvl = Number(onchain.tvl ?? 0);
  const mcap = Number(market.market_cap ?? 0);
  if (tvl <= 0 || mcap <= 0) return null;
  const ratio = tvl / mcap;
  // TVL > 10x MCap = likely incentivized/mercenary capital that will leave
  if (ratio > 10 && tvl > 5_000_000) {
    return {
      flag: 'mercenary_tvl_dominance',
      severity: 'warning',
      detail: `TVL ($${(tvl / 1e6).toFixed(1)}M) is ${ratio.toFixed(0)}x MCap ($${(mcap / 1e6).toFixed(1)}M) — likely incentivized mercenary capital vulnerable to farm-and-dump dynamics.`,
    };
  }
  return null;
}

// ─── Round 351 (AutoResearch batch): Stale development red flag ──────────────

/**
 * Detect stale development — active project with no commits in 60+ days.
 * Distinct from "no github" (which is about missing data vs. clear inactivity).
 */
export function detectStaleDevelopment(rawData = {}) {
  const github = rawData.github ?? {};
  if (github.error || github.commits_90d == null) return null;
  const commits90d = Number(github.commits_90d ?? 0);
  const commits30d = Number(github.commits_30d ?? 0);
  const lastCommit = github.last_commit;

  // If stars > 100 (real project) but <3 commits in last 30d and <10 in 90d
  const stars = Number(github.stars ?? 0);
  if (stars > 100 && commits30d < 3 && commits90d < 10) {
    const daysSince = lastCommit
      ? Math.floor((Date.now() - new Date(lastCommit).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const detail = daysSince != null
      ? `Last commit ${daysSince}d ago, only ${commits30d} commits in last 30d — development appears stalled.`
      : `Only ${commits30d} commits in last 30d, ${commits90d} in 90d — low activity for a ${stars}-star repo.`;
    return {
      flag: 'stale_development',
      severity: daysSince != null && daysSince > 120 ? 'critical' : 'warning',
      detail,
    };
  }
  return null;
}

// ─── Round 381 (AutoResearch): Fee-Revenue Divergence ───────────────────────

/**
 * Detect when fees are rising but protocol revenue is falling.
 * This means the protocol is generating activity but not capturing value for token holders.
 * Classic "mercenary volume" pattern — activity without protocol revenue = value drain.
 */
export function detectFeeRevenueDivergence(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  const fees7d = Number(onchain.fees_7d ?? 0);
  const fees7dPrev = Number(onchain.fees_7d_prev ?? 0);
  const revenue7d = Number(onchain.revenue_7d ?? 0);
  const revenue7dPrev = Number(onchain.revenue_7d_prev ?? 0);
  if (fees7d <= 0 || fees7dPrev <= 0 || revenue7d <= 0 || revenue7dPrev <= 0) return null;
  const feeGrowth = (fees7d - fees7dPrev) / fees7dPrev;
  const revGrowth = (revenue7d - revenue7dPrev) / revenue7dPrev;
  // Fees up >20% but revenue down >20% = protocol paying out more to LPs/users than it keeps
  if (feeGrowth > 0.20 && revGrowth < -0.20) {
    return {
      flag: 'fee_revenue_divergence',
      severity: 'warning',
      detail: `Fees +${(feeGrowth * 100).toFixed(0)}% but protocol revenue ${(revGrowth * 100).toFixed(0)}% week-over-week — fees going to LPs/users, not token holders. Value capture deteriorating.`,
    };
  }
  return null;
}

// ─── Round 352 (AutoResearch batch): Extremely low volume red flag ───────────

/**
 * Detect tokens with very low trading volume relative to market cap.
 * Low volume = poor price discovery, easily manipulated, hard to exit.
 */
export function detectLowVolume(rawData = {}) {
  const market = rawData.market ?? {};
  const mcap = Number(market.market_cap ?? 0);
  const volume = Number(market.total_volume ?? 0);
  if (mcap <= 0 || volume <= 0) return null;
  const volMcapRatio = volume / mcap;
  // < 0.5% volume/mcap is extremely illiquid for anything above $1M mcap
  if (mcap > 1_000_000 && volMcapRatio < 0.005) {
    return {
      flag: 'extremely_low_volume',
      severity: volMcapRatio < 0.001 ? 'critical' : 'warning',
      detail: `24h volume ($${(volume / 1000).toFixed(0)}K) is only ${(volMcapRatio * 100).toFixed(3)}% of market cap — extremely illiquid, price easily manipulated.`,
    };
  }
  return null;
}

// ─── Round 383 (AutoResearch): Contract security red flags ───────────────────

/**
 * Detect high sell tax — tokens with sell tax >10% trap holders.
 * This is a hallmark of honeypot-adjacent designs or exit fee extraction.
 */
export function detectHighSellTax(rawData = {}) {
  const contract = rawData.contract ?? {};
  const sellTax = Number(contract.sell_tax ?? NaN);
  if (!Number.isFinite(sellTax)) return null;
  if (sellTax > 10) {
    return {
      flag: 'high_sell_tax',
      severity: sellTax > 20 ? 'critical' : 'warning',
      detail: `Sell tax of ${sellTax}% detected — tokens with high exit fees trap holders and incentivize holding over fundamentals. Liquidity exit nearly impossible at scale.`,
    };
  }
  return null;
}

/**
 * Detect proxy contract upgrade risk — upgradeable contracts can change token behavior post-launch.
 * A proxy contract combined with unverified code = maximum rug pull surface.
 */
export function detectProxyContractRisk(rawData = {}) {
  const contract = rawData.contract ?? {};
  if (contract.is_proxy !== true) return null;
  const audited = contract.audited === true;
  const verified = contract.verified === true;
  if (!audited && !verified) {
    return {
      flag: 'unaudited_proxy_contract',
      severity: 'critical',
      detail: `Upgradeable proxy contract detected with no audit and no verification — team can silently change contract logic after deployment. Maximum smart contract risk.`,
    };
  }
  if (!audited) {
    return {
      flag: 'unaudited_upgradeable_contract',
      severity: 'warning',
      detail: `Upgradeable proxy contract detected without formal security audit — contract behavior can be changed by deployer. High smart contract risk.`,
    };
  }
  return null;
}

/**
 * Detect severe inflation — tokens with >50%/yr inflation rate erode holder value aggressively.
 * At high inflation, token emission economics are likely Ponzi-dependent.
 */
export function detectHyperinflation(rawData = {}) {
  const tokenomics = rawData.tokenomics ?? {};
  const inflation = Number(tokenomics.inflation_rate ?? NaN);
  if (!Number.isFinite(inflation) || inflation <= 50) return null;
  return {
    flag: 'hyperinflationary_supply',
    severity: inflation > 100 ? 'critical' : 'warning',
    detail: `Annual inflation rate of ${inflation.toFixed(0)}%/yr — token supply expanding faster than demand can absorb. Classic Ponzi-emission structure where early holders dump on latecomers.`,
  };
}

/**
 * Detect TVL-to-active-user imbalance: very few users despite large TVL.
 * This is a sign of mercenary capital (whales/protocols depositing for yield, not users using the product).
 */
export function detectMercenaryTvlConcentration(rawData = {}) {
  const onchain = rawData.onchain ?? {};
  const tvl = Number(onchain.tvl ?? 0);
  const activeAddresses7d = Number(onchain.active_addresses_7d ?? onchain.active_users_24h ?? 0);
  if (tvl <= 1_000_000 || activeAddresses7d === 0) return null;
  const tvlPerUser = tvl / activeAddresses7d;
  // If average TVL per active user > $5M, it's almost certainly mercenary/whale capital
  if (tvlPerUser > 5_000_000) {
    return {
      flag: 'mercenary_tvl_whale_concentration',
      severity: tvlPerUser > 20_000_000 ? 'critical' : 'warning',
      detail: `Average TVL per active user is $${(tvlPerUser / 1_000_000).toFixed(1)}M — TVL is dominated by a small number of whale depositors, not organic user adoption. Withdrawal of one whale could crater TVL.`,
    };
  }
  return null;
}
