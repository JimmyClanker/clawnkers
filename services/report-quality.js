/**
 * report-quality.js — Round 27
 * Self-assesses completeness, data freshness, and LLM output quality.
 */

const EXPECTED_LLM_FIELDS = [
  'verdict',
  'analysis_text',
  'moat',
  'risks',
  'catalysts',
  'competitor_comparison',
  'x_sentiment_summary',
  'key_findings',
];

const CACHE_STALENESS_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function safeN(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

// Round 20: Compute a 0-100 data freshness score based on collector source types
function computeDataFreshness(collectors) {
  if (!collectors || Object.keys(collectors).length === 0) return null;
  const sourceWeights = { fresh: 100, cache: 70, 'stale-cache': 40, error: 0 };
  const entries = Object.values(collectors);
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, e) => sum + (sourceWeights[e.source] ?? 0), 0);
  return Math.round(total / entries.length);
}

/**
 * Score report quality.
 *
 * @param {object} rawData   - raw collector output
 * @param {object} scores    - calculateScores() result
 * @param {object} analysis  - LLM analysis output
 * @returns {{ quality_score: number, grade: 'A'|'B'|'C'|'D'|'F', issues: string[], data_freshness_score: number|null }}
 */
export function scoreReportQuality(rawData, scores, analysis) {
  const issues = [];
  let score = 100;

  // ── 1. Collector completeness ──────────────────────────────────
  const collectors = rawData?.metadata?.collectors ?? {};
  const allCollectors = Object.keys(collectors);
  const failedCollectors = allCollectors.filter(
    (name) => collectors[name]?.ok === false || collectors[name]?.error
  );

  if (allCollectors.length === 0) {
    issues.push('No collector metadata found — cannot assess data completeness.');
    score -= 20;
  } else {
    const failRate = failedCollectors.length / allCollectors.length;
    if (failRate > 0.5) {
      issues.push(`More than half of collectors failed (${failedCollectors.length}/${allCollectors.length}): ${failedCollectors.join(', ')}.`);
      score -= 25;
    } else if (failRate > 0.25) {
      issues.push(`${failedCollectors.length} collector(s) failed: ${failedCollectors.join(', ')}.`);
      score -= 10;
    }
  }

  // ── 2. Dimension confidence ────────────────────────────────────
  const DIMENSIONS = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health'];
  const lowConfDims = DIMENSIONS.filter((dim) => {
    const confidence = safeN(scores?.[dim]?.completeness ?? scores?.[dim]?.confidence, 100);
    return confidence < 50;
  });
  if (lowConfDims.length > 0) {
    issues.push(`Low confidence (<50%) in dimensions: ${lowConfDims.join(', ')}.`);
    score -= lowConfDims.length * 5;
  }

  // ── 3. Data freshness (cache staleness) ───────────────────────
  const cacheEntries = Object.values(collectors);
  const staleEntries = cacheEntries.filter((entry) => {
    if (!entry?.cached_at) return false;
    const ageMs = Date.now() - new Date(entry.cached_at).getTime();
    return Number.isFinite(ageMs) && ageMs > CACHE_STALENESS_THRESHOLD_MS;
  });
  if (staleEntries.length > 0) {
    issues.push(`${staleEntries.length} cached data source(s) are stale (>30 min old).`);
    score -= staleEntries.length * 3;
  }

  // ── 4. LLM output completeness ────────────────────────────────
  if (!analysis || typeof analysis !== 'object') {
    issues.push('LLM analysis is missing entirely.');
    score -= 30;
  } else {
    const missingFields = EXPECTED_LLM_FIELDS.filter((field) => {
      const val = analysis[field];
      if (val === null || val === undefined) return true;
      if (typeof val === 'string' && (val.trim() === '' || val === 'n/a')) return true;
      if (Array.isArray(val) && (val.length === 0 || (val.length === 1 && val[0] === 'n/a'))) return true;
      return false;
    });

    if (missingFields.length > 0) {
      issues.push(`LLM output missing or empty fields: ${missingFields.join(', ')}.`);
      score -= missingFields.length * 4;
    }

    // Analysis text length check
    const analysisText = String(analysis?.analysis_text ?? '');
    if (analysisText.length < 200) {
      issues.push(`analysis_text is too short (${analysisText.length} chars, expected >200) — likely fallback or truncated output.`);
      score -= 10;
    }

    // Risks array quality
    const risks = analysis?.risks ?? [];
    if (Array.isArray(risks) && risks.length < 3) {
      issues.push(`Only ${risks.length} risk(s) provided — analysis may be incomplete.`);
      score -= 5;
    }
  }

  // ── 5. Market data presence ───────────────────────────────────
  const market = rawData?.market ?? {};
  if (!market.current_price && !market.price) {
    issues.push('No price data found in market collector.');
    score -= 5;
  }
  if (!market.market_cap) {
    issues.push('No market cap data found.');
    score -= 5;
  }

  // ── 6. Round 14: Check for red flags and alpha signals presence ──
  const hasRedFlags = Array.isArray(rawData?.red_flags) && rawData.red_flags.length > 0;
  const hasAlphaSignals = Array.isArray(rawData?.alpha_signals) && rawData.alpha_signals.length > 0;
  if (!hasRedFlags && !hasAlphaSignals) {
    issues.push('No red flags or alpha signals detected — analysis may lack qualitative depth.');
    score -= 5;
  }

  // ── 7. Round 14: Trade setup completeness ─────────────────────
  const tradeSetup = rawData?.trade_setup ?? rawData?.tradeSetup ?? null;
  if (tradeSetup && tradeSetup.setup_quality === 'weak') {
    issues.push('Trade setup quality is "weak" — insufficient price data for actionable levels.');
    score -= 5;
  }

  // ── 8. Round 20: Data freshness score ───────────────────────────
  const freshness = computeDataFreshness(collectors);
  if (freshness !== null && freshness < 50) {
    issues.push(`Data freshness score is low (${freshness}/100) — most data served from stale cache.`);
    score -= Math.round((50 - freshness) / 10) * 2; // up to -10 points
  }

  // ── 9. Round 15 (AutoResearch batch): Social data quality check ──
  const socialData = rawData?.social ?? {};
  if (!socialData.error && socialData.filtered_mentions === 0 && !socialData.sentiment) {
    issues.push('Social data returned zero mentions — sentiment analysis unreliable.');
    score -= 8;
  } else if (socialData.bot_filtered_count > 0 && socialData.mentions > 0) {
    const botPct = (socialData.bot_filtered_count / socialData.mentions) * 100;
    if (botPct > 60) {
      issues.push(`${botPct.toFixed(0)}% of social mentions were bot-filtered — remaining signal quality is low.`);
      score -= 5;
    }
  }

  // ── 10. Round 15 (AutoResearch batch): LLM analysis depth check ──
  const analysisText = rawData?.llm_analysis?.analysis_text ?? rawData?.analysis_text ?? '';
  if (analysisText && analysisText.length < 200) {
    issues.push('LLM analysis text is very short (<200 chars) — may indicate fallback or low-quality output.');
    score -= 10;
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Grade
  let grade;
  if (score >= 90) grade = 'A';
  else if (score >= 75) grade = 'B';
  else if (score >= 60) grade = 'C';
  else if (score >= 45) grade = 'D';
  else grade = 'F';

  // Round 64: Verdict confidence assessment based on score spread and data quality
  const overallScore = safeN(scores?.overall?.score, 5);
  const overallConf = safeN(scores?.overall?.overall_confidence, 50);
  const scoreSpread = overallScore > 7 || overallScore < 4 ? 'polarized' : 'ambiguous';
  const verdictConfidence = overallConf >= 70 && score >= 70 ? 'high' : overallConf >= 50 && score >= 50 ? 'medium' : 'low';

  return {
    quality_score: score,
    grade,
    issues,
    data_freshness_score: freshness,
    verdict_confidence: verdictConfidence,
    score_spread: scoreSpread,
  };
}
