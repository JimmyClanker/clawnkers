/**
 * cross-dimensional.js — Round 3: Cross-Dimensional Analysis
 *
 * Detects divergences, convergences, and anomalies across scoring dimensions.
 * Each dimension is independent in scoring.js — this module finds patterns
 * that emerge from comparing them.
 */

function safeScore(dim) {
  if (!dim || typeof dim !== 'object') return null;
  return typeof dim.score === 'number' ? dim.score : null;
}

const DIMENSION_KEYS = [
  'market_strength', 'onchain_health', 'social_momentum',
  'development', 'tokenomics_health', 'distribution', 'risk',
];

const DIMENSION_LABELS = {
  market_strength: 'Market',
  onchain_health: 'Onchain',
  social_momentum: 'Social',
  development: 'Development',
  tokenomics_health: 'Tokenomics',
  distribution: 'Distribution',
  risk: 'Risk',
};

/**
 * Detect divergence patterns — dimensions telling conflicting stories.
 */
function detectDivergences(scores) {
  const divergences = [];
  const s = {};
  for (const k of DIMENSION_KEYS) {
    s[k] = safeScore(scores[k]);
  }

  // High social + low onchain = hype without substance
  if (s.social_momentum !== null && s.onchain_health !== null) {
    if (s.social_momentum >= 7 && s.onchain_health <= 4) {
      divergences.push({
        type: 'hype_without_substance',
        severity: 'warning',
        dimensions: ['social_momentum', 'onchain_health'],
        detail: `High social momentum (${s.social_momentum}/10) but weak onchain health (${s.onchain_health}/10) — hype may not be backed by real protocol usage.`,
      });
    }
  }

  // High dev + low market = undervalued builder
  if (s.development !== null && s.market_strength !== null) {
    if (s.development >= 7 && s.market_strength <= 4) {
      divergences.push({
        type: 'undervalued_builder',
        severity: 'info',
        dimensions: ['development', 'market_strength'],
        detail: `Strong development activity (${s.development}/10) but weak market performance (${s.market_strength}/10) — potentially undervalued builder, waiting for catalyst.`,
      });
    }
  }

  // High market + low dev = potential vapor
  if (s.market_strength !== null && s.development !== null) {
    if (s.market_strength >= 7 && s.development <= 3) {
      divergences.push({
        type: 'potential_vapor',
        severity: 'warning',
        dimensions: ['market_strength', 'development'],
        detail: `Strong market performance (${s.market_strength}/10) but minimal development (${s.development}/10) — price may not be supported by fundamentals.`,
      });
    }
  }

  // High social + low dev = narrative-driven without substance
  if (s.social_momentum !== null && s.development !== null) {
    if (s.social_momentum >= 7 && s.development <= 3) {
      divergences.push({
        type: 'narrative_driven',
        severity: 'warning',
        dimensions: ['social_momentum', 'development'],
        detail: `High social buzz (${s.social_momentum}/10) with negligible development (${s.development}/10) — pure narrative play, high risk.`,
      });
    }
  }

  // High onchain + low social = undiscovered gem or fading
  if (s.onchain_health !== null && s.social_momentum !== null) {
    if (s.onchain_health >= 7 && s.social_momentum <= 3) {
      divergences.push({
        type: 'undiscovered_protocol',
        severity: 'info',
        dimensions: ['onchain_health', 'social_momentum'],
        detail: `Strong onchain metrics (${s.onchain_health}/10) but low social visibility (${s.social_momentum}/10) — potentially undiscovered or losing mindshare.`,
      });
    }
  }

  // High risk score (safe) + low tokenomics = false safety
  if (s.risk !== null && s.tokenomics_health !== null) {
    if (s.risk >= 7 && s.tokenomics_health <= 3) {
      divergences.push({
        type: 'hidden_tokenomics_risk',
        severity: 'warning',
        dimensions: ['risk', 'tokenomics_health'],
        detail: `Risk profile looks safe (${s.risk}/10) but tokenomics are weak (${s.tokenomics_health}/10) — unlock/dilution risks may not be captured in price action yet.`,
      });
    }
  }

  // Round 71 (AutoResearch): High dev + very low social = underexposed builder
  // Strong builders with no social presence = potential undiscovered alpha
  if (s.development !== null && s.social_momentum !== null) {
    if (s.development >= 7 && s.social_momentum <= 3) {
      divergences.push({
        type: 'underexposed_builder',
        severity: 'info',
        dimensions: ['development', 'social_momentum'],
        detail: `Strong development activity (${s.development}/10) but very low social momentum (${s.social_momentum}/10) — team is building quietly without marketing, potential undiscovered alpha or pre-launch phase.`,
      });
    }
  }

  return divergences;
}

/**
 * Round 236 (AutoResearch): Detect 52-week range divergence patterns.
 * Price action vs fundamental scores often diverge — useful for finding opportunities.
 */
function detect52wDivergence(scores, rawData) {
  const divergences = [];
  const vs52w = rawData?.market?.price_vs_52w;
  if (!vs52w) return divergences;

  const overallScore = safeScore(scores?.overall) ?? (
    // Fallback: compute simple avg
    DIMENSION_KEYS.map(k => safeScore(scores[k])).filter(v => v != null).reduce((a, b, _, arr) => a + b / arr.length, 0)
  );
  const onchainScore = safeScore(scores?.onchain_health);
  const devScore = safeScore(scores?.development);

  // High fundamentals + near 52w low = "value trap or hidden gem?"
  if (vs52w.tier === 'near_low' && overallScore >= 6.5) {
    divergences.push({
      type: 'fundamental_price_divergence_bullish',
      severity: 'info',
      dimensions: ['market_strength', 'onchain_health'],
      detail: `Price near 52-week low (${vs52w.pct_from_52w_high.toFixed(1)}% from high) despite solid fundamentals (${overallScore.toFixed(1)}/10 overall) — potential deep value opportunity or fundamentals lagging price decline.`,
    });
  }

  // Weak fundamentals + near 52w high = "pump without substance"
  if (vs52w.tier === 'near_high' && overallScore <= 4.5) {
    divergences.push({
      type: 'fundamental_price_divergence_bearish',
      severity: 'warning',
      dimensions: ['market_strength', 'onchain_health'],
      detail: `Price near 52-week high despite weak fundamentals (${overallScore.toFixed(1)}/10) — price momentum may be unsustainable without fundamental support.`,
    });
  }

  // Strong dev but near 52w low = potential upcoming catalyst
  if (vs52w.tier === 'near_low' && devScore != null && devScore >= 7) {
    divergences.push({
      type: 'dev_strength_price_weakness',
      severity: 'info',
      dimensions: ['development', 'market_strength'],
      detail: `Active development (${devScore}/10) with price near 52-week low — shipping team may drive recovery once market recognizes progress.`,
    });
  }

  return divergences;
}

/**
 * Detect convergence patterns — all dimensions telling the same story.
 */
function detectConvergences(scores) {
  const convergences = [];
  const values = DIMENSION_KEYS.map(k => safeScore(scores[k])).filter(v => v !== null);

  if (values.length < 4) return convergences;

  const allHigh = values.every(v => v >= 7);
  const allMid = values.every(v => v >= 4 && v <= 6);
  const allLow = values.every(v => v <= 3);

  if (allHigh) {
    convergences.push({
      type: 'strong_conviction',
      detail: `All ${values.length} dimensions score 7+/10 — strong across-the-board fundamentals. High conviction.`,
      action: 'Consider strong position sizing.',
    });
  }

  if (allMid) {
    convergences.push({
      type: 'mediocre_across_board',
      detail: `All ${values.length} dimensions score 4-6/10 — mediocre across the board. No standout strength.`,
      action: 'Wait for improvement in at least one key dimension before entering.',
    });
  }

  if (allLow) {
    convergences.push({
      type: 'weak_across_board',
      detail: `All ${values.length} dimensions score ≤3/10 — uniformly weak. No redeeming quality visible.`,
      action: 'Strong avoid — no dimension justifies allocation.',
    });
  }

  // Partial convergence: at least 5 of 7 dimensions above 6
  const highCount = values.filter(v => v >= 6).length;
  if (highCount >= 5 && !allHigh) {
    convergences.push({
      type: 'mostly_strong',
      detail: `${highCount}/${values.length} dimensions score 6+/10 — broad strength with some gaps.`,
      action: 'Investigate weak dimensions before sizing up.',
    });
  }

  // Round 72 (AutoResearch): TVL growth + market momentum aligned convergence
  // When both onchain_health AND market_strength are both strong, the signal is highly reliable
  const onchainScore = safeScore(scores?.onchain_health);
  const marketScore = safeScore(scores?.market_strength);
  const devScore = safeScore(scores?.development);
  if (onchainScore !== null && marketScore !== null && onchainScore >= 6.5 && marketScore >= 6.5) {
    const thirdSignal = devScore != null && devScore >= 6 ? ` with strong development (${devScore}/10)` : '';
    convergences.push({
      type: 'tvl_growth_market_aligned',
      detail: `Strong onchain health (${onchainScore}/10) and market strength (${marketScore}/10) are aligned${thirdSignal} — fundamental + market convergence is a high-confidence signal.`,
      action: 'Alignment of on-chain TVL/fees with market price action = reliable BUY setup.',
    });
  }

  return convergences;
}

/**
 * Detect anomalies — one dimension drastically different from the rest.
 */
function detectAnomalies(scores) {
  const anomalies = [];
  const entries = DIMENSION_KEYS.map(k => ({ key: k, score: safeScore(scores[k]) }))
    .filter(e => e.score !== null);

  if (entries.length < 4) return anomalies;

  const avg = entries.reduce((s, e) => s + e.score, 0) / entries.length;

  for (const entry of entries) {
    const deviation = entry.score - avg;

    // Positive outlier: one dimension 9+ while avg < 5
    if (entry.score >= 9 && avg < 5) {
      anomalies.push({
        type: 'suspicious_outlier_high',
        dimension: entry.key,
        label: DIMENSION_LABELS[entry.key],
        score: entry.score,
        avg_others: parseFloat(avg.toFixed(1)),
        detail: `${DIMENSION_LABELS[entry.key]} scores ${entry.score}/10 while average is ${avg.toFixed(1)} — suspicious positive outlier. Possible manipulation or data artifact.`,
      });
    }

    // Negative outlier: one dimension < 3 while avg > 7
    if (entry.score <= 3 && avg > 7) {
      anomalies.push({
        type: 'critical_weakness',
        dimension: entry.key,
        label: DIMENSION_LABELS[entry.key],
        score: entry.score,
        avg_others: parseFloat(avg.toFixed(1)),
        detail: `${DIMENSION_LABELS[entry.key]} scores only ${entry.score}/10 while average is ${avg.toFixed(1)} — critical single-point weakness.`,
      });
    }

    // Large deviation (>4 points from mean)
    if (Math.abs(deviation) > 4) {
      const dir = deviation > 0 ? 'above' : 'below';
      anomalies.push({
        type: 'large_deviation',
        dimension: entry.key,
        label: DIMENSION_LABELS[entry.key],
        score: entry.score,
        deviation: parseFloat(deviation.toFixed(1)),
        detail: `${DIMENSION_LABELS[entry.key]} is ${Math.abs(deviation).toFixed(1)} points ${dir} the mean (${avg.toFixed(1)}).`,
      });
    }
  }

  return anomalies;
}

/**
 * Main entry point: analyze cross-dimensional patterns.
 *
 * @param {object} scores - calculateScores() result
 * @param {object} rawData - raw collector data (for additional context)
 * @returns {object} cross-dimensional analysis
 */
/**
 * Round 237 (AutoResearch nightly): Detect buy pressure vs social sentiment divergence.
 * When DEX shows strong buy pressure but social is bearish — smart money accumulation signal.
 * When DEX shows sell pressure but social is bullish — distribution camouflaged by narrative.
 */
function detectBuyPressureSocialDivergence(scores, rawData) {
  const divergences = [];
  const dex = rawData?.dex ?? {};
  const social = rawData?.social ?? {};

  const buySellRatio = Number(dex.buy_sell_ratio ?? 1);
  const socialSentScore = Number(social.sentiment_score ?? 0);

  // Smart money accumulation: buying on DEX while sentiment is negative
  if (buySellRatio >= 1.3 && socialSentScore < -0.2) {
    divergences.push({
      type: 'smart_money_accumulation',
      severity: 'info',
      dimensions: ['market_strength', 'social_momentum'],
      detail: `DEX buy/sell ratio ${buySellRatio.toFixed(2)} (buy pressure) while social sentiment is ${socialSentScore.toFixed(2)} (bearish) — possible smart money accumulation against negative narrative.`,
    });
  }

  // Distribution disguised by bullish narrative: selling while narrative is bullish
  if (buySellRatio <= 0.75 && socialSentScore > 0.3) {
    divergences.push({
      type: 'distribution_under_bullish_cover',
      severity: 'warning',
      dimensions: ['market_strength', 'social_momentum'],
      detail: `DEX buy/sell ratio ${buySellRatio.toFixed(2)} (sell pressure) while social sentiment is ${socialSentScore.toFixed(2)} (bullish) — possible distribution while narrative keeps retail bullish.`,
    });
  }

  return divergences;
}

/**
 * Round 381 (AutoResearch): Detect wash trading vs high social divergence.
 * When wash trading risk is high but social sentiment is also high, it may indicate
 * that a coordinated pump is using fake volume to attract retail FOMO.
 */
function detectWashTradingSocialDivergence(scores, rawData = {}) {
  const divergences = [];
  const washRisk = rawData?.dex?.wash_trading_risk;
  const socialScore = safeScore(scores?.social_momentum);
  if (washRisk === 'high' && socialScore !== null && socialScore >= 6) {
    divergences.push({
      type: 'wash_trade_pump_cover',
      severity: 'warning',
      dimensions: ['market_strength', 'social_momentum'],
      detail: `High wash trading risk on DEX combined with strong social momentum (${socialScore}/10) — suspicious pattern: fake volume may be inflating social metrics. Independent verification recommended.`,
    });
  }
  return divergences;
}

/**
 * Round 382 (AutoResearch): Detect high dev + low social = hidden gem pattern.
 * When development is strong but social is weak, the project may be undermarketed.
 * This is often a good asymmetric opportunity if fundamentals confirm.
 */
function detectHiddenGemPattern(scores, rawData = {}) {
  const divergences = [];
  const devScore = safeScore(scores?.development);
  const socialScore = safeScore(scores?.social_momentum);
  const onchainScore = safeScore(scores?.onchain_health);
  if (devScore !== null && socialScore !== null && devScore >= 7 && socialScore <= 4) {
    const hasOnchainSupport = onchainScore !== null && onchainScore >= 5;
    divergences.push({
      type: 'hidden_gem_pattern',
      severity: 'info',
      dimensions: ['development', 'social_momentum'],
      detail: `High dev activity (${devScore}/10) with low social (${socialScore}/10) — undermarketed project${hasOnchainSupport ? ' with onchain support' : ''}. May represent early entry opportunity before narrative discovery.`,
    });
  }
  return divergences;
}

/**
 * Round 382 (AutoResearch): Detect organic volume vs social confirmation.
 * Clean organic volume (no wash trading) + strong social = high conviction demand signal.
 */
function detectOrganicVolumeSocialConfirmation(scores, rawData = {}) {
  const divergences = [];
  const washRisk = rawData?.dex?.wash_trading_risk;
  const vol = Number(rawData?.market?.total_volume ?? 0);
  const mcap = Number(rawData?.market?.market_cap ?? 0);
  const socialScore = safeScore(scores?.social_momentum);
  if (!washRisk || washRisk === 'low') {
    const velPct = mcap > 0 ? (vol / mcap) * 100 : 0;
    if (velPct >= 15 && socialScore !== null && socialScore >= 6) {
      divergences.push({
        type: 'organic_volume_social_confirmation',
        severity: 'info',
        dimensions: ['market_strength', 'social_momentum'],
        detail: `${velPct.toFixed(1)}% volume velocity (organic, no wash trading) + strong social (${socialScore}/10) — convergent demand signal. Both price action and narrative aligned.`,
      });
    }
  }
  return divergences;
}

/**
 * Round 383 (AutoResearch): Detect high-inflation + high-social divergence.
 * When a protocol has very high inflation (>50%/yr) but strong social momentum,
 * the bullish narrative is likely masking a structural supply problem.
 * Retail is pumping while tokenomics will eventually dilute them.
 */
function detectInflationSocialDivergence(scores, rawData = {}) {
  const divergences = [];
  const tokenomics = rawData?.tokenomics ?? {};
  const inflation = Number(tokenomics.inflation_rate ?? NaN);
  const socialScore = safeScore(scores?.social_momentum);
  if (!Number.isFinite(inflation) || socialScore === null) return divergences;
  if (inflation > 50 && socialScore >= 6.5) {
    divergences.push({
      type: 'inflation_social_divergence',
      severity: 'warning',
      dimensions: ['social_momentum', 'tokenomics_health'],
      detail: `Strong social momentum (${socialScore}/10) combined with very high annual inflation (${inflation.toFixed(0)}%/yr) — bullish narrative may be masking structural supply dilution that will erode holder value over time.`,
    });
  }
  return divergences;
}

/**
 * Round 383 (AutoResearch): Detect revenue collapse despite stable market.
 * Protocol losing revenue/fees while price holds up = delayed reckoning scenario.
 * Eventually market will reprice when fundamentals deteriorate become visible.
 */
function detectRevenuePriceDecoupling(scores, rawData = {}) {
  const divergences = [];
  const onchain = rawData?.onchain ?? {};
  const marketScore = safeScore(scores?.market_strength);
  const onchainScore = safeScore(scores?.onchain_health);
  const feeTrend = onchain.fee_revenue_acceleration;
  if (marketScore === null || onchainScore === null) return divergences;
  // Market strong but fees declining = delayed fundamentals pricing
  if (marketScore >= 7 && onchainScore <= 4 && feeTrend === 'declining') {
    divergences.push({
      type: 'revenue_price_decoupling',
      severity: 'warning',
      dimensions: ['market_strength', 'onchain_health'],
      detail: `Strong market score (${marketScore}/10) but weak and declining onchain health (${onchainScore}/10, fees declining) — price strength may be a lagging indicator. Fundamentals deteriorating while price holds up.`,
    });
  }
  return divergences;
}

/**
 * Round 384 (AutoResearch batch): Detect strong development + declining social — builders building
 * while market loses attention. This is the setup before a "catalyst re-discovery" event.
 */
function detectBuilderInSilence(scores, rawData = {}) {
  const result = [];
  const devScore = safeScore(scores?.development);
  const socialScore = safeScore(scores?.social_momentum);
  const github = rawData?.github ?? {};
  if (devScore === null || socialScore === null) return result;
  if (devScore >= 7 && socialScore <= 3.5) {
    const commits90d = Number(github.commits_90d ?? 0);
    result.push({
      type: 'builder_in_silence',
      severity: 'info',
      dimensions: ['development', 'social_momentum'],
      detail: `Strong dev activity (${devScore}/10, ${commits90d} commits/90d) despite low social noise (${socialScore}/10) — team building quietly while market ignores. Classic pre-catalyst setup.`,
    });
  }
  return result;
}

/**
 * Round 384: Detect high risk score but high market score — market overpricing risk.
 * When risk score is below 4 and market is above 7, market participants are ignoring risks.
 */
function detectMarketIgnoringRisk(scores, rawData = {}) {
  const result = [];
  const marketScore = safeScore(scores?.market_strength);
  const riskScore = safeScore(scores?.risk);
  if (marketScore === null || riskScore === null) return result;
  if (marketScore >= 7 && riskScore <= 3.5) {
    result.push({
      type: 'market_ignoring_risk',
      severity: 'warning',
      dimensions: ['market_strength', 'risk'],
      detail: `High market strength (${marketScore}/10) but very poor risk profile (${riskScore}/10) — market appears to be pricing in optimism while ignoring structural risks (concentration, volatility, liquidity). Asymmetric downside risk.`,
    });
  }
  return result;
}

export function analyzeCrossDimensional(scores, rawData = {}) {
  const divergences = [
    ...detectDivergences(scores),
    ...detect52wDivergence(scores, rawData),
    ...detectBuyPressureSocialDivergence(scores, rawData),
    ...detectWashTradingSocialDivergence(scores, rawData),  // Round 381
    ...detectHiddenGemPattern(scores, rawData),             // Round 382
    ...detectOrganicVolumeSocialConfirmation(scores, rawData), // Round 382
    ...detectInflationSocialDivergence(scores, rawData),    // Round 383
    ...detectRevenuePriceDecoupling(scores, rawData),       // Round 383
    ...detectBuilderInSilence(scores, rawData),             // Round 384
    ...detectMarketIgnoringRisk(scores, rawData),           // Round 384
  ];
  const convergences = detectConvergences(scores);
  const anomalies = detectAnomalies(scores);

  const totalFindings = divergences.length + convergences.length + anomalies.length;

  // Generate a summary narrative for LLM injection
  const summaryParts = [];
  if (convergences.length > 0) {
    summaryParts.push(convergences.map(c => c.detail).join(' '));
  }
  if (divergences.length > 0) {
    summaryParts.push(`Key divergences: ${divergences.map(d => d.detail).join(' ')}`);
  }
  if (anomalies.length > 0) {
    summaryParts.push(`Anomalies: ${anomalies.map(a => a.detail).join(' ')}`);
  }

  return {
    divergences,
    convergences,
    anomalies,
    total_findings: totalFindings,
    summary: summaryParts.join(' ') || 'No significant cross-dimensional patterns detected.',
  };
}
