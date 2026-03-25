function clampScore(value) {
  return Math.min(10, Math.max(1, Number(value.toFixed(1))));
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

// ─── Round 18: confidence helper ─────────────────────────────────────────────
/**
 * Calculate per-dimension data confidence (0–100%).
 * @param {object} rawData - raw collector data
 * @returns {object} confidence per dimension + overall_confidence
 */
export function calculateConfidence(rawData = {}) {
  const market     = rawData.market     ?? {};
  const onchain    = rawData.onchain    ?? {};
  const social     = rawData.social     ?? {};
  const github     = rawData.github     ?? {};
  const tokenomics = rawData.tokenomics ?? {};

  // Market
  let marketConf;
  if (market.error) marketConf = 30;
  else if (market.current_price != null && market.total_volume != null && market.market_cap != null) marketConf = 100;
  else if (market.current_price != null) marketConf = 60;
  else marketConf = 30;

  // Onchain
  let onchainConf;
  if (onchain.error) onchainConf = 0;
  else if (onchain.tvl != null && onchain.fees_7d != null && onchain.revenue_7d != null) onchainConf = 100;
  else if (onchain.tvl != null || onchain.tvl_change_7d != null) onchainConf = 60;
  else onchainConf = 0;

  // Social
  const mentions = safeNumber(social.filtered_mentions ?? social.mentions);
  let socialConf;
  if (social.error) socialConf = 20;
  else if (mentions > 10) socialConf = 100;
  else if (mentions >= 1) socialConf = 50;
  else socialConf = 20;

  // Dev
  let devConf;
  if (github.error) devConf = 0;
  else if (github.commits_90d != null && github.contributors != null && github.stars != null) devConf = 100;
  else if (github.stars != null) devConf = 50;
  else devConf = 0;

  // Tokenomics
  let tokenomicsConf;
  if (tokenomics.error) tokenomicsConf = 20;
  else if (tokenomics.pct_circulating != null && tokenomics.inflation_rate != null && tokenomics.token_distribution != null) tokenomicsConf = 100;
  else if (tokenomics.pct_circulating != null) tokenomicsConf = 50;
  else tokenomicsConf = 20;

  const overall_confidence = Math.round((marketConf + onchainConf + socialConf + devConf + tokenomicsConf) / 5);

  return {
    market: marketConf,
    onchain: onchainConf,
    social: socialConf,
    development: devConf,
    tokenomics: tokenomicsConf,
    overall_confidence,
  };
}

function scoreMarketStrength(market = {}) {
  const volume = safeNumber(market.total_volume);
  const marketCap = safeNumber(market.market_cap);
  const fdv = safeNumber(market.fully_diluted_valuation);
  const ratio = marketCap > 0 ? volume / marketCap : 0;
  const fdvOverhang = marketCap > 0 && fdv > 0 ? fdv / marketCap : 1;

  // Use pre-computed ATH distance if available, fall back to calculation
  const athDistancePct = market.ath_distance_pct != null
    ? safeNumber(market.ath_distance_pct)
    : null;

  // Weighted momentum: recent signals weight more than older ones
  const change1h = safeNumber(market.price_change_pct_1h);
  const change24h = safeNumber(market.price_change_pct_24h);
  const change7d = safeNumber(market.price_change_pct_7d);
  const change30d = safeNumber(market.price_change_pct_30d);
  // Weighted composite momentum (24h most relevant for current signal)
  const momentum = (change1h * 0.1) + (change24h * 0.4) + (change7d * 0.3) + (change30d * 0.2);

  // Trend consistency bonus: all timeframes positive = strong trend confirmation
  const positiveTrends = [change1h, change24h, change7d, change30d].filter((c) => c > 0).length;
  const trendConsistency = positiveTrends / 4; // 0 to 1

  let raw = 4;
  raw += Math.min(ratio * 20, 3);
  raw += Math.max(Math.min(momentum / 10, 2.5), -2);
  raw += (trendConsistency - 0.5) * 0.6; // ±0.3 bonus for all green / all red

  if (fdvOverhang > 1.1) {
    raw -= Math.min((fdvOverhang - 1.1) * 0.7, 1.5);
  }

  if (athDistancePct != null) {
    if (athDistancePct > -15) raw += 0.5;  // Near ATH = price strength
    else if (athDistancePct > -40) raw += 0.1; // Still in reasonable range
    if (athDistancePct < -80) raw -= 1.2;  // Deep in the hole
    else if (athDistancePct < -50) raw -= Math.min((Math.abs(athDistancePct) - 50) / 25, 0.8);
  }

  // Round 6: price_momentum_tier bonus — reward consistent multi-TF trends
  const momentumTier = market.price_momentum_tier;
  if (momentumTier === 'strong_uptrend') raw += 0.4;
  else if (momentumTier === 'uptrend') raw += 0.2;
  else if (momentumTier === 'strong_downtrend') raw -= 0.4;
  else if (momentumTier === 'downtrend') raw -= 0.2;

  // Round 10: Price range position — where in ATL-ATH range is the price?
  const priceRangePos = market.price_range_position != null ? safeNumber(market.price_range_position) : null;
  if (priceRangePos !== null) {
    if (priceRangePos >= 0.8) raw += 0.3;         // Near ATH — momentum confirmation
    else if (priceRangePos >= 0.5) raw += 0.1;    // Upper half — constructive
    else if (priceRangePos <= 0.1) raw -= 0.6;    // Near ATL — capitulation risk
    else if (priceRangePos <= 0.25) raw -= 0.3;   // Lower quartile — bearish structure
  }

  // Round 13: Time-decay factor — very new projects get a small uncertainty penalty
  let isNewProject = false;
  let age_months = null;
  const genesisDate = market.genesis_date;
  if (genesisDate) {
    const ageMs = Date.now() - new Date(genesisDate).getTime();
    age_months = ageMs / (1000 * 60 * 60 * 24 * 30.44);
    isNewProject = age_months < 3;
    if (age_months < 1) {
      raw -= 1.0; // Very new: significant uncertainty
    } else if (age_months < 3) {
      raw -= 0.5; // New: mild uncertainty penalty
    } else if (age_months > 24) {
      raw += 0.2; // Proven longevity bonus (2+ years)
    }
    // No bonus for age — longevity is already captured in momentum history
  }

  // Round 34: twitter/telegram followers as social proof for market strength
  const twitterFollowers = safeNumber(market.twitter_followers ?? 0);
  const telegramUsers = safeNumber(market.telegram_channel_user_count ?? 0);
  const totalCommunitySize = twitterFollowers + telegramUsers;
  if (totalCommunitySize > 500_000) raw += 0.4;
  else if (totalCommunitySize > 100_000) raw += 0.2;
  else if (totalCommunitySize > 10_000) raw += 0.1;

  // Round 34: market cap rank bonus — top 100 = institutional attention
  const marketCapRank = safeNumber(market.market_cap_rank ?? 0);
  if (marketCapRank > 0 && marketCapRank <= 20) raw += 0.5;
  else if (marketCapRank > 0 && marketCapRank <= 100) raw += 0.2;

  // Round 58: Exchange count — more CEX listings = legitimacy + liquidity
  const exchangeCount = safeNumber(market.exchange_count ?? 0);
  if (exchangeCount >= 20) raw += 0.4;
  else if (exchangeCount >= 10) raw += 0.2;
  else if (exchangeCount >= 5) raw += 0.1;

  return {
    score: clampScore(raw),
    is_new_project: isNewProject,
    age_months: age_months != null ? parseFloat(age_months.toFixed(1)) : null,
    reasoning: `Volume/MC ratio ${ratio.toFixed(2)}, weighted momentum ${momentum.toFixed(2)}%, trend consistency ${(trendConsistency * 100).toFixed(0)}%, FDV/MC ${fdvOverhang.toFixed(2)}, ATH distance ${athDistancePct == null ? 'n/a' : `${athDistancePct.toFixed(1)}%`}${age_months != null ? `, age ${age_months.toFixed(1)} months${isNewProject ? ' (new project penalty applied)' : ''}` : ''}.`,
  };
}

function scoreOnchainHealth(onchain = {}) {
  const trend7d = safeNumber(onchain.tvl_change_7d);
  const trend30d = safeNumber(onchain.tvl_change_30d);
  // Use fees_7d; fall back to fees_30d / 4 if only monthly data available
  const fees = onchain.fees_7d != null
    ? safeNumber(onchain.fees_7d)
    : safeNumber(onchain.fees_30d) / 4;
  const revenue = onchain.revenue_7d != null
    ? safeNumber(onchain.revenue_7d)
    : safeNumber(onchain.revenue_30d) / 4;

  let raw = 4;
  raw += Math.max(Math.min((trend7d + trend30d) / 25, 3), -2);
  raw += fees > 0 ? Math.min(Math.log10(fees + 1), 2) : 0;
  raw += revenue > 0 ? Math.min(Math.log10(revenue + 1), 1.5) : 0;

  // Round 18: multichain bonus — reward protocols deployed on multiple chains
  const chainCount = Array.isArray(onchain.chains) ? onchain.chains.length : 0;
  let multichainBonus = 0;
  if (chainCount >= 5) multichainBonus = 0.6;
  else if (chainCount >= 3) multichainBonus = 0.3;
  else if (chainCount >= 2) multichainBonus = 0.15;
  raw += multichainBonus;

  // Round 18: active users signal (if available)
  const activeUsers = safeNumber(onchain.active_users_24h);
  if (activeUsers > 10000) raw += 0.5;
  else if (activeUsers > 1000) raw += 0.25;

  // Round 7: TVL stickiness adjustment
  const tvlStickiness = onchain.tvl_stickiness;
  if (tvlStickiness === 'sticky') raw += 0.4;
  else if (tvlStickiness === 'fleeing') raw -= 0.5;

  // Round 57: Active addresses as a usage signal
  const activeAddresses7d = safeNumber(onchain.active_addresses_7d ?? onchain.unique_users_7d ?? 0);
  if (activeAddresses7d > 50_000) raw += 0.6;
  else if (activeAddresses7d > 10_000) raw += 0.3;
  else if (activeAddresses7d > 1_000) raw += 0.1;

  // Round 57: revenue-to-fees ratio — value capture quality
  const revenueToFees = onchain.fees_7d > 0 ? revenue / fees : null;
  let revCapture = 0;
  if (revenueToFees !== null) {
    if (revenueToFees >= 0.5) { revCapture = 0.4; }  // protocol keeps 50%+ = very healthy
    else if (revenueToFees >= 0.2) { revCapture = 0.2; }
    else if (revenueToFees > 0) { revCapture = 0.05; } // at least generating some revenue
    raw += revCapture;
  }

  return {
    score: clampScore(raw),
    reasoning: `TVL trend 7d ${trend7d.toFixed(2)}%, 30d ${trend30d.toFixed(2)}%, fees_7d ${fees.toFixed(0)}, chains ${chainCount}${multichainBonus > 0 ? ` (+${multichainBonus} multichain bonus)` : ''}${tvlStickiness ? `, TVL ${tvlStickiness}` : ''}${activeAddresses7d > 0 ? `, active_addr_7d ${activeAddresses7d}` : ''}${revenueToFees !== null ? `, rev/fees ${(revenueToFees * 100).toFixed(0)}%` : ''}.`,
  };
}

function scoreSocialMomentum(social = {}) {
  // Use filtered mentions (bot-filtered) if available, fall back to raw mentions
  const rawMentions = safeNumber(social.mentions);
  const filteredMentions = social.filtered_mentions != null
    ? safeNumber(social.filtered_mentions)
    : rawMentions;
  const bullish = safeNumber(social?.sentiment_counts?.bullish);
  const bearish = safeNumber(social?.sentiment_counts?.bearish);
  const neutral = safeNumber(social?.sentiment_counts?.neutral);
  const narratives = Array.isArray(social.key_narratives) ? social.key_narratives.length : 0;
  const totalSignals = bullish + bearish + neutral;
  const sentimentSpread = bullish - bearish;
  const confidence = totalSignals > 0 ? Math.min(totalSignals / 6, 1) : 0;

  // Use normalized sentiment score if available
  const sentimentScore = social.sentiment_score != null
    ? safeNumber(social.sentiment_score) // -1 to +1
    : totalSignals > 0 ? (bullish - bearish) / totalSignals : 0;

  // Bot filter ratio: if many items were filtered, discount signal quality
  const botFilteredCount = safeNumber(social.bot_filtered_count);
  const botRatio = rawMentions > 0 ? botFilteredCount / rawMentions : 0;
  const signalQualityMultiplier = Math.max(0.5, 1 - botRatio);

  let raw = 4;
  raw += Math.min(Math.log2(filteredMentions + 1) * 0.9, 2.5) * signalQualityMultiplier;
  raw += Math.max(Math.min(sentimentScore * 2.5 * confidence, 2), -2);
  raw += Math.min(narratives * 0.25, 1.5);

  return {
    score: clampScore(raw),
    reasoning: `Filtered mentions ${filteredMentions} (${botFilteredCount} bots filtered), sentiment score ${sentimentScore.toFixed(2)}, confidence ${confidence.toFixed(2)}, signal quality ${(signalQualityMultiplier * 100).toFixed(0)}%, narratives ${narratives}.`,
  };
}

function scoreDevelopment(github = {}) {
  const contributors = safeNumber(github.contributors);
  const commits90d = safeNumber(github.commits_90d);
  const stars = safeNumber(github.stars);
  const forks = safeNumber(github.forks);
  const openIssues = safeNumber(github.open_issues);
  const lastCommitDate = github?.last_commit?.date ? new Date(github.last_commit.date) : null;
  const daysSinceCommit = lastCommitDate && !Number.isNaN(lastCommitDate.getTime())
    ? (Date.now() - lastCommitDate.getTime()) / 86400000
    : null;
  const issuePressure = commits90d > 0 ? openIssues / commits90d : openIssues > 0 ? openIssues : 0;

  // Commit trend bonus/penalty (new field from improved github collector)
  const commitTrend = github.commit_trend;
  const commits30d = safeNumber(github.commits_30d);
  const commits30dPrev = safeNumber(github.commits_30d_prev);

  let raw = 4;
  raw += Math.min(contributors / 5, 2.5);
  raw += Math.min(commits90d / 30, 2.5);
  raw += stars > 0 ? Math.min(Math.log10(stars + 1), 1) : 0;
  raw += forks > 0 ? Math.min(Math.log10(forks + 1) * 0.5, 0.8) : 0;

  if (daysSinceCommit != null) {
    if (daysSinceCommit <= 7) raw += 0.8;
    else if (daysSinceCommit <= 14) raw += 0.4;
    else if (daysSinceCommit > 180) raw -= Math.min((daysSinceCommit - 180) / 90, 1.2);
  }

  if (issuePressure > 1.5) {
    raw -= Math.min((issuePressure - 1.5) * 0.25, 0.8);
  }

  // Commit trend adjustment
  if (commitTrend === 'accelerating') raw += 0.5;
  else if (commitTrend === 'decelerating') raw -= 0.4;
  else if (commitTrend === 'inactive') raw -= 1.0;

  // Round 29: CI bonus — having CI workflows = professional dev practice
  if (github.has_ci === true) raw += 0.3;

  // Round 33: Star velocity — rapidly growing star count is a health indicator
  // Use watchers as a proxy if forks are very few (niche but real)
  const watchers = safeNumber(github.watchers ?? 0);
  if (stars > 0 && watchers > 0) {
    const watcherStarRatio = watchers / stars;
    if (watcherStarRatio > 0.5 && watchers > 50) raw += 0.2; // many watchers = active maintainer interest
  }

  // Round 33: multi-language repos signal broader ecosystem integration
  const languageCount = typeof github.languages === 'object' ? Object.keys(github.languages ?? {}).length : 0;
  if (languageCount >= 4) raw += 0.15; // polyglot repo = more integrations

  return {
    score: clampScore(raw),
    reasoning: `Contributors ${contributors}, commits_90d ${commits90d}, commits_30d ${commits30d}/${commits30dPrev} (trend: ${commitTrend || 'n/a'}), stars ${stars}, forks ${forks}, watchers ${watchers}, langs ${languageCount}, issue pressure ${issuePressure.toFixed(2)}, days since last commit ${daysSinceCommit == null ? 'n/a' : daysSinceCommit.toFixed(0)}${github.has_ci ? ', CI ✓' : ''}.`,
  };
}

function scoreTokenomicsRisk(tokenomics = {}) {
  // Cap at 100 — CoinGecko sometimes reports circulating > total due to rounding
  const pctCirculating = Math.min(safeNumber(tokenomics.pct_circulating), 100);
  const inflation = safeNumber(tokenomics.inflation_rate);
  const hasDistribution = tokenomics.token_distribution ? 1 : 0;
  const hasRoiData = tokenomics.roi_data ? 1 : 0;
  const unlockOverhangPct = tokenomics.unlock_overhang_pct != null
    ? safeNumber(tokenomics.unlock_overhang_pct)
    : null;
  const dilutionRisk = tokenomics.dilution_risk;

  // Base 5 (midpoint of 1-10), consistent with other scoring dimensions
  let raw = 5;
  if (pctCirculating > 0) {
    // Reward high circulating supply (less unlock risk), max +2.5 at 100%
    raw += Math.min(pctCirculating / 40, 2.5);
  } else {
    raw -= 1;
  }

  raw -= Math.min(Math.max(inflation, 0) / 10, 3);
  raw += hasDistribution ? 0.5 : -0.5;
  raw += hasRoiData ? 0.3 : 0;

  // Additional dilution risk penalty using unlock overhang
  if (dilutionRisk === 'high') raw -= 1.0;
  else if (dilutionRisk === 'medium') raw -= 0.4;
  // 'low' → no penalty (already captured in pctCirculating bonus)

  return {
    score: clampScore(raw),
    reasoning: `Pct circulating ${pctCirculating.toFixed(2)}%, unlock overhang ${unlockOverhangPct != null ? `${unlockOverhangPct.toFixed(1)}%` : 'n/a'} (${dilutionRisk || 'unknown'} dilution risk), inflation ${inflation.toFixed(2)}%, distribution ${hasDistribution ? 'available' : 'missing'}.`,
  };
}

function scoreDistribution(tokenomics = {}, market = {}) {
  const dist = tokenomics.token_distribution;
  const pctCirculating = Math.min(safeNumber(tokenomics.pct_circulating), 100);
  const unlockOverhang = tokenomics.unlock_overhang_pct != null ? safeNumber(tokenomics.unlock_overhang_pct) : null;
  const dilutionRisk = tokenomics.dilution_risk;
  const mcap = safeNumber(market.market_cap);
  const fdv = safeNumber(market.fully_diluted_valuation || market.fdv);

  let raw = 5;
  const parts = [];

  // FDV/MCap ratio — high ratio = lots of tokens not yet in circulation
  if (fdv > 0 && mcap > 0) {
    const fdvRatio = fdv / mcap;
    if (fdvRatio <= 1.2) { raw += 2; parts.push(`FDV/MCap ${fdvRatio.toFixed(2)} (excellent)`); }
    else if (fdvRatio <= 2) { raw += 1; parts.push(`FDV/MCap ${fdvRatio.toFixed(2)} (good)`); }
    else if (fdvRatio <= 5) { raw -= 0.5; parts.push(`FDV/MCap ${fdvRatio.toFixed(2)} (moderate dilution risk)`); }
    else { raw -= 1.5; parts.push(`FDV/MCap ${fdvRatio.toFixed(2)} (high dilution risk)`); }
  } else {
    parts.push('FDV/MCap n/a');
  }

  // Circulating supply ratio
  if (pctCirculating > 80) { raw += 1; parts.push(`${pctCirculating.toFixed(0)}% circulating (low risk)`); }
  else if (pctCirculating > 50) { parts.push(`${pctCirculating.toFixed(0)}% circulating`); }
  else if (pctCirculating > 0) { raw -= 1; parts.push(`${pctCirculating.toFixed(0)}% circulating (high unlock risk)`); }

  // Unlock overhang
  if (unlockOverhang != null) {
    if (unlockOverhang > 40) { raw -= 1; parts.push(`unlock overhang ${unlockOverhang.toFixed(0)}% (dangerous)`); }
    else if (unlockOverhang > 20) { raw -= 0.5; parts.push(`unlock overhang ${unlockOverhang.toFixed(0)}%`); }
    else { raw += 0.5; parts.push(`unlock overhang ${unlockOverhang.toFixed(0)}% (safe)`); }
  }

  // Dilution risk tier
  if (dilutionRisk === 'high') raw -= 0.5;
  else if (dilutionRisk === 'low') raw += 0.3;

  // Distribution data availability bonus
  if (dist) { raw += 0.3; parts.push('distribution data available'); }

  return {
    score: clampScore(raw),
    reasoning: parts.join(', ') || 'No distribution data available.',
  };
}

// ─── Round 11: Risk score ─────────────────────────────────────────────────────
/**
 * Composite risk score (1–10 where 10 = LOW risk / safest).
 * Components: volatility, liquidity depth, concentration risk, age risk.
 */
function scoreRisk(market = {}, onchain = {}, tokenomics = {}, dexData = {}, holderData = {}) {
  let raw = 6; // Start slightly above midpoint (assume moderate risk by default)

  // 1. Volatility risk: large price swings = higher risk
  const change24h = Math.abs(safeNumber(market.price_change_pct_24h));
  const change7d  = Math.abs(safeNumber(market.price_change_pct_7d));
  const volatility = (change24h * 0.6) + (change7d * 0.4);
  if (volatility > 30) raw -= 2.5;
  else if (volatility > 15) raw -= 1.5;
  else if (volatility > 7)  raw -= 0.7;
  else if (volatility < 3)  raw += 0.5; // Very stable = lower risk

  // 2. Liquidity depth: use DEX data if available, otherwise volume/mcap proxy
  const dexLiquidity = safeNumber(dexData.liquidity ?? dexData.total_liquidity);
  const mcap   = safeNumber(market.market_cap);
  const volume = safeNumber(market.total_volume);
  if (dexLiquidity > 0) {
    const liqScore = Math.min(Math.log10(dexLiquidity + 1), 7);
    raw += (liqScore - 4) * 0.3; // ±0.9 range
  } else if (mcap > 0 && volume > 0) {
    const volRatio = volume / mcap;
    if (volRatio > 0.1) raw += 0.5;
    else if (volRatio < 0.01) raw -= 0.8; // Very illiquid
  }

  // 3. Concentration risk: whale concentration = higher risk (lower score)
  const topConcentration = safeNumber(
    holderData.top10_concentration ?? holderData.concentration_pct ?? 0
  );
  if (topConcentration > 60) raw -= 2;
  else if (topConcentration > 40) raw -= 1;
  else if (topConcentration > 20) raw -= 0.4;
  else if (topConcentration > 0 && topConcentration <= 15) raw += 0.5; // Well distributed

  // 4. Age risk: very new projects carry more uncertainty
  const genesisDate = market.genesis_date ?? tokenomics.genesis_date;
  if (genesisDate) {
    const ageMonths = (Date.now() - new Date(genesisDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonths < 2)  raw -= 1.5;
    else if (ageMonths < 6)  raw -= 0.8;
    else if (ageMonths > 36) raw += 0.5; // Battle-tested
  }

  // 5. FDV/MCap extreme ratio = token unlock risk
  const fdv = safeNumber(market.fully_diluted_valuation ?? market.fdv);
  if (fdv > 0 && mcap > 0) {
    const fdvRatio = fdv / mcap;
    if (fdvRatio > 10) raw -= 1.5;
    else if (fdvRatio > 5) raw -= 0.7;
  }

  // Round 24: revenue_efficiency bonus — protocols generating fees relative to TVL are less risky
  const revEfficiency = safeNumber(onchain.revenue_efficiency ?? 0);
  if (revEfficiency > 100) raw += 0.5;   // >$100/week per $1M TVL = good efficiency
  else if (revEfficiency > 20) raw += 0.2;

  // Round 5: DEX buy/sell pressure — net buy pressure = lower risk, sell pressure = higher risk
  const pressureSignal = dexData.pressure_signal;
  const buySellRatio = safeNumber(dexData.buy_sell_ratio ?? 1);
  if (pressureSignal === 'buy_pressure') {
    raw += Math.min((buySellRatio - 1) * 0.5, 0.5); // max +0.5 for strong buy pressure
  } else if (pressureSignal === 'sell_pressure') {
    raw -= Math.min((1 - buySellRatio) * 0.8, 0.8); // max -0.8 for strong sell pressure
  }

  return {
    score: clampScore(raw),
    reasoning: `Volatility ${volatility.toFixed(1)}%, liquidity ${dexLiquidity > 0 ? `$${dexLiquidity.toFixed(0)}` : `vol/mcap ${mcap > 0 ? (volume / mcap).toFixed(3) : 'n/a'}`}, concentration ${topConcentration > 0 ? `${topConcentration.toFixed(1)}%` : 'n/a'}, rev_efficiency ${revEfficiency > 0 ? `$${revEfficiency.toFixed(0)}/M TVL/wk` : 'n/a'}${pressureSignal ? `, DEX ${pressureSignal} (ratio: ${buySellRatio.toFixed(2)})` : ''}.`,
  };
}

// ─── Round 17: Sector-relative scoring ───────────────────────────────────────
/**
 * Adjust dimension scores relative to sector medians.
 * Returns each dimension with both raw_score and sector_adjusted_score.
 *
 * @param {object} scores           - calculateScores() result
 * @param {object} sectorComparison - { tvl_median, mcap_median, ... }
 */
export function applySectorRelativeScoring(scores, sectorComparison = {}) {
  const adjusted = {};
  const sc = sectorComparison;

  for (const [dim, val] of Object.entries(scores)) {
    if (dim === 'overall' || typeof val !== 'object' || val.score == null) {
      adjusted[dim] = val;
      continue;
    }

    let adjustment = 0;

    if (dim === 'onchain_health') {
      const tvl = safeNumber(sc.project_tvl ?? sc.tvl);
      const tvlMedian = safeNumber(sc.tvl_median);
      if (tvl > 0 && tvlMedian > 0) {
        const ratio = tvl / tvlMedian;
        if (ratio >= 2)      adjustment = Math.min((ratio - 1) * 0.5, 1.0); // Up to +1.0
        else if (ratio < 0.5) adjustment = Math.max((ratio - 1) * 0.5, -0.5); // Down to -0.5
      }
    }

    if (dim === 'market_strength') {
      const mcap = safeNumber(sc.project_mcap ?? sc.mcap);
      const mcapMedian = safeNumber(sc.mcap_median);
      if (mcap > 0 && mcapMedian > 0 && mcap < mcapMedian) {
        const ratio = mcap / mcapMedian;
        adjustment = Math.max((ratio - 1) * 0.4, -0.4); // Slight penalty up to -0.4
      }
    }

    adjusted[dim] = {
      ...val,
      raw_score: val.score,
      sector_adjusted_score: clampScore(val.score + adjustment),
      sector_adjustment: parseFloat(adjustment.toFixed(2)),
    };
  }

  if (scores.overall) {
    adjusted.overall = scores.overall;
  }

  return adjusted;
}

function collectorCompleteness(data = {}) {
  const sections = ['market', 'onchain', 'social', 'github', 'tokenomics'];
  const ok = sections.filter((key) => data?.[key] && !data[key].error).length;
  return ok / sections.length;
}

// Use empty object for collectors that errored — prevents phantom scores from
// error fields leaking into downstream scoring functions.
function safeCollector(raw) {
  if (!raw || typeof raw !== 'object' || raw.error) return {};
  return raw;
}

// ─── Round 9: Reddit sentiment supplement ────────────────────────────────────
/**
 * Adjust social momentum score using Reddit post count and sentiment.
 * Small adjustment (+/-0.5) to avoid over-weighting uncurated posts.
 */
function applyRedditSupplement(socialScore, reddit = {}) {
  if (!reddit || reddit.error) return socialScore;
  const postCount = Number(reddit.post_count ?? 0);
  const sentiment = reddit.sentiment;
  if (postCount === 0) return socialScore;
  let adj = 0;
  if (sentiment === 'bullish' && postCount >= 5) adj = 0.4;
  else if (sentiment === 'bullish' && postCount >= 2) adj = 0.2;
  else if (sentiment === 'bearish' && postCount >= 5) adj = -0.4;
  else if (sentiment === 'bearish' && postCount >= 2) adj = -0.2;
  return Math.min(10, Math.max(1, parseFloat((socialScore + adj).toFixed(1))));
}

export function calculateScores(data) {
  const market_strength   = scoreMarketStrength(safeCollector(data?.market));
  const onchain_health    = scoreOnchainHealth(safeCollector(data?.onchain));
  const social_momentum   = scoreSocialMomentum(safeCollector(data?.social));
  const development       = scoreDevelopment(safeCollector(data?.github));
  const tokenomics_health = scoreTokenomicsRisk(safeCollector(data?.tokenomics));
  const distribution      = scoreDistribution(safeCollector(data?.tokenomics), safeCollector(data?.market));

  // Round 9: Reddit supplement to social momentum
  social_momentum.score = applyRedditSupplement(social_momentum.score, data?.reddit);

  // Round 11: Risk as 7th dimension
  const risk = scoreRisk(
    safeCollector(data?.market),
    safeCollector(data?.onchain),
    safeCollector(data?.tokenomics),
    data?.dex ?? data?.dexData ?? {},
    data?.holders ?? data?.holderData ?? {}
  );

  const completeness = collectorCompleteness(data);

  // Round 18: Confidence per dimension
  const confidence = calculateConfidence(data ?? {});
  market_strength.confidence   = confidence.market;
  onchain_health.confidence    = confidence.onchain;
  social_momentum.confidence   = confidence.social;
  development.confidence       = confidence.development;
  tokenomics_health.confidence = confidence.tokenomics;
  distribution.confidence      = confidence.tokenomics; // shares tokenomics data source
  risk.confidence              = Math.round((confidence.market + confidence.onchain + confidence.tokenomics) / 3);

  // 7-dimension weights (Round 11): original 6 each reduced ~1.5%, new risk at 10%
  const WEIGHTS = {
    market:      0.19,
    onchain:     0.19,
    social:      0.12,
    development: 0.16,
    tokenomics:  0.14,
    distribution: 0.14,
    risk:        0.10, // new dimension (Round 11)
  };

  let overallValue =
    market_strength.score   * WEIGHTS.market +
    onchain_health.score    * WEIGHTS.onchain +
    social_momentum.score   * WEIGHTS.social +
    development.score       * WEIGHTS.development +
    tokenomics_health.score * WEIGHTS.tokenomics +
    distribution.score      * WEIGHTS.distribution +
    risk.score              * WEIGHTS.risk;

  // Penalize when data is incomplete — max -2 points when all collectors fail
  if (completeness < 1) {
    const penalty = (1 - completeness) * 2;
    overallValue = Math.max(1, overallValue - penalty);
  }

  // Round 54: confidence-weighted regression to mean — low confidence pulls score toward 5.5
  // Prevents extreme scores (1 or 10) from appearing authoritative with sparse data
  const overallConf = confidence.overall_confidence;
  if (overallConf < 60) {
    const regressionStrength = (60 - overallConf) / 60; // 0 at 60% conf, 1 at 0% conf
    const NEUTRAL = 5.5;
    overallValue = overallValue + (NEUTRAL - overallValue) * regressionStrength * 0.4; // max 40% pull toward neutral
  }

  const weightStr = Object.entries(WEIGHTS)
    .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
    .join(', ');

  return {
    market_strength,
    onchain_health,
    social_momentum,
    development,
    tokenomics_health,
    distribution,
    risk,
    overall: {
      score: clampScore(overallValue),
      completeness: Math.round(completeness * 100),
      overall_confidence: confidence.overall_confidence,
      reasoning: `Weighted blend: ${weightStr}. Data completeness: ${Math.round(completeness * 100)}%. Overall confidence: ${confidence.overall_confidence}%.`,
    },
  };
}

// ─── Re-export companion services for unified import ─────────────────────────
export { detectRedFlags }   from '../services/red-flags.js';
export { detectAlphaSignals } from '../services/alpha-signals.js';
export { calculateMomentum }  from '../services/momentum.js';
export { generateThesis }     from '../services/thesis-generator.js';
export { storeScores, getPercentile, getAllPercentiles, initScoreHistory } from '../services/percentile-store.js';
export { calibrateScores }    from '../services/score-calibration.js';
