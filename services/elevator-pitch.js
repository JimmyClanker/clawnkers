import { safeNum } from '../utils/math.js';
/**
 * elevator-pitch.js — Round 29
 * Generates a template-based 1-paragraph elevator pitch for a project.
 */


function fmtNum(value) {
  const n = safeNum(value, 0);
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
  const rawDesc = github.description || analysis?.moat || null;
  // Normalize: strip trailing dot, lowercase first char, limit to 120 chars
  const normalizeDesc = (s) => {
    if (!s) return null;
    const cleaned = s.replace(/\.$/, '').slice(0, 120);
    return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  };
  const description = normalizeDesc(rawDesc) ||
    (onchain.category ? `a ${onchain.category} protocol` : null) ||
    'a crypto protocol';
  const sentence1 = `${projectName} is ${description}.`;

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
  const overallScore = safeNum(scores?.overall?.score, 0);
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

  // Round 22 (AutoResearch batch): Add trend reversal context if strong signal
  const trendReversal = rawData?.trend_reversal;
  let sentence5 = null;
  if (trendReversal && trendReversal.pattern !== 'none' && trendReversal.confidence !== 'low') {
    const patternLabels = {
      bullish_reversal: '📈 A potential bullish reversal is forming.',
      bearish_reversal: '📉 Warning: bearish reversal pattern detected.',
      accumulation: '🔍 Accumulation signals suggest smart money building positions.',
      distribution: '⚠️ Distribution pattern suggests potential selling pressure ahead.',
    };
    sentence5 = patternLabels[trendReversal.pattern] ?? null;
  }

  // Round 59 (AutoResearch): one_line_risk — top risk in one sentence from red flags
  const redFlags = Array.isArray(rawData?.red_flags) ? rawData.red_flags : [];
  const criticalFlag = redFlags.find((f) => f.severity === 'critical');
  const worstFlag = criticalFlag ?? redFlags.find((f) => f.severity === 'warning') ?? null;
  let oneLineRisk = null;
  if (worstFlag) {
    // Truncate to max 120 chars
    const riskText = worstFlag.detail ?? worstFlag.flag ?? '';
    oneLineRisk = riskText.length > 120 ? riskText.slice(0, 117) + '…' : riskText;
  }

  const sentences = [sentence1, sentence2, sentence3, sentence4];
  if (sentence5) sentences.push(sentence5);
  const pitch = sentences.join(' ');

  // Round 236 (AutoResearch): 52-week context tag for pitch display
  const vs52w = market.price_vs_52w;
  let rangeTag = null;
  if (vs52w?.tier === 'near_high') rangeTag = '📈 Near 52-week high';
  else if (vs52w?.tier === 'near_low') rangeTag = '⚠️ Near 52-week low';

  return { pitch, one_line_risk: oneLineRisk, range_tag: rangeTag };
}
