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
  volume_spike_no_price_move:    'unusual volume without price reaction (potential accumulation)',
  dev_acceleration:              'accelerating development velocity',
  multi_exchange_listing:        'broad exchange distribution',
  tvl_growth_spike:              'strong TVL inflow',
  strong_positive_sentiment:     'high community conviction',
  improving_sector_position:     'improving sector standing',
  recent_release:                'recent code release',
  coingecko_trending:            'CoinGecko trending status',
  strong_dex_presence:           'strong DEX presence',
  dex_buy_pressure:              'DEX buy pressure',
  institutional_interest:        'institutional interest signals',
  partnership_news:              'partnership announcements',
  high_cex_volume_share:         'high CEX volume share',
  strong_dex_liquidity_health:   'robust DEX liquidity',
  flash_pump:                    'flash pump detected',
  ath_breakout:                  'ATH breakout',
  near_ath_breakout:             'near ATH breakout attempt',
  recovery_from_low:             'recovery from recent low',
  atl_recovery_momentum:         'recovery momentum from all-time low',
  volume_surge:                  'volume surge',
  price_volume_divergence:       'price-volume divergence',
  price_volume_divergence_bullish: 'bullish price-volume divergence',
  multi_chain_presence:          'multi-chain presence',
  multichain_expansion:          'multi-chain expansion activity',
  ecosystem_growth:              'ecosystem growth',
  active_governance:             'active governance participation',
  revenue_generating:            'fee/revenue generation confirmed',
  strong_revenue_capture:        'strong protocol revenue capture',
  fee_switch_candidate:          'fee switch activation could create value accrual',
  smart_accumulation_pattern:    'smart money accumulation pattern detected',
  long_term_reset_breakout:      'long-term base breakout with strong 1-year performance',
  social_velocity_spike:         'rapid social mention velocity spike',
  volume_spike_buy_pressure:     'volume spike with dominant buy pressure',
  revenue_momentum:              'improving revenue trend with strong capital efficiency',
  veteran_protocol_strong_fees:  'battle-tested protocol with proven fee generation',
  high_fee_efficiency:           'high fee-to-TVL efficiency',
  low_price_to_tvl:              'undervalued relative to TVL',
  strong_treasury:               'strong protocol treasury',
  strong_long_term_trend:        'sustained long-term uptrend',
  // Round 233 (AutoResearch nightly): P/TVL valuation signal
  low_price_to_tvl:              'trading below on-chain value (P/TVL < 1x)',
  payments_network_growth:       'payment network adoption growth',
  accelerating_news_coverage:    'accelerating news coverage',
  // Round 236 (AutoResearch): 52-week range signals
  '52w_high_breakout':           'near 52-week high price discovery',
  exchange_listing_catalyst:     'potential major exchange listing',
  low_range_fdv_trap:            'structural distribution trap (52w low + FDV overhang)',
};

const FLAG_PHRASES = {
  young_project:       'limited track record',
  low_market_cap:      'extremely low market cap',
  no_github:           'unverifiable development activity',
  github_inactive:     'no recent development activity',
  dev_quality_concern: 'development quality concerns',
  whale_concentration: 'high whale concentration',
  high_concentration:  'high holder concentration',
  no_onchain_data:     'no onchain metrics',
  declining_tvl:       'declining protocol TVL',
  low_volume:          'very low trading volume',
  bearish_sentiment:   'overwhelmingly bearish community sentiment',
  zero_social_mentions: 'no recent social mentions',
  no_license:          'unlicensed codebase',
  extreme_fdv_ratio:   'extreme token unlock overhang',
  exploit_mentions_social: 'exploit mentions in social media',
  low_revenue_capture: 'low revenue capture',
  zero_revenue_capture: 'zero revenue capture',
  very_low_revenue_efficiency: 'very low revenue efficiency',
  token_unlock_news:   'upcoming token unlock events',
  regulatory_risk_mentions: 'regulatory risk mentions',
  near_all_time_low:   'near all-time low price',
  atl_proximity:       'ATL proximity risk',
  old_ath_stagnation:  'ATH over 1 year old with structural underperformance',
  ghost_community:     'inflated followers with no real community engagement',
  flash_crash:         'flash crash detected',
  unverified_contract: 'unverified contract',
  dex_sell_pressure:   'DEX sell pressure dominance',
  dex_dump_pattern:    'DEX dump pattern detected',
  dex_pump_pattern:    'DEX pump-and-dump pattern',
  no_dex_pairs:        'no DEX liquidity pairs',
  very_low_dex_liquidity: 'critically low DEX liquidity',
  very_low_exchange_count: 'very few exchange listings',
  high_inflation:      'high token inflation rate',
  hyperinflationary:   'hyperinflationary token supply',
  high_team_allocation: 'excessive team token allocation',
  severe_price_decline: 'severe recent price decline',
  single_chain_tvl_concentration: 'TVL concentrated on single chain',
  single_pool_liquidity_concentration: 'liquidity concentrated in single pool',
  stablecoin_depeg:    'stablecoin depeg risk',
  uneven_dimension_scores: 'uneven score profile',
  zombie_protocol:     'zombie protocol (no users or activity)',
  zombie_token_no_dex: 'established token with no DEX liquidity',
  negative_real_yield: 'negative real yield — emissions exceed protocol fees',
  unsupported_price_pump: 'price pump without fundamental backing',
  suspicious_volume_spike: 'suspicious volume spike — possible wash trading',
};


function humanizePhraseKey(key, type) {
  const readable = String(key ?? '')
    .split('_')
    .filter(Boolean)
    .map((part, index) => {
      const upper = part.toUpperCase();
      if (['DEX', 'CEX', 'TVL', 'FDV', 'ATH', 'ATL'].includes(upper)) return upper;
      return index === 0
        ? part.charAt(0).toUpperCase() + part.slice(1)
        : part.toLowerCase();
    })
    .join(' ');

  console.warn(`[thesis-generator] Missing ${type} label for key "${key}". Using fallback label "${readable}".`);
  return readable;
}

function getPhraseLabel(map, key, type) {
  return map[key] ?? humanizePhraseKey(key, type);
}

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
  const strongSignals  = alphaSignals.filter((s) => s.strength === 'strong').map((s) => getPhraseLabel(SIGNAL_PHRASES, s.signal, 'signal'));
  const modSignals     = alphaSignals.filter((s) => s.strength === 'moderate').map((s) => getPhraseLabel(SIGNAL_PHRASES, s.signal, 'signal'));
  const bullSignalText = [...strongSignals, ...modSignals].slice(0, 2).join(' and ');

  // Top red flags
  const critFlags = redFlags.filter((f) => f.severity === 'critical').map((f) => getPhraseLabel(FLAG_PHRASES, f.flag, 'flag'));
  const warnFlags = redFlags.filter((f) => f.severity === 'warning').map((f) => getPhraseLabel(FLAG_PHRASES, f.flag, 'flag'));
  const bearFlagText = [...critFlags, ...warnFlags].slice(0, 2).join(' and ');

  // Round 23 (AutoResearch batch): trend reversal augmentation
  const trendReversal = rawData?.trend_reversal;
  const trendNote = trendReversal && trendReversal.pattern !== 'none' && trendReversal.confidence !== 'low'
    ? ` A ${trendReversal.pattern.replace(/_/g, ' ')} pattern (${trendReversal.confidence} confidence) adds technical support.`
    : '';

  // ── Bull case ─────────────────────────────────────────────────────────────
  let bull_case;
  if (strongSignals.length > 0 && strongest.length > 0) {
    bull_case = `${projectName} presents a compelling opportunity driven by ${bullSignalText}, backed by strong ${strongest.join(' and ')} (score ${overallScore}/10)${priceRangeNote}${stickinessNote}.${trendReversal?.pattern === 'bullish_reversal' || trendReversal?.pattern === 'accumulation' ? trendNote : ''}`;
  } else if (strongest.length > 0 && overallScore >= 6) {
    bull_case = `${projectName} shows strong ${strongest.join(' and ')} fundamentals${priceRangeNote}, positioning it for potential upside with an overall score of ${overallScore}/10${stickinessNote}.${trendReversal?.pattern === 'bullish_reversal' || trendReversal?.pattern === 'accumulation' ? trendNote : ''}`;
  } else {
    bull_case = `${projectName} has pockets of strength in ${strongest[0] ?? 'some dimensions'} that could reward patient, risk-tolerant investors${priceRangeNote}.${trendReversal?.pattern === 'accumulation' ? trendNote : ''}`;
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
  const verdict = overallScore >= 8.5
    ? 'STRONG BUY'
    : overallScore >= 7
      ? 'BUY'
      : overallScore >= 5.5
        ? 'HOLD'
        : overallScore >= 3.5
          ? 'AVOID'
          : 'STRONG AVOID';

  const oneLiner = verdict.includes('BUY')
    ? `${projectName} — ${verdict}: ${bullSignalText || strongest[0] || 'fundamentals'} support a constructive setup${priceRangeNote}.`
    : verdict === 'HOLD'
      ? `${projectName} — HOLD: ${bullSignalText || strongest[0] || 'mixed fundamentals'} worth monitoring, but ${bearFlagText || weakest[0] || 'current risks'} cap conviction.`
      : `${projectName} — ${verdict}: ${bearFlagText || weakest[0] || 'weak fundamentals'} keep the setup unattractive for now.`;

  // Round 11 (AutoResearch nightly): Add key metrics snapshot to thesis for quick context
  const m = rawData?.market ?? {};
  const o = rawData?.onchain ?? {};
  const price = m.current_price ?? m.price;
  const mcap = m.market_cap;
  const tvl = o.tvl;
  const c7d = m.price_change_pct_7d;
  const metricsSnap = [
    price != null ? `$${Number(price).toLocaleString('en-US', { maximumSignificantDigits: 5 })}` : null,
    mcap != null ? `MCap $${(Number(mcap) / 1e6).toFixed(1)}M` : null,
    tvl != null ? `TVL $${(Number(tvl) / 1e6).toFixed(1)}M` : null,
    c7d != null ? `7d ${Number(c7d) >= 0 ? '+' : ''}${Number(c7d).toFixed(1)}%` : null,
  ].filter(Boolean).join(' | ');

  // ── Round (Pipeline R8): Evidence, invalidation, time horizons, probabilities ──

  // Evidence for each case
  const bullEvidence = [];
  const bearEvidence = [];
  if (strongSignals.length > 0) bullEvidence.push(`Alpha signals: ${strongSignals.join(', ')}`);
  if (strongest.length > 0) bullEvidence.push(`Strongest dimensions: ${strongest.join(', ')} (scores 7+)`);
  if (safeN(o.tvl_change_7d) > 10) bullEvidence.push(`TVL growing ${safeN(o.tvl_change_7d).toFixed(1)}%/7d`);
  if (safeN(m.price_change_pct_7d) > 10) bullEvidence.push(`Price +${safeN(m.price_change_pct_7d).toFixed(1)}%/7d`);

  if (critFlags.length > 0) bearEvidence.push(`Critical red flags: ${critFlags.join(', ')}`);
  if (weakest.length > 0) bearEvidence.push(`Weakest dimensions: ${weakest.join(', ')}`);
  if (safeN(o.tvl_change_7d) < -10) bearEvidence.push(`TVL declining ${safeN(o.tvl_change_7d).toFixed(1)}%/7d`);
  if (safeN(m.price_change_pct_30d) < -30) bearEvidence.push(`Price ${safeN(m.price_change_pct_30d).toFixed(1)}%/30d`);

  // Invalidation triggers
  const bullInvalidation = [];
  const bearInvalidation = [];
  if (safeN(o.tvl) > 0) bullInvalidation.push('TVL drops >30% in 7 days');
  bullInvalidation.push('New critical red flags emerge (exploits, regulatory)');
  bullInvalidation.push('Overall score drops below 4.0');
  bearInvalidation.push('Major partnership or listing announcement');
  bearInvalidation.push('TVL doubles within 30 days');
  bearInvalidation.push('Overall score improves above 7.0');

  // Time horizons
  const timeHorizons = {
    '1_week': overallScore >= 7 ? 'Favorable setup — momentum supports entry' : overallScore >= 5 ? 'Neutral — wait for clearer signal' : 'Unfavorable — risk outweighs reward',
    '1_month': overallScore >= 7 ? 'Strong fundamentals suggest continued strength' : overallScore >= 5 ? 'Mixed signals — monitor for catalyst' : 'Weak fundamentals likely persist',
    '3_months': overallScore >= 7 ? 'Well-positioned for medium-term gains if thesis holds' : overallScore >= 5 ? 'Needs improvement in weak dimensions to justify position' : 'Avoid unless fundamentals materially improve',
  };

  // Probability estimates
  const bullProbability = Math.min(85, Math.max(10, Math.round(overallScore * 8 + (strongSignals.length * 5) - (critFlags.length * 10))));
  const bearProbability = Math.min(85, Math.max(10, 100 - bullProbability));
  const baseProbability = Math.min(60, Math.max(20, 100 - Math.abs(bullProbability - bearProbability)));

  // Round 43 (AutoResearch): conviction_score — normalized 0-100 combining score + evidence quality
  // High conviction = strong score + rich data + aligned evidence
  const dataConfidence = Math.max(0, 100 - ((10 - Math.min(Object.keys(rawData?.metadata?.collectors ?? {}).length || 5, 10)) * 5));
  const evidenceStrength = Math.min(bullEvidence.length + bearEvidence.length, 6) / 6; // 0-1
  const convictionScore = Math.round(
    (overallScore / 10) * 50 +                    // score component (0-50)
    evidenceStrength * 25 +                        // evidence richness (0-25)
    (dataConfidence / 100) * 25                    // data coverage (0-25)
  );

  return {
    bull_case,
    bear_case,
    neutral_case,
    one_liner: oneLiner,
    conviction_score: Math.min(100, Math.max(0, convictionScore)),
    metrics_snapshot: metricsSnap || null,
    // New fields (Round Pipeline R8)
    evidence: {
      bull: bullEvidence.length > 0 ? bullEvidence : ['Limited positive evidence available'],
      bear: bearEvidence.length > 0 ? bearEvidence : ['No critical concerns identified'],
    },
    invalidation: {
      bull: bullInvalidation,
      bear: bearInvalidation,
    },
    time_horizons: timeHorizons,
    probabilities: {
      bull: bullProbability,
      bear: bearProbability,
      base: baseProbability,
    },
  };
}

function safeN(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
