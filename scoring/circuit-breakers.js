/**
 * Circuit breakers: condizioni che impongono un tetto allo score.
 * Vengono applicati DOPO il calcolo del weighted score.
 *
 * Filosofia: certi rischi sono binari. Non li "pesi" — li applichi
 * come vincoli hard.
 */
function safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function applyCircuitBreakers(overallScore, rawData, scores, redFlags) {
  const breakers = [];
  const market = rawData?.market ?? {};
  const holders = rawData?.holders ?? {};
  const dex = rawData?.dex ?? {};
  const contract = rawData?.contract ?? {};
  const onchain = rawData?.onchain ?? {};

  // ── CRITICAL BREAKERS: Cap a 4.0 (max AVOID) ─────────────────────────────

  // Whale concentration > 70%
  const whaleConc = holders.top10_concentration ?? holders.concentration_pct ?? holders.top10_concentration_pct ?? 0;
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
  const fdv = market.fully_diluted_valuation ?? market.fdv ?? 0;
  const mcap = market.market_cap ?? 0;
  if (fdv > 0 && mcap > 0 && fdv / mcap > 10) {
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

  // Data completeness < 40%
  const completeness = scores?.overall?.completeness ?? 100;
  if (completeness < 40) {
    breakers.push({
      cap: 6.0,
      reason: `Only ${completeness}% data coverage — insufficient for conviction`,
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
  const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'FRAX', 'LUSD', 'USDD', 'FDUSD', 'PYUSD', 'USDE', 'USDX', 'SUSD', 'EURS', 'TUSD', 'GUSD', 'USDP']);
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
  const socialMentions = safeN(rawData?.social?.mentions ?? rawData?.social?.filtered_mentions ?? 0);
  const tvlForGhost = safeN(onchain.tvl ?? 0);
  if (tvlForGhost > 100_000_000 && socialMentions === 0 && !rawData?.social?.error) {
    breakers.push({
      cap: 6.5,
      reason: `DeFi protocol with $${(tvlForGhost / 1e9).toFixed(2)}B TVL but zero social mentions — potential ghost protocol or data anomaly`,
      severity: 'warning',
    });
  }

  // Round 132 (AutoResearch): Persistent revenue decline for DeFi protocols
  // If revenue_7d and revenue_30d show consistent negative trend, the protocol is losing value capture
  const rev7d = safeN(onchain.revenue_7d ?? 0);
  const rev30d = safeN(onchain.revenue_30d ?? 0);
  const rev7dPrev = safeN(onchain.revenue_7d_prev ?? 0);
  const fees7dR132 = safeN(onchain.fees_7d ?? 0); // renamed to avoid duplicate with later declaration
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
  const mcapForVelocity = safeN(market.market_cap ?? 0);
  const volForVelocity = safeN(market.total_volume ?? 0);
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
