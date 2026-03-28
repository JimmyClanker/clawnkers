import { safeNum } from '../utils/math.js';
import { safeNumber } from '../utils/math.js';
/**
 * Circuit breakers: condizioni che impongono un tetto allo score.
 * Vengono applicati DOPO il calcolo del weighted score.
 *
 * Filosofia: certi rischi sono binari. Non li "pesi" — li applichi
 * come vincoli hard.
 */

export function applyCircuitBreakers(overallScore, rawData, scores, redFlags) {
  const breakers = [];
  const market = rawData?.market ?? {};
  const holders = rawData?.holders ?? {};
  const dex = rawData?.dex ?? {};
  const contract = rawData?.contract ?? {};
  const onchain = rawData?.onchain ?? {};

  // ── CRITICAL BREAKERS: Cap a 4.0 (max AVOID) ─────────────────────────────

  // Whale concentration > 70%
  // Round 345 (AutoResearch): include collector field name 'top10_holder_concentration_pct' in fallback chain
  // Round 36 (AutoResearch): use safeNum to guard NaN/Infinity/string inputs from holder data
  const _rawWhaleConc = holders.top10_concentration ?? holders.concentration_pct ?? holders.top10_concentration_pct ?? holders.top10_holder_concentration_pct ?? 0;
  const whaleConc = safeNum(_rawWhaleConc) ?? 0;
  if (whaleConc > 70) {
    breakers.push({
      cap: 4.0,
      reason: `Whale concentration ${whaleConc.toFixed(0)}% > 70% — single entity risk`,
      severity: 'critical',
    });
  }

  // DEX liquidity < $10K (untradeable)
  const dexLiq = dex.dex_liquidity_usd ?? dex.liquidity ?? dex.total_liquidity ?? 0;
  if (dexLiq > 0 && dexLiq < 10_000) {
    breakers.push({
      cap: 4.0,
      reason: `DEX liquidity $${(dexLiq / 1000).toFixed(1)}K — untradeable`,
      severity: 'critical',
    });
  }

  // Contratto non verificato su chain non-major
  const primaryChain = (rawData?.ecosystem?.primary_chain || '').toLowerCase();
  const isMainChain = ['ethereum', 'solana', 'base', 'arbitrum', 'polygon', 'bnb', 'avalanche', 'optimism']
    .some((c) => primaryChain.includes(c));
  if (contract.verified === false && !isMainChain && primaryChain !== '') {
    breakers.push({
      cap: 4.0,
      reason: 'Unverified contract on minor chain — rug pull risk',
      severity: 'critical',
    });
  }

  // Pump-dump pattern rilevato
  if (dex.pump_dump_signal === 'possible_dump') {
    breakers.push({
      cap: 3.5,
      reason: 'Active dump pattern detected on DEX',
      severity: 'critical',
    });
  }

  // Round 141 (AutoResearch): DEX liquidity in "extremely thin" zone ($10K-$50K) = warning cap
  // Not quite untradeable but severe slippage risk for any meaningful position
  // Round 42 (AutoResearch): also add thin zone ($50K-$200K) = mild cap at 7.0
  // Tokens with $50K-$200K liquidity can be traded but large positions will move price significantly
  if (dexLiq >= 50_000 && dexLiq < 200_000) {
    breakers.push({
      cap: 7.0,
      reason: `DEX liquidity $${(dexLiq / 1000).toFixed(0)}K — thin liquidity, significant slippage for position sizes >$10K`,
      severity: 'warning',
    });
  }
  if (dexLiq >= 10_000 && dexLiq < 50_000) {
    breakers.push({
      cap: 5.5,
      reason: `DEX liquidity $${(dexLiq / 1000).toFixed(1)}K — extremely thin, severe slippage risk`,
      severity: 'warning',
    });
  }

  // ── WARNING BREAKERS: Cap a 6.5 (max HOLD) ───────────────────────────────

  // Whale concentration > 40%
  if (whaleConc > 40 && whaleConc <= 70) {
    breakers.push({
      cap: 6.5,
      reason: `Whale concentration ${whaleConc.toFixed(0)}% — elevated exit risk`,
      severity: 'warning',
    });
  }

  // FDV/MCap > 10x
  // Round 346 (AutoResearch): added $1M minimum mcap — micro-cap tokens with high FDV ratio are
  // a different risk profile that's already captured by the low_market_cap red flag
  const fdv = market.fully_diluted_valuation ?? market.fdv ?? 0;
  const mcap = market.market_cap ?? 0;
  if (fdv > 0 && mcap > 1_000_000 && fdv / mcap > 10) {
    breakers.push({
      cap: 6.5,
      reason: `FDV/MCap ${(fdv / mcap).toFixed(1)}x — massive unlock overhang`,
      severity: 'warning',
    });
  }

  // Volume < $50K e mcap > $5M (illiquid per la sua size)
  const vol = market.total_volume ?? 0;
  if (vol > 0 && vol < 50_000 && mcap > 5_000_000) {
    breakers.push({
      cap: 6.5,
      reason: `Volume $${(vol / 1000).toFixed(0)}K vs mcap $${(mcap / 1e6).toFixed(1)}M — critically illiquid`,
      severity: 'warning',
    });
  }

  // Round 237 (AutoResearch nightly): Zero volume with high market cap — ghost token
  // A token with >$5M mcap and literally zero 24h volume is likely exchange-delisted or dead
  if ('total_volume' in market && safeNum(market.total_volume) === 0 && mcap > 5_000_000) {
    breakers.push({
      cap: 4.0,
      reason: `Zero 24h trading volume with $${(mcap / 1e6).toFixed(1)}M market cap — ghost token or exchange-delisted`,
      severity: 'critical',
    });
  }

  // Round 237b (AutoResearch nightly): No GitHub + large market cap — major red flag for tech projects
  // A token with >$50M mcap and no verifiable GitHub = either not open-source (centralized risk) or ghost project
  const github = rawData?.github ?? {};
  const hasGithubData = !github.error && (github.commits_90d > 0 || github.stars > 0);
  const isObviouslyNonTech = ['meme', 'wrapped', 'stablecoin'].some(
    t => String(rawData?.onchain?.category || '').toLowerCase().includes(t)
  );
  if (!hasGithubData && mcap > 50_000_000 && !isObviouslyNonTech) {
    breakers.push({
      cap: 6.5,
      reason: `No GitHub activity detected with $${(mcap / 1e6).toFixed(1)}M market cap — development unverifiable for non-meme, non-stablecoin token`,
      severity: 'warning',
    });
  }

  // Data completeness < 40%
  // Round 337 (AutoResearch): tiered completeness caps — very low data = stronger cap
  const completeness = scores?.overall?.completeness ?? 100;
  if (completeness < 20) {
    breakers.push({
      cap: 5.0,
      reason: `Only ${completeness}% data coverage — extremely limited data, score is speculative`,
      severity: 'warning',
    });
  } else if (completeness < 40) {
    breakers.push({
      cap: 6.0,
      reason: `Only ${completeness}% data coverage — insufficient for conviction`,
      severity: 'warning',
    });
  }

  // Conservative gate: low overall data confidence should cap conviction even if score looks good.
  const overallConfidence = safeNum(scores?.overall?.overall_confidence ?? scores?.overall?.confidence ?? 100);
  if (overallConfidence < 30) {
    breakers.push({
      cap: 5.0,
      reason: `Overall data confidence only ${overallConfidence}% — too much uncertainty for a high-conviction rating`,
      severity: 'warning',
    });
  } else if (overallConfidence < 45) {
    breakers.push({
      cap: 6.0,
      reason: `Overall data confidence only ${overallConfidence}% — conviction should stay capped until collectors agree`,
      severity: 'warning',
    });
  }

  // 3+ critical red flags
  const criticalFlags = (redFlags || []).filter((f) => f.severity === 'critical');
  if (criticalFlags.length >= 3) {
    breakers.push({
      cap: 5.0,
      reason: `${criticalFlags.length} critical red flags — structural risk`,
      severity: 'warning',
    });
  }

  // Category uncertainty: if we are not sure what the thing is, we should not issue a high-conviction call.
  const categoryConfidence = safeNum(scores?.overall?.category_confidence ?? 100);
  if (categoryConfidence < 45 && overallScore > 6.5) {
    breakers.push({
      cap: 6.5,
      reason: `Category confidence only ${categoryConfidence}% — project classification is too uncertain for a strong BUY/STRONG BUY call`,
      severity: 'warning',
    });
  }

  // No-dev + opaque tokenomics + loud social = classic false-positive cocktail.
  const mentionsForHype = safeNum(rawData?.social?.filtered_mentions ?? rawData?.social?.mentions ?? 0);
  const commits90d = safeNum(rawData?.github?.commits_90d ?? 0);
  const pctCirc = rawData?.tokenomics?.pct_circulating;
  const tokenomicsOpaque = pctCirc == null && rawData?.tokenomics?.error == null;
  if (mentionsForHype >= 20 && commits90d === 0 && tokenomicsOpaque) {
    breakers.push({
      cap: 5.5,
      reason: `High social noise (${mentionsForHype} mentions) with zero development activity and opaque circulating supply — hype without verification`,
      severity: 'warning',
    });
  }

  // Round 236 (AutoResearch): Extreme sell dominance on DEX — 5:1+ sell ratio = active exit
  // When sellers outnumber buyers 5:1 or more, it signals an organized exit or token unlock dump
  const buys24h = safeNum(dex?.buys_24h ?? 0);
  const sells24h = safeNum(dex?.sells_24h ?? 0);
  if (sells24h > 0 && buys24h > 0 && sells24h / buys24h >= 5 && (buys24h + sells24h) >= 100) {
    breakers.push({
      cap: 4.5,
      reason: `Extreme sell dominance: ${sells24h}/${buys24h} sell/buy ratio (${(sells24h/buys24h).toFixed(1)}:1) with ${buys24h+sells24h} transactions — likely organized exit`,
      severity: 'critical',
    });
  }

  // Round 236 (AutoResearch): 52-week low + negative score combination
  // If price is near 52w low AND overall score < 4, cap at 4.5 (no false buy signals from algo)
  const vs52w = rawData?.market?.price_vs_52w;
  if (vs52w?.tier === 'near_low' && scores?.overall?.score < 4.0) {
    breakers.push({
      cap: 4.5,
      reason: `Price near 52-week low (${vs52w.pct_from_52w_high?.toFixed(1)}% from high) combined with weak fundamentals — structural bear trap risk`,
      severity: 'warning',
    });
  }

  // Zero revenue su DeFi protocol con 2+ anni
  const genesisDate = market.genesis_date;
  const fees7d = onchain.fees_7d ?? 0;
  const revenue7d = onchain.revenue_7d ?? 0;
  if (genesisDate) {
    const ageMonths = (Date.now() - new Date(genesisDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonths > 24 && fees7d > 100_000 && revenue7d === 0) {
      breakers.push({
        cap: 6.0,
        reason: 'Mature protocol with zero revenue capture — no value accrual to token',
        severity: 'warning',
      });
    }
  }

  // Round 34 (AutoResearch): Stablecoin de-peg circuit breaker
  // If a token is supposed to be pegged to $1 but is significantly off-peg, cap score
  const symbol = (market.symbol || '').toUpperCase();
  const currentPrice = market.current_price ?? market.price ?? 0;
  // Round 148 (AutoResearch): Extended stablecoin list including algo-stables and newer issuers
  const STABLECOIN_SYMBOLS = new Set([
    'USDT', 'USDC', 'DAI', 'BUSD', 'FRAX', 'LUSD', 'USDD', 'FDUSD', 'PYUSD',
    'USDE', 'USDX', 'SUSD', 'EURS', 'TUSD', 'GUSD', 'USDP',
    'CRVUSD', 'GHO', 'USDN', 'USDD', 'USDJ', 'DOLA', 'BEAN', 'CUSD',
    'USDS', 'USDZ', 'USDM', 'ZUSD', 'USDV',
  ]);
  if (STABLECOIN_SYMBOLS.has(symbol) && currentPrice > 0) {
    const depegPct = Math.abs((currentPrice - 1.0) / 1.0) * 100;
    if (depegPct > 10) {
      breakers.push({
        cap: 3.0,
        reason: `Stablecoin de-peg: ${symbol} trading at $${currentPrice.toFixed(4)} (${depegPct.toFixed(1)}% off peg) — critical stability failure`,
        severity: 'critical',
      });
    } else if (depegPct > 3) {
      breakers.push({
        cap: 5.0,
        reason: `Stablecoin de-peg risk: ${symbol} at $${currentPrice.toFixed(4)} (${depegPct.toFixed(1)}% off $1 peg)`,
        severity: 'warning',
      });
    }
  }

  // Round 127 (AutoResearch): DeFi ghost protocol — significant TVL but zero social presence
  // This is unusual and may indicate: abandoned project, bot TVL, or data collection failure
  const socialMentions = safeNum(rawData?.social?.mentions ?? rawData?.social?.filtered_mentions ?? 0);
  const tvlForGhost = safeNum(onchain.tvl ?? 0);
  if (tvlForGhost > 100_000_000 && socialMentions === 0 && !rawData?.social?.error) {
    breakers.push({
      cap: 6.5,
      reason: `DeFi protocol with $${(tvlForGhost / 1e9).toFixed(2)}B TVL but zero social mentions — potential ghost protocol or data anomaly`,
      severity: 'warning',
    });
  }

  // Round 132 (AutoResearch): Persistent revenue decline for DeFi protocols
  // If revenue_7d and revenue_30d show consistent negative trend, the protocol is losing value capture
  const rev7d = safeNum(onchain.revenue_7d ?? 0);
  const rev30d = safeNum(onchain.revenue_30d ?? 0);
  const rev7dPrev = safeNum(onchain.revenue_7d_prev ?? 0);
  const fees7dR132 = safeNum(onchain.fees_7d ?? 0); // renamed to avoid duplicate with later declaration
  if (fees7dR132 > 100_000 && rev7d > 0 && rev7dPrev > 0) {
    const revenueDeclinePct = ((rev7d - rev7dPrev) / rev7dPrev) * 100;
    // If 7d revenue is down > 50% vs prior 7d and monthly revenue also in decline
    const monthlyDecline = rev30d > 0 && (rev7d * 4.33) < rev30d * 0.5;
    if (revenueDeclinePct < -50 && monthlyDecline) {
      breakers.push({
        cap: 6.5,
        reason: `Persistent revenue collapse: ${revenueDeclinePct.toFixed(0)}% 7d revenue decline — protocol losing value accrual`,
        severity: 'warning',
      });
    }
  }

  // Round 127 (AutoResearch): Negative token velocity — market cap >> 100x volume
  // Token velocity < 0.01% = nearly untradeable despite market cap
  const mcapForVelocity = safeNum(market.market_cap ?? 0);
  const volForVelocity = safeNum(market.total_volume ?? 0);
  if (mcapForVelocity > 10_000_000 && volForVelocity > 0) {
    const velocityPct = (volForVelocity / mcapForVelocity) * 100;
    if (velocityPct < 0.01) {
      breakers.push({
        cap: 6.0,
        reason: `Extremely low token velocity (${velocityPct.toFixed(4)}% daily turnover) — token is functionally illiquid despite market cap`,
        severity: 'warning',
      });
    }
  }

  // Round 34 (AutoResearch): Active dump pattern + no liquidity = cascading failure risk
  if (dex.pump_dump_signal === 'possible_dump') {
    const dexLiqForDump = dex.dex_liquidity_usd ?? dex.liquidity ?? dex.total_liquidity ?? 0;
    if (dexLiqForDump < 500_000 && dexLiqForDump > 0) {
      breakers.push({
        cap: 3.0,
        reason: `Active dump + thin liquidity ($${(dexLiqForDump / 1000).toFixed(0)}K) — severe price collapse risk`,
        severity: 'critical',
      });
    }
  }

  // Round 44 (AutoResearch): circulating supply > max supply anomaly guard
  // When circulating > max supply (pct_circulating > 105%), CoinGecko data is likely corrupted
  // This would give an undeserved tokenomics bonus — cap score to prevent false-positive
  const rawData44 = rawData ?? {};
  const pctCirc44 = safeNum(rawData44?.tokenomics?.pct_circulating ?? null);
  const mcap44 = safeNum(market.market_cap ?? 0);
  if (pctCirc44 != null && pctCirc44 > 110 && mcap44 > 1_000_000) {
    breakers.push({
      cap: 6.5,
      reason: `Data anomaly: circulating supply reported as ${pctCirc44.toFixed(0)}% of max supply — CoinGecko data may be corrupted, tokenomics score unreliable`,
      severity: 'warning',
    });
  }

  // Round R12 (AutoResearch batch): Suspicious volume — 24h vol < 0.05% of market cap for established coin
  // Very low token velocity for a mid-cap coin = illiquid, manipulation risk, hard to exit
  const mcapR12 = safeNum(market.market_cap ?? 0);
  const vol24hR12 = safeNum(market.total_volume ?? 0);
  const vol7dAvgR12 = safeNum(market.volume_7d_avg ?? 0);
  if (mcapR12 > 50_000_000 && vol24hR12 > 0 && vol7dAvgR12 > 0) {
    // If today's volume is suspiciously 10x+ above 7d average = possible wash trading
    const spikeRatio = vol24hR12 / vol7dAvgR12;
    if (spikeRatio > 10 && vol24hR12 > 5_000_000) {
      breakers.push({
        cap: 7.0,
        reason: `Volume spike ${spikeRatio.toFixed(0)}x above 7d average — possible wash trading or exit pump; data may be misleading`,
        severity: 'warning',
      });
    }
  }

  // Round R12: Zero liquidity + high score guard
  // A project with no DEX liquidity cannot be traded and should never score above 7.0
  const dexLiqR12 = safeNum(dex.dex_liquidity_usd ?? dex.liquidity ?? dex.total_liquidity ?? 0);
  const mcapR12b = safeNum(market.market_cap ?? 0);
  if (dexLiqR12 === 0 && mcapR12b > 0 && mcapR12b < 10_000_000 && !onchain.tvl) {
    breakers.push({
      cap: 6.5,
      reason: `No DEX liquidity found for small-cap token — tradability unverified`,
      severity: 'warning',
    });
  }

  // Round 155 (AutoResearch): governance_mentions signal — active governance = reduced circuit breaker risk
  // If governance is active, relax the "no_onchain_data" risk for established protocols
  // (No new breaker needed here — governance is an amelioration signal, not a new risk)

  // Round 155 (AutoResearch): Negative real yield circuit breaker
  // When estimated weekly token emissions are 5x+ protocol fees, the yield model is Ponzi
  const inflationForCB = safeNum(market.market_cap ?? 0) > 0
    ? safeNum(rawData?.tokenomics?.inflation_rate ?? 0)
    : 0;
  const fees7dCB = safeNum(onchain.fees_7d ?? 0);
  const mcapForCB = safeNum(market.market_cap ?? 0);
  if (inflationForCB > 0 && fees7dCB > 0 && mcapForCB > 0) {
    const weeklyEmissionValue = (inflationForCB / 100) * mcapForCB / 52;
    if (weeklyEmissionValue > fees7dCB * 10) {
      breakers.push({
        cap: 5.5,
        reason: `Emissions/fees ratio >10x (est. $${(weeklyEmissionValue / 1000).toFixed(0)}K/wk emissions vs $${(fees7dCB / 1000).toFixed(0)}K/wk fees) — unsustainable yield model`,
        severity: 'warning',
      });
    }
  }

  // Round 233 (AutoResearch nightly): Social credibility collapse breaker
  // High sentiment_credibility_score (>60) acts as a positive signal, but very low (<15)
  // with many mentions indicates coordinated noise — cap to prevent false signals driving scores up
  // Round 357 (AutoResearch): safeNum(null, null) returns 0 not null — use direct field check instead
  const _rawSocialCredibility = rawData?.social?.sentiment_credibility_score;
  const socialCredibility = _rawSocialCredibility != null ? safeNum(_rawSocialCredibility) : null;
  const socialMentionsForCB = safeNum(rawData?.social?.filtered_mentions ?? rawData?.social?.mentions ?? 0);
  if (socialCredibility !== null && socialCredibility < 15 && socialMentionsForCB >= 10) {
    breakers.push({
      cap: 6.5,
      reason: `Social credibility score critically low (${socialCredibility}/100) despite ${socialMentionsForCB} mentions — likely bot/spam noise`,
      severity: 'warning',
    });
  }

  // Round 212 (AutoResearch): Revenue collapse warning — TVL > $50M with zero fees for >7d
  // Protocols that have significant TVL but generate zero fees may have broken incentives
  const tvlR212 = safeNum(onchain.tvl ?? 0);
  const fees7dR212 = safeNum(onchain.fees_7d ?? 0);
  const categoryR212 = String(onchain.category || '').toLowerCase();
  const isDeFiR212 = /defi|lending|dex|yield|liquidity|bridge|derivatives/.test(categoryR212);
  if (isDeFiR212 && tvlR212 > 50_000_000 && fees7dR212 === 0) {
    breakers.push({
      cap: 6.5,
      reason: `DeFi protocol with $${(tvlR212 / 1_000_000).toFixed(0)}M TVL generates zero fees — value accrual mechanism may be broken`,
      severity: 'warning',
    });
  }

  // Round 234 (AutoResearch): Persistent sell pressure circuit breaker
  // When DEX sellers consistently outnumber buyers 2:1+ with sufficient volume, cap score
  const buys234 = safeNum(dex?.buys_24h ?? 0);
  const sells234 = safeNum(dex?.sells_24h ?? 0);
  const totalTxns234 = buys234 + sells234;
  if (totalTxns234 >= 100 && sells234 > 0 && buys234 / sells234 < 0.4) {
    breakers.push({
      cap: 5.5,
      reason: `Extreme sell pressure: ${buys234} buys vs ${sells234} sells (ratio ${(buys234/sells234).toFixed(2)}) — active distribution phase, not a buying opportunity`,
      severity: 'warning',
    });
  }

  // Round 235 (AutoResearch): Extreme FDV overhang circuit breaker
  // Less than 5% of supply circulating with >$10M market cap = near-certain future price suppression
  const mcapFdvCB = safeNum(market.market_cap ?? 0);
  const fdvCB = safeNum(market.fully_diluted_valuation ?? 0);
  if (mcapFdvCB > 10_000_000 && fdvCB > 0 && mcapFdvCB / fdvCB < 0.05) {
    breakers.push({
      cap: 5.0,
      reason: `Only ${((mcapFdvCB / fdvCB) * 100).toFixed(1)}% of supply circulating (FDV $${(fdvCB/1e6).toFixed(0)}M vs MCap $${(mcapFdvCB/1e6).toFixed(0)}M) — extreme future dilution risk`,
      severity: 'warning',
    });
  }

  // Round 238 (AutoResearch): Security breach circuit breaker
  // When multiple news articles report active hacks/exploits, cap score aggressively
  // Round 334 (AutoResearch): only apply to non-meme, non-stablecoin, non-wrapped tokens
  // Meme/stable/wrapped tokens can have high hackMentions from ecosystem news without being directly hacked
  const hackMentions = safeNum((rawData?.social?.hack_exploit_mentions ?? 0) + (rawData?.social?.exploit_mentions ?? 0));
  const _hackSymbol = (market.symbol || '').toUpperCase();
  const _isPassiveHackTarget = /^(USDT|USDC|DAI|WBTC|WETH|WBNB|WRAPPED|STAKED)/.test(_hackSymbol) ||
    String(rawData?.onchain?.category || '').toLowerCase().includes('meme');
  if (!_isPassiveHackTarget) {
    if (hackMentions >= 4) {
      breakers.push({
        cap: 3.5,
        reason: `${hackMentions} news articles report hacks/exploits — active security incident likely, avoid until resolved`,
        severity: 'critical',
      });
    } else if (hackMentions >= 2) {
      breakers.push({
        cap: 5.5,
        reason: `${hackMentions} articles mention security exploits — potential security incident, elevated caution warranted`,
        severity: 'warning',
      });
    }
  }

  // Round 238 (AutoResearch): Revenue collapse breaker — 7d fees < 10% of 30d weekly avg
  // Sudden fee collapse signals a broken protocol, liquidity exit, or exploit aftermath
  const fees7dR238 = safeNum(onchain.fees_7d ?? 0);
  const fees30dR238 = safeNum(onchain.fees_30d ?? 0);
  const tvlR238 = safeNum(onchain.tvl ?? 0);
  if (fees30dR238 > 0 && fees7dR238 > 0 && tvlR238 > 10_000_000) {
    const weeklyAvg = fees30dR238 / 4;
    if (weeklyAvg > 50_000 && fees7dR238 < weeklyAvg * 0.1) {
      breakers.push({
        cap: 5.0,
        reason: `Revenue collapse: 7d fees ($${(fees7dR238 / 1000).toFixed(0)}K) < 10% of 30d weekly avg ($${(weeklyAvg / 1000).toFixed(0)}K) — protocol may be broken or exploited`,
        severity: 'critical',
      });
    }
  }

  // Round 238b (AutoResearch): Mercenary TVL trap — TVL > 10x MCap = incentivized capital at risk
  // When TVL is massively > MCap, it often means unsustainable yield farming is holding capital
  // Round 333 (AutoResearch): raised minimum mcap to $2M — below that, TVL imbalance is noise not signal
  const tvlR238b = safeNum(onchain.tvl ?? 0);
  const mcapR238b = safeNum(market.market_cap ?? 0);
  if (tvlR238b > 0 && mcapR238b > 2_000_000) {
    const tvlMcapRatio = tvlR238b / mcapR238b;
    // Round 37 (AutoResearch): tiered TVL/MCap caps — extreme ratio is stronger signal
    // 15x → warning cap 6.0 (original); 30x → stronger warning cap 5.5 (mercenary liquidity near certain)
    if (tvlMcapRatio > 30) {
      breakers.push({
        cap: 5.5,
        reason: `TVL ($${(tvlR238b / 1e6).toFixed(1)}M) is ${tvlMcapRatio.toFixed(0)}x market cap ($${(mcapR238b / 1e6).toFixed(1)}M) — extreme mercenary capital concentration, mass exit risk when incentives end`,
        severity: 'warning',
      });
    } else if (tvlMcapRatio > 15) {
      breakers.push({
        cap: 6.0,
        reason: `TVL ($${(tvlR238b / 1e6).toFixed(1)}M) is ${tvlMcapRatio.toFixed(0)}x market cap ($${(mcapR238b / 1e6).toFixed(1)}M) — likely mercenary incentivized capital that will exit when rewards end`,
        severity: 'warning',
      });
    }
  }

  // Round 381 (AutoResearch): Wash trading risk circuit breaker
  // When DEX data suggests wash trading (tiny trades cycling liquidity), score becomes unreliable
  const washRisk = dex?.wash_trading_risk;
  if (washRisk === 'high') {
    breakers.push({
      cap: 5.5,
      reason: `Wash trading risk HIGH — tiny avg trade size with very high volume/liquidity ratio suggests artificial volume, market data unreliable`,
      severity: 'warning',
    });
  }

  // Round 382 (AutoResearch): Wash trading + sell pressure compound breaker
  // When both wash trading is elevated AND sell pressure exists, data is both unreliable AND bearish
  // This is a compounded risk: fake volume masking a distribution phase
  if (washRisk === 'elevated' && dex?.pressure_signal === 'sell_pressure') {
    const ratio = safeNum(dex?.buy_sell_ratio ?? 1);
    breakers.push({
      cap: 6.0,
      reason: `Wash trading (elevated) + sell pressure (ratio ${ratio.toFixed(2)}) compound risk — volume data unreliable and sellers dominant`,
      severity: 'warning',
    });
  }

  // Round 381 (AutoResearch): Long-term ATH decay warning
  // Tokens that are >90% below ATH (set over 1 year ago) have historically poor recovery rates
  // unless accompanied by a new catalyst — prevents false BUY signals on dead cat bounces
  const daysSinceAthCB = rawData?.market?.days_since_ath;
  const athDistCB = safeNum(rawData?.market?.ath_distance_pct ?? 0);
  if (daysSinceAthCB != null && daysSinceAthCB > 365 && athDistCB < -90) {
    breakers.push({
      cap: 5.5,
      reason: `Token is ${Math.abs(athDistCB).toFixed(0)}% below ATH set ${Math.round(daysSinceAthCB / 365 * 10) / 10}yr ago — statistically poor recovery odds without new catalyst`,
      severity: 'warning',
    });
  }

  // Round 381 (AutoResearch): market_cap_to_volume_ratio extreme premium check
  // Tokens with MCap/Volume > 1000 have almost no organic trading — easy to manipulate prices
  const mcapVolRatio381 = rawData?.market?.market_cap_to_volume_ratio;
  const mcap381 = safeNum(rawData?.market?.market_cap ?? 0);
  if (mcapVolRatio381 != null && mcapVolRatio381 > 1000 && mcap381 > 1_000_000) {
    breakers.push({
      cap: 6.0,
      reason: `MCap/Volume ratio ${mcapVolRatio381.toFixed(0)}x — only ${((1 / mcapVolRatio381) * 100).toFixed(3)}% of market cap traded daily, price easily manipulated`,
      severity: 'warning',
    });
  }

  // Round 383 (AutoResearch): Honeypot absolute circuit breaker
  // A honeypot contract allows buy but blocks sell — this is fraud, not a risk.
  // No matter how good other metrics look, a honeypot must produce STRONG AVOID.
  if (rawData?.contract?.honeypot === true) {
    breakers.push({
      cap: 1.0,
      reason: 'HONEYPOT DETECTED — contract blocks selling. This is a scam. Do not buy under any circumstances.',
      severity: 'critical',
    });
  }

  // Round 383 (AutoResearch): High sell tax circuit breaker
  // A sell tax > 20% makes exit impossible without massive loss — effectively a soft honeypot.
  const sellTaxCB = safeNum(rawData?.contract?.sell_tax ?? 0);
  if (sellTaxCB > 20) {
    breakers.push({
      cap: 2.5,
      reason: `Sell tax ${sellTaxCB}% — holders lose 20%+ on every exit. Tokens with >20% sell tax are exit-restricted by design.`,
      severity: 'critical',
    });
  } else if (sellTaxCB > 10) {
    breakers.push({
      cap: 4.5,
      reason: `High sell tax ${sellTaxCB}% — significant exit cost creates holder trap dynamics. Cap at AVOID.`,
      severity: 'warning',
    });
  }

  // Round 383 (AutoResearch): Hyperinflationary supply + low market cap = economic spiral
  // Tokens with >200%/yr inflation and <$10M mcap typically see supply outrun demand → collapse
  const inflationCB = safeNum(rawData?.tokenomics?.inflation_rate ?? 0);
  const mcapForInflation = safeNum(rawData?.market?.market_cap ?? 0);
  if (inflationCB > 200 && mcapForInflation < 10_000_000) {
    breakers.push({
      cap: 4.0,
      reason: `Hyperinflationary supply (${inflationCB.toFixed(0)}%/yr) with small market cap ($${(mcapForInflation / 1e6).toFixed(1)}M) — emissions will overwhelm demand, structural price erosion inevitable.`,
      severity: 'critical',
    });
  } else if (inflationCB > 100) {
    breakers.push({
      cap: 5.5,
      reason: `Very high annual inflation (${inflationCB.toFixed(0)}%/yr) — supply expanding rapidly, sustained buy pressure required just to maintain price.`,
      severity: 'warning',
    });
  }

  // Round R10 (AutoResearch nightly): Airdrop dump circuit breaker
  // When airdrop_mentions is high AND volume spike AND negative price → strong distribution signal
  // Prevents BUY ratings during what is effectively a farming-exit event
  const airdropMentionsCB = safeNum(rawData?.social?.airdrop_mentions ?? 0);
  const volSpikeCB = rawData?.market?.volume_spike_flag;
  const price24hCB = safeNum(rawData?.market?.price_change_pct_24h ?? 0);
  if (airdropMentionsCB >= 5 && volSpikeCB === 'extreme_spike' && price24hCB < -15) {
    breakers.push({
      cap: 3.5,
      reason: `Airdrop dump pattern: ${airdropMentionsCB} airdrop mentions + extreme volume spike + ${price24hCB.toFixed(1)}% 24h drop. Classic post-airdrop distribution — active exit event in progress.`,
      severity: 'critical',
    });
  }

  // Round R10 (AutoResearch nightly): No-coverage large-cap concern
  // A project >$100M MCap with ZERO tier-1 news coverage is informationally opaque
  // Cannot recommend BUY without basic institutional coverage/information validation
  const topTierCB = Number(rawData?.social?.top_tier_source_count ?? -1);
  const mcapCB = safeNum(rawData?.market?.market_cap ?? 0);
  if (topTierCB === 0 && mcapCB > 100_000_000 && overallScore > 7.5) {
    breakers.push({
      cap: 7.5,
      reason: `$${(mcapCB / 1e6).toFixed(0)}M MCap project with zero tier-1 news coverage — information vacuum prevents high-conviction BUY rating.`,
      severity: 'warning',
    });
  }

  // Round 46 (AutoResearch): Silent crash circuit breaker
  // A token that drops >70% in 7d with zero social mentions is in a silent collapse —
  // either an exploit, team exit, or exchange delisting. No coverage = no warning for holders.
  // This is more dangerous than a documented crash which at least gets media attention.
  const change7dCB46 = safeNum(market.price_change_pct_7d ?? null);
  const socialMentionsCB46 = safeNum(rawData?.social?.filtered_mentions ?? rawData?.social?.mentions ?? null);
  const socialRanCB46 = rawData?.social?.sentiment_score != null || Array.isArray(rawData?.social?.key_narratives);
  if (change7dCB46 != null && change7dCB46 < -70 && socialRanCB46 && socialMentionsCB46 === 0) {
    breakers.push({
      cap: 3.5,
      reason: `Silent crash: ${change7dCB46.toFixed(1)}% 7d price drop with zero social coverage — unannounced collapse risk (exploit, delisting, or team exit)`,
      severity: 'critical',
    });
  }

  // Round 35 (AutoResearch): Zombie protocol circuit breaker
  // A project with >4 years since genesis, zero dev activity, and <$100K TVL is effectively dead.
  // Prevents false BUY signals from old, abandoned protocols with residual market cap.
  const genesisDateCB35 = market.genesis_date;
  const github35 = rawData?.github ?? {};
  const tvlCB35 = safeNum(onchain.tvl ?? 0);
  const commits90dCB35 = safeNum(github35.commits_90d ?? -1); // -1 = data not present
  if (genesisDateCB35) {
    const gd35 = new Date(genesisDateCB35);
    const ageMs35 = Date.now() - gd35.getTime();
    if (Number.isFinite(ageMs35) && ageMs35 > 0) {
      const ageYears35 = ageMs35 / (1000 * 60 * 60 * 24 * 365.25);
      const hasNoDevActivity = commits90dCB35 === 0 || github35.commit_trend === 'inactive';
      const hasDeadTvl = tvlCB35 >= 0 && tvlCB35 < 100_000; // either zero or very low
      if (ageYears35 >= 4 && hasNoDevActivity && hasDeadTvl) {
        breakers.push({
          cap: 4.0,
          reason: `Zombie protocol: ${ageYears35.toFixed(1)} years old with zero dev activity and <$100K TVL — project appears abandoned.`,
          severity: 'critical',
        });
      }
    }
  }

  // Applica il cap più restrittivo
  if (breakers.length === 0) {
    return { score: overallScore, breakers: [], capped: false };
  }

  const lowestCap = Math.min(...breakers.map((b) => b.cap));
  const cappedScore = Math.min(overallScore, lowestCap);

  return {
    score: parseFloat(cappedScore.toFixed(1)),
    breakers,
    capped: cappedScore < overallScore,
    original_score: parseFloat(overallScore.toFixed(1)),
    applied_cap: lowestCap,
  };
}
