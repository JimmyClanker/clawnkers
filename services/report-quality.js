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

/**
 * Score report quality.
 *
 * @param {object} rawData   - raw collector output
 * @param {object} scores    - calculateScores() result
 * @param {object} analysis  - LLM analysis output
 * @returns {{ quality_score: number, grade: 'A'|'B'|'C'|'D'|'F', issues: string[] }}
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

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Grade
  let grade;
  if (score >= 90) grade = 'A';
  else if (score >= 75) grade = 'B';
  else if (score >= 60) grade = 'C';
  else if (score >= 45) grade = 'D';
  else grade = 'F';

  return {
    quality_score: score,
    grade,
    issues,
  };
}
