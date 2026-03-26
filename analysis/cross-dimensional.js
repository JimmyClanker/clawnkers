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

export function analyzeCrossDimensional(scores, rawData = {}) {
  const divergences = [...detectDivergences(scores), ...detect52wDivergence(scores, rawData), ...detectBuyPressureSocialDivergence(scores, rawData)];
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
