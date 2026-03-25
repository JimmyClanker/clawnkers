/**
 * thesis-generator.js — Round 20
 * Template-based investment thesis generator (no LLM needed).
 */

const DIM_LABELS = {
  market_strength:  'market traction',
  onchain_health:   'onchain health',
  social_momentum:  'community momentum',
  development:      'developer activity',
  tokenomics_health: 'tokenomics',
  distribution:     'token distribution',
  risk:             'risk profile',
};

const SIGNAL_PHRASES = {
  volume_spike_no_price_move: 'unusual volume without price reaction (potential accumulation)',
  dev_acceleration:           'accelerating development velocity',
  multi_exchange_listing:     'broad exchange distribution',
  tvl_growth_spike:           'strong TVL inflow',
  strong_positive_sentiment:  'high community conviction',
  improving_sector_position:  'improving sector standing',
};

const FLAG_PHRASES = {
  young_project:       'limited track record',
  low_market_cap:      'extremely low market cap',
  no_github:           'unverifiable development activity',
  whale_concentration: 'high whale concentration',
  no_onchain_data:     'no onchain metrics',
  declining_tvl:       'declining protocol TVL',
  low_volume:          'very low trading volume',
  bearish_sentiment:   'overwhelmingly bearish community sentiment',
  no_license:          'unlicensed codebase',
  extreme_fdv_ratio:   'extreme token unlock overhang',
};

function sortedDims(scores) {
  return Object.entries(scores)
    .filter(([k, v]) => DIM_LABELS[k] && typeof v === 'object' && v.score != null)
    .sort(([, a], [, b]) => b.score - a.score);
}

/**
 * Generate an investment thesis for a project.
 *
 * @param {string} projectName
 * @param {object} rawData
 * @param {object} scores         - calculateScores() result
 * @param {Array}  redFlags       - detectRedFlags() result
 * @param {Array}  alphaSignals   - detectAlphaSignals() result
 * @returns {{ bull_case: string, bear_case: string, neutral_case: string }}
 */
export function generateThesis(projectName, rawData = {}, scores = {}, redFlags = [], alphaSignals = []) {
  const sorted = sortedDims(scores);
  const strongest = sorted.slice(0, 2).map(([k]) => DIM_LABELS[k]);
  const weakest   = sorted.slice(-2).map(([k]) => DIM_LABELS[k]).reverse();

  const overallScore  = scores.overall?.score ?? 5;
  const completeness  = scores.overall?.completeness ?? 50;

  // Round 12: price range context for thesis
  const priceRangePos = rawData?.market?.price_range_position;
  let priceRangeNote = '';
  if (priceRangePos != null) {
    if (priceRangePos >= 0.8) priceRangeNote = ' near its all-time high';
    else if (priceRangePos >= 0.5) priceRangeNote = ' in the upper half of its historical range';
    else if (priceRangePos <= 0.1) priceRangeNote = ' near its all-time low — extreme risk/reward zone';
    else if (priceRangePos <= 0.25) priceRangeNote = ' in the lower quartile of its historical range';
  }

  // Round 12: TVL stickiness context
  const tvlStickiness = rawData?.onchain?.tvl_stickiness;
  const stickinessNote = tvlStickiness === 'sticky'
    ? ' with sticky capital retention'
    : tvlStickiness === 'fleeing'
    ? ' but capital is actively fleeing the protocol'
    : '';

  // Top alpha signals
  const strongSignals  = alphaSignals.filter((s) => s.strength === 'strong').map((s) => SIGNAL_PHRASES[s.signal] ?? s.signal);
  const modSignals     = alphaSignals.filter((s) => s.strength === 'moderate').map((s) => SIGNAL_PHRASES[s.signal] ?? s.signal);
  const bullSignalText = [...strongSignals, ...modSignals].slice(0, 2).join(' and ');

  // Top red flags
  const critFlags = redFlags.filter((f) => f.severity === 'critical').map((f) => FLAG_PHRASES[f.flag] ?? f.flag);
  const warnFlags = redFlags.filter((f) => f.severity === 'warning').map((f) => FLAG_PHRASES[f.flag] ?? f.flag);
  const bearFlagText = [...critFlags, ...warnFlags].slice(0, 2).join(' and ');

  // ── Bull case ─────────────────────────────────────────────────────────────
  let bull_case;
  if (strongSignals.length > 0 && strongest.length > 0) {
    bull_case = `${projectName} presents a compelling opportunity driven by ${bullSignalText}, backed by strong ${strongest.join(' and ')} (score ${overallScore}/10)${priceRangeNote}${stickinessNote}.`;
  } else if (strongest.length > 0 && overallScore >= 6) {
    bull_case = `${projectName} shows strong ${strongest.join(' and ')} fundamentals${priceRangeNote}, positioning it for potential upside with an overall score of ${overallScore}/10${stickinessNote}.`;
  } else {
    bull_case = `${projectName} has pockets of strength in ${strongest[0] ?? 'some dimensions'} that could reward patient, risk-tolerant investors${priceRangeNote}.`;
  }

  // ── Bear case ─────────────────────────────────────────────────────────────
  let bear_case;
  if (critFlags.length > 0) {
    bear_case = `Critical concerns around ${bearFlagText} could severely impact ${projectName}'s value, compounded by weak ${weakest[0] ?? 'fundamentals'}.`;
  } else if (bearFlagText) {
    bear_case = `${projectName} faces notable risks including ${bearFlagText}, with underperformance in ${weakest.join(' and ')}.`;
  } else if (overallScore < 5) {
    bear_case = `With weak ${weakest.join(' and ')} and an overall score of ${overallScore}/10, ${projectName} lacks the fundamentals to justify significant allocation.`;
  } else {
    bear_case = `${projectName}'s weaker ${weakest.join(' and ')} metrics introduce uncertainty that could limit near-term upside.`;
  }

  // ── Neutral case ──────────────────────────────────────────────────────────
  const dataNote = completeness < 70 ? ` (note: data completeness only ${completeness}%)` : '';
  let neutral_case;
  if (overallScore >= 6 && redFlags.length > 0) {
    neutral_case = `${projectName} scores ${overallScore}/10 overall with genuine strengths in ${strongest[0] ?? 'some areas'}, but red flags in ${bearFlagText || 'other areas'} warrant careful position sizing${dataNote}.`;
  } else if (overallScore >= 5) {
    neutral_case = `${projectName} presents a mixed picture — solid ${strongest[0] ?? 'fundamentals'} offset by weaker ${weakest[0] ?? 'metrics'} — suggesting a small, monitored position${dataNote}.`;
  } else {
    neutral_case = `${projectName} scores ${overallScore}/10 and requires improvement across ${weakest.join(' and ')} before a meaningful position is warranted${dataNote}.`;
  }

  // Round 67: One-liner thesis for feeds/cards
  const verdict = overallScore >= 7.5 ? 'STRONG BUY' : overallScore >= 6 ? 'BUY' : overallScore >= 4.5 ? 'HOLD' : 'AVOID';
  const oneLiner = overallScore >= 6
    ? `${projectName} — ${verdict}: ${bullSignalText || strongest[0] || 'fundamentals'} justify entry${priceRangeNote}.`
    : `${projectName} — ${verdict}: ${bearFlagText || weakest[0] || 'weak fundamentals'} — avoid until conditions improve.`;

  return { bull_case, bear_case, neutral_case, one_liner: oneLiner };
}
