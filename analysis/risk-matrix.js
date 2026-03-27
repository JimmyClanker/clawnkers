/**
 * risk-matrix.js — Round 7: Structured Risk Matrix
 *
 * Replaces flat red flag list with categorized risk matrix.
 * Categories: Smart Contract, Tokenomics, Regulatory, Market, Operational, Concentration
 */

import { safeNumber } from '../utils/math.js';

// Map red flag keys to risk categories
const FLAG_CATEGORY_MAP = {
  // Smart Contract
  no_github: 'smart_contract',
  github_inactive: 'smart_contract',
  dev_quality_concern: 'smart_contract',
  exploit_mentions_social: 'smart_contract',
  no_license: 'smart_contract',

  // Tokenomics
  extreme_fdv_ratio: 'tokenomics',
  high_team_allocation: 'tokenomics',
  token_unlock_news: 'tokenomics',
  hyperinflationary: 'tokenomics',
  high_inflation: 'tokenomics',
  low_revenue_capture: 'tokenomics',
  zero_revenue_capture: 'tokenomics',

  // Regulatory
  regulatory_risk_mentions: 'regulatory',
  stablecoin_depeg: 'regulatory',

  // Market
  low_market_cap: 'market',
  low_volume: 'market',
  severe_price_decline: 'market',
  flash_crash: 'market',
  near_all_time_low: 'market',
  atl_proximity: 'market',
  dex_sell_pressure: 'market',
  dex_pump_pattern: 'market',
  dex_dump_pattern: 'market',
  very_low_dex_liquidity: 'market',
  no_dex_pairs: 'market',
  very_low_exchange_count: 'market',

  // Operational
  no_onchain_data: 'operational',
  declining_tvl: 'operational',
  zombie_protocol: 'operational',
  very_low_revenue_efficiency: 'operational',

  // Concentration
  whale_concentration: 'concentration',
  single_pool_liquidity_concentration: 'concentration',
  single_chain_tvl_concentration: 'concentration',

  // Round 381 (AutoResearch): new risk categories
  fee_revenue_divergence: 'tokenomics',
  wash_trading_risk: 'market',
  secondary_coverage_only: 'market',
  stale_development: 'smart_contract',
  extremely_low_volume: 'market',
  // Round 382 (AutoResearch): additional risk flag mappings
  mercenary_tvl_dominance: 'operational',
  social_price_divergence: 'market',
  revenue_collapse: 'tokenomics',
  negative_real_yield: 'tokenomics',
  old_ath_stagnation: 'market',
  ghost_community: 'market',
  ghost_contributors: 'smart_contract',
  low_range_fdv_trap: 'tokenomics',
  extreme_fdv_overhang: 'tokenomics',
  sell_pressure_dominance: 'market',
  suspicious_volume_spike: 'market',
  unsupported_price_pump: 'market',
  falling_social_velocity: 'market',
  zombie_token_no_dex: 'market',

  // Other/mixed
  young_project: 'operational',
  bearish_sentiment: 'market',
  zero_social_mentions: 'market',
  uneven_dimension_scores: 'operational',
};

const SEVERITY_MAP = { critical: 5, warning: 3, info: 1 };
const LIKELIHOOD_BASE = { critical: 4, warning: 3, info: 2 };

const CATEGORY_LABELS = {
  smart_contract: 'Smart Contract',
  tokenomics: 'Tokenomics',
  regulatory: 'Regulatory',
  market: 'Market',
  operational: 'Operational',
  concentration: 'Concentration',
};

const CATEGORY_WEIGHTS = {
  smart_contract: 1.2,
  tokenomics: 1.1,
  regulatory: 1.0,
  market: 1.0,
  operational: 0.9,
  concentration: 1.0,
};

/**
 * Build a structured risk matrix from red flags and raw data.
 *
 * @param {object} rawData
 * @param {object} scores
 * @param {Array} redFlags
 * @returns {object} risk matrix
 */
export function buildRiskMatrix(rawData = {}, scores = {}, redFlags = []) {
  const categories = {};

  // Initialize all categories
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    categories[key] = {
      label,
      flags: [],
      max_severity: 0,
      max_likelihood: 0,
      impact: 0,
    };
  }

  // Categorize red flags
  for (const flag of redFlags) {
    const category = FLAG_CATEGORY_MAP[flag.flag] || 'operational';
    const severity = SEVERITY_MAP[flag.severity] || 1;
    const likelihood = LIKELIHOOD_BASE[flag.severity] || 2;

    categories[category].flags.push({
      flag: flag.flag,
      severity: flag.severity,
      severity_score: severity,
      likelihood,
      detail: flag.detail,
    });

    categories[category].max_severity = Math.max(categories[category].max_severity, severity);
    categories[category].max_likelihood = Math.max(categories[category].max_likelihood, likelihood);
  }

  // Calculate impact per category: severity * likelihood * weight
  for (const [key, cat] of Object.entries(categories)) {
    const weight = CATEGORY_WEIGHTS[key] || 1.0;
    cat.impact = parseFloat((cat.max_severity * cat.max_likelihood * weight / 25).toFixed(2)); // normalized 0-1
    cat.flag_count = cat.flags.length;
  }

  // Overall risk score: weighted average of category impacts
  const activeCategories = Object.entries(categories).filter(([, c]) => c.flag_count > 0);
  let overallRisk = 0;
  let totalWeight = 0;

  if (activeCategories.length > 0) {
    for (const [key, cat] of activeCategories) {
      const weight = CATEGORY_WEIGHTS[key] || 1.0;
      overallRisk += cat.impact * weight;
      totalWeight += weight;
    }
    overallRisk = totalWeight > 0 ? overallRisk / totalWeight : 0;
  }

  // Scale to 1-10 (1 = low risk, 10 = extreme risk)
  const riskScore = Math.min(10, Math.max(1, Math.round(overallRisk * 10)));

  // Risk level label
  const riskLevel = riskScore >= 8 ? 'Extreme'
    : riskScore >= 6 ? 'High'
    : riskScore >= 4 ? 'Moderate'
    : riskScore >= 2 ? 'Low'
    : 'Minimal';

  // Risk-adjusted verdict modifier
  let verdictModifier = 'none';
  if (riskScore >= 8) verdictModifier = 'downgrade_2';   // e.g., BUY → AVOID
  else if (riskScore >= 6) verdictModifier = 'downgrade_1'; // e.g., BUY → HOLD
  else if (riskScore <= 2) verdictModifier = 'upgrade_1';   // e.g., HOLD → BUY

  // Heatmap data for frontend
  const heatmap = Object.entries(categories).map(([key, cat]) => ({
    category: key,
    label: cat.label,
    impact: cat.impact,
    flag_count: cat.flag_count,
    color: cat.impact >= 0.7 ? '#ef4444'
      : cat.impact >= 0.4 ? '#f97316'
      : cat.impact >= 0.2 ? '#fbbf24'
      : cat.flag_count > 0 ? '#86efac'
      : '#22c55e',
  }));

  return {
    categories,
    overall_risk_score: riskScore,
    risk_level: riskLevel,
    verdict_modifier: verdictModifier,
    total_flags: redFlags.length,
    active_categories: activeCategories.length,
    heatmap,
  };
}
