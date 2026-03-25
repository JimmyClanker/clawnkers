/**
 * elevator-pitch.js — Round 29
 * Generates a template-based 1-paragraph elevator pitch for a project.
 */

function safeN(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function fmtNum(value) {
  const n = safeN(value, 0);
  if (n === 0) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function momentumLabel(overallScore) {
  if (overallScore >= 7.5) return 'strong upward momentum';
  if (overallScore >= 5.5) return 'moderate momentum';
  if (overallScore >= 4) return 'mixed signals';
  return 'weak momentum';
}

function verdictLine(verdict) {
  const map = {
    'STRONG BUY': 'The overall setup is compelling, warranting a strong buy conviction.',
    'BUY': 'The risk/reward is favorable, supporting a buy position.',
    'HOLD': 'The setup warrants a hold — worth monitoring but no urgent entry.',
    'AVOID': 'Current data suggests avoiding an entry at this time.',
    'STRONG AVOID': 'Multiple red flags make this a strong avoid.',
  };
  return map[String(verdict).toUpperCase()] ?? 'The overall conviction is neutral.';
}

/**
 * Generate a 3-4 sentence elevator pitch.
 *
 * @param {string} projectName
 * @param {object} rawData   - raw collector output
 * @param {object} scores    - calculateScores() result
 * @param {object} analysis  - LLM analysis output
 * @returns {{ pitch: string }}
 */
export function generateElevatorPitch(projectName, rawData, scores, analysis) {
  const market = rawData?.market ?? {};
  const onchain = rawData?.onchain ?? {};
  const github = rawData?.github ?? {};

  // Sentence 1: What the project does
  const description =
    github.description ||
    analysis?.moat ||
    (onchain.category ? `a ${onchain.category} protocol` : null) ||
    'a crypto protocol';
  const sentence1 = `${projectName} is ${description.charAt(0).toLowerCase()}${description.slice(1)}.`;

  // Sentence 2: Key metrics
  const tvlFmt = fmtNum(onchain.tvl);
  const mcapFmt = fmtNum(market.market_cap);
  const volFmt = fmtNum(market.total_volume ?? market.volume_24h);
  const metricsArr = [
    tvlFmt ? `TVL of ${tvlFmt}` : null,
    mcapFmt ? `market cap of ${mcapFmt}` : null,
    volFmt ? `24h volume of ${volFmt}` : null,
  ].filter(Boolean);
  const sentence2 = metricsArr.length
    ? `It currently has a ${metricsArr.join(', ')}.`
    : 'Key on-chain metrics are not yet available.';

  // Sentence 3: Competitive position + momentum
  const overallScore = safeN(scores?.overall?.score, 0);
  const competitorSummary = rawData?.competitors?.comparison_summary;
  const momentum = momentumLabel(overallScore);
  let sentence3;
  if (competitorSummary) {
    sentence3 = `${competitorSummary} The project is currently showing ${momentum} (score: ${overallScore.toFixed(1)}/10).`;
  } else if (analysis?.competitor_comparison && analysis.competitor_comparison !== 'n/a') {
    // Truncate to first sentence
    const firstSentence = analysis.competitor_comparison.split(/[.!?]/)[0];
    sentence3 = `${firstSentence}. The project is showing ${momentum} with a score of ${overallScore.toFixed(1)}/10.`;
  } else {
    sentence3 = `The project is showing ${momentum} with an algorithmic score of ${overallScore.toFixed(1)}/10.`;
  }

  // Sentence 4: Verdict
  const verdict = analysis?.verdict ?? 'HOLD';
  const sentence4 = verdictLine(verdict);

  const pitch = [sentence1, sentence2, sentence3, sentence4].join(' ');

  return { pitch };
}
