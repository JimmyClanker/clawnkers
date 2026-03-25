/**
 * red-flags.js — Round 14
 * Detects qualitative red flags from raw scanner data and scores.
 */

function safeN(v, fb = 0) {
  return Number.isFinite(Number(v)) ? Number(v) : fb;
}

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
  const mcap = safeN(market.market_cap);
  if (mcap > 0 && mcap < 1_000_000) {
    flags.push({
      flag: 'low_market_cap',
      severity: 'critical',
      detail: `Market cap $${(mcap / 1000).toFixed(0)}K is below $1M — extremely illiquid and volatile.`,
    });
  }

  // 3. No GitHub repo
  if (github.error || (!github.stars && !github.commits_90d && !github.contributors)) {
    flags.push({
      flag: 'no_github',
      severity: 'warning',
      detail: 'No GitHub repository data found — development activity unverifiable.',
    });
  }

  // 4. Whale concentration > 30%
  const holders = rawData.holders ?? rawData.holderData ?? {};
  const whaleConcentration = safeN(holders.top10_concentration ?? holders.concentration_pct);
  if (whaleConcentration > 30) {
    flags.push({
      flag: 'whale_concentration',
      severity: whaleConcentration > 60 ? 'critical' : 'warning',
      detail: `Top-10 wallets hold ${whaleConcentration.toFixed(1)}% of supply — concentration risk.`,
    });
  }

  // 5. No onchain data
  if (onchain.error || (!onchain.tvl && !onchain.tvl_change_7d && !onchain.fees_7d)) {
    flags.push({
      flag: 'no_onchain_data',
      severity: 'info',
      detail: 'No onchain (DeFiLlama/similar) data available — protocol health unverifiable.',
    });
  }

  // 6. Declining TVL > 30%
  const tvlChange7d = safeN(onchain.tvl_change_7d);
  const tvlChange30d = safeN(onchain.tvl_change_30d);
  if (tvlChange7d < -30 || tvlChange30d < -30) {
    const worst = Math.min(tvlChange7d, tvlChange30d);
    flags.push({
      flag: 'declining_tvl',
      severity: worst < -50 ? 'critical' : 'warning',
      detail: `TVL has declined ${Math.abs(worst).toFixed(1)}% recently — protocol losing traction.`,
    });
  }

  // 7. Volume < $50K
  const volume = safeN(market.total_volume);
  if (volume > 0 && volume < 50_000) {
    flags.push({
      flag: 'low_volume',
      severity: 'warning',
      detail: `24h trading volume $${(volume / 1000).toFixed(1)}K is very low — liquidity risk.`,
    });
  }

  // 8. All social sentiment bearish
  const bullish = safeN(social.sentiment_counts?.bullish);
  const bearish  = safeN(social.sentiment_counts?.bearish);
  const sentScore = safeN(social.sentiment_score, NaN);
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
  const fdv = safeN(market.fully_diluted_valuation ?? market.fdv);
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
  const change30d = safeN(market.price_change_pct_30d);
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
  const price = safeN(market.current_price ?? market.price);
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
  const dexLiquidity = safeN(dex.dex_liquidity_usd ?? 0);
  if (dexLiquidity > 0 && dexLiquidity < 50_000) {
    flags.push({
      flag: 'very_low_dex_liquidity',
      severity: dexLiquidity < 10_000 ? 'critical' : 'warning',
      detail: `Total DEX liquidity is only $${(dexLiquidity / 1000).toFixed(1)}K — extreme slippage risk on any meaningful position.`,
    });
  }

  // 16. Round 4: Extremely high top-pair liquidity concentration (>90%)
  const topPairLiqPct = safeN(dex.top_pair_liquidity_pct ?? 0);
  if (topPairLiqPct > 90 && dexLiquidity > 100_000) {
    flags.push({
      flag: 'single_pool_liquidity_concentration',
      severity: 'warning',
      detail: `${topPairLiqPct.toFixed(0)}% of DEX liquidity is concentrated in one pool — fragile liquidity profile.`,
    });
  }

  // 17. Round 18: High team allocation — potential insider sell pressure
  const vestingInfo = tokenomics.vesting_info;
  const teamAllocationPct = safeN(vestingInfo?.team_allocation_pct ?? 0);
  if (teamAllocationPct > 25) {
    flags.push({
      flag: 'high_team_allocation',
      severity: teamAllocationPct > 40 ? 'critical' : 'warning',
      detail: `Team/insider allocation is ${teamAllocationPct.toFixed(0)}% of supply — elevated sell pressure risk when vesting unlocks.`,
    });
  }

  // 18. Round 24: Social-sourced exploit mentions
  const exploitMentions = safeN(social.exploit_mentions ?? 0);
  if (exploitMentions >= 2) {
    flags.push({
      flag: 'exploit_mentions_social',
      severity: exploitMentions >= 4 ? 'critical' : 'warning',
      detail: `${exploitMentions} recent news items mention exploits, hacks, or security vulnerabilities — verify protocol safety before entry.`,
    });
  }

  // 19. Round 24: Social-sourced unlock/vesting mentions (potential sell pressure)
  const unlockMentions = safeN(social.unlock_mentions ?? 0);
  if (unlockMentions >= 2) {
    flags.push({
      flag: 'token_unlock_news',
      severity: 'warning',
      detail: `${unlockMentions} recent news items discuss token unlocks or vesting events — potential near-term sell pressure.`,
    });
  }

  // 20. Round 32: Revenue-to-fees ratio collapse — protocol not capturing value
  const revenueToFees = safeN(rawData?.onchain?.revenue_to_fees_ratio ?? null, null);
  if (revenueToFees !== null && revenueToFees < 0.05 && safeN(onchain.fees_7d) > 100_000) {
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
  if (github.commit_trend === 'decelerating' && github.has_ci === false && safeN(github.commits_30d) < 5) {
    flags.push({
      flag: 'dev_quality_concern',
      severity: 'warning',
      detail: `Decelerating commits (${github.commits_30d ?? 0}/30d) with no CI/CD pipeline detected — development quality and velocity are declining.`,
    });
  }

  // 25. Round 42: Regulatory risk from social mentions
  const regulatoryMentions = safeN(social.regulatory_mentions ?? 0);
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
  const atlDistancePct = safeN(market.atl_distance_pct ?? null, null);
  if (atlDistancePct !== null && atlDistancePct < 20 && atlDistancePct >= 0) {
    flags.push({
      flag: 'near_all_time_low',
      severity: atlDistancePct < 5 ? 'critical' : 'warning',
      detail: `Price is only ${atlDistancePct.toFixed(1)}% above all-time low — capitulation risk; structure is fragile near historical support.`,
    });
  }

  // 26. Round 56: Zero revenue despite significant fees — value extraction risk
  const fees7d = safeN(onchain.fees_7d ?? 0);
  const revenue7d = safeN(onchain.revenue_7d ?? 0);
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
    const tvl = safeN(onchain.tvl ?? 0);
    if (ageMonths > 24 && tvl < 100_000 && tvl > 0) {
      flags.push({
        flag: 'zombie_protocol',
        severity: 'warning',
        detail: `Protocol is ${ageMonths.toFixed(0)} months old but only has $${(tvl / 1000).toFixed(0)}K TVL — potential zombie project with no organic growth.`,
      });
    }
  }

  // 28. Round 1 (AutoResearch batch): No social mentions at all — ghost project
  const mentions = safeN(social.mentions ?? social.filtered_mentions ?? 0);
  if (mentions === 0 && !social.error) {
    flags.push({
      flag: 'zero_social_mentions',
      severity: 'warning',
      detail: 'No social mentions detected — project may be unknown, abandoned, or too niche for signal collection.',
    });
  }

  // 29. Round 9 (AutoResearch batch): Very high inflation (>100% annualized)
  const inflationRate = safeN(tokenomics.inflation_rate ?? 0);
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
  const exchangeCount = safeN(market.exchange_count ?? 0);
  const ageMs2 = genesisDate ? Date.now() - new Date(genesisDate).getTime() : 0;
  const ageMonths2 = ageMs2 / (1000 * 60 * 60 * 24 * 30.44);
  if (exchangeCount > 0 && exchangeCount <= 2 && ageMonths2 > 12 && safeN(market.market_cap) > 5_000_000) {
    flags.push({
      flag: 'very_low_exchange_count',
      severity: 'warning',
      detail: `Only listed on ${exchangeCount} exchange(s) despite $${(safeN(market.market_cap) / 1e6).toFixed(1)}M market cap and ${ageMonths2.toFixed(0)} months age — liquidity fragility risk.`,
    });
  }

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
