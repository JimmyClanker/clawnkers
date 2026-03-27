const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_TIMEOUT_MS = 60000;
const FAST_MODEL = 'grok-4-1-fast-non-reasoning';
const REASONING_MODEL = 'grok-4.20-multi-agent-0309';

// Opus via OpenClaw gateway (OAuth, zero cost) — falls back to direct Anthropic API if gateway unavailable
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789/v1/chat/completions';
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const OPUS_MODEL = 'anthropic/claude-opus-4-6'; // OpenClaw gateway model ID
const OPUS_MODEL_DIRECT = 'claude-opus-4-20250514'; // Direct Anthropic API model ID
const OPUS_TIMEOUT_MS = 90000;
const FALLBACK_VERDICTS = [
  { min: 8.5, verdict: 'STRONG BUY' },
  { min: 7, verdict: 'BUY' },
  { min: 5.5, verdict: 'HOLD' },
  { min: 3.5, verdict: 'AVOID' },
  { min: 0, verdict: 'STRONG AVOID' },
];

function withTimeout(timeoutMs, callback) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return callback(controller.signal).finally(() => clearTimeout(timeout));
}

function pickVerdict(score) {
  return FALLBACK_VERDICTS.find((item) => score >= item.min)?.verdict || 'HOLD';
}

function normalizeList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;

  const seen = new Set();
  const items = [];

  for (const item of value) {
    const normalized = String(item).trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
  }

  return items.length ? items : fallback;
}

function normalizeVerdict(value, fallbackScore = 0) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

  return FALLBACK_VERDICTS.some((item) => item.verdict === normalized)
    ? normalized
    : pickVerdict(fallbackScore);
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks = [];
  for (const item of payload?.output || []) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        chunks.push(content.text.trim());
      }
    }
  }

  return chunks.join('\n').trim();
}

function buildFactRegistry(rawData = {}) {
  const facts = [];
  const push = (key, value) => {
    if (value == null) return;
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    facts.push({ key, value });
  };

  push('market.current_price', rawData?.market?.current_price ?? rawData?.market?.price);
  push('market.market_cap', rawData?.market?.market_cap);
  push('market.total_volume', rawData?.market?.total_volume);
  push('market.ath_distance_pct', rawData?.market?.ath_distance_pct);
  push('onchain.tvl', rawData?.onchain?.tvl);
  push('onchain.tvl_change_7d', rawData?.onchain?.tvl_change_7d);
  push('onchain.tvl_change_30d', rawData?.onchain?.tvl_change_30d);
  push('onchain.fees_7d', rawData?.onchain?.fees_7d);
  push('onchain.revenue_7d', rawData?.onchain?.revenue_7d);
  push('social.filtered_mentions', rawData?.social?.filtered_mentions ?? rawData?.social?.mentions);
  push('social.sentiment_score', rawData?.social?.sentiment_score);
  push('github.commits_90d', rawData?.github?.commits_90d);
  push('github.contributors', rawData?.github?.contributors);
  push('tokenomics.pct_circulating', rawData?.tokenomics?.pct_circulating);
  push('dex.dex_liquidity_usd', rawData?.dex?.dex_liquidity_usd);
  push('dex.dex_price_usd', rawData?.dex?.dex_price_usd);
  push('dex.buy_sell_ratio', rawData?.dex?.buy_sell_ratio);
  push('dex.dex_pair_count', rawData?.dex?.dex_pair_count);
  push('market.price_change_24h', rawData?.market?.price_change_percentage_24h);
  push('market.price_change_7d', rawData?.market?.price_change_percentage_7d_in_currency);
  push('market.price_change_30d', rawData?.market?.price_change_percentage_30d_in_currency);
  push('market.fdv', rawData?.market?.fully_diluted_valuation ?? rawData?.market?.fdv);
  push('market.market_cap_rank', rawData?.market?.market_cap_rank);
  push('onchain.treasury_balance', rawData?.onchain?.treasury_balance);
  push('onchain.revenue_to_fees_ratio', rawData?.onchain?.revenue_to_fees_ratio);
  push('reddit.post_count', rawData?.reddit?.post_count);
  push('reddit.sentiment', rawData?.reddit?.sentiment);
  push('holders.top10_concentration_pct', rawData?.holders?.top10_concentration_pct);
  push('ecosystem.chain_count', rawData?.ecosystem?.chain_count);
  push('ecosystem.primary_chain', rawData?.ecosystem?.primary_chain);
  push('contract.verified', rawData?.contract?.verified);
  // Round R6: Global macro context — helps Grok assess altcoin vs BTC rotation risk
  push('macro.btc_dominance', rawData?.market?.btc_dominance);
  push('macro.total_market_cap_usd', rawData?.market?.total_market_cap_usd);
  push('macro.market_cap_change_pct_24h_global', rawData?.market?.market_cap_change_pct_24h_global);
  // Round R6: Volume anomaly context
  push('market.volume_7d_avg', rawData?.market?.volume_7d_avg);
  // Round 157 (AutoResearch): realized volatility and governance signals
  push('market.realized_vol_90d', rawData?.market?.realized_vol_90d);
  push('market.sparkline_7d_volatility', rawData?.market?.sparkline_7d_volatility);
  push('social.governance_mentions', rawData?.social?.governance_mentions);
  push('github.issue_resolution_rate', rawData?.github?.issue_resolution_rate);
  push('dex.volume_momentum', rawData?.dex?.volume_momentum);
  // Round 233 (AutoResearch nightly): momentum divergence and social credibility
  push('market.momentum_divergence', rawData?.market?.momentum_divergence);
  push('social.sentiment_credibility_score', rawData?.social?.sentiment_credibility_score);
  push('github.issue_health_score', rawData?.github?.issue_health_score);
  // Round 236 (AutoResearch): new signals for richer analysis context
  push('market.price_vs_52w_tier', rawData?.market?.price_vs_52w?.tier);
  push('market.pct_from_52w_high', rawData?.market?.price_vs_52w?.pct_from_52w_high);
  push('social.listing_mentions', rawData?.social?.listing_mentions);
  push('social.competitor_comparison_mentions', rawData?.social?.competitor_comparison_mentions);
  push('github.commits_per_contributor', rawData?.github?.commits_per_contributor);
  push('dex.median_liquidity_per_pair', rawData?.dex?.median_liquidity_per_pair);
  push('market.price_momentum_score', rawData?.market?.price_momentum_score);
  // Round 237 (AutoResearch nightly): new engagement and activity signals in fact registry
  push('market.holder_engagement_score', rawData?.market?.holder_engagement_score);
  push('reddit.reddit_activity_score', rawData?.reddit?.reddit_activity_score);
  push('social.competitor_content_ratio', rawData?.social?.competitor_content_ratio);
  push('dex.sell_wall_risk', rawData?.dex?.sell_wall_risk);
  push('github.bus_factor_score', rawData?.github?.bus_factor_score);
  const _ptvlForFacts = rawData?.ptvl_ratio ?? (
    rawData?.market?.market_cap != null && rawData?.onchain?.tvl != null && rawData.onchain.tvl > 0
      ? rawData.market.market_cap / rawData.onchain.tvl
      : null
  );
  push('onchain.ptvl_ratio', _ptvlForFacts != null ? parseFloat(_ptvlForFacts.toFixed(3)) : null);
  // Round 238 (AutoResearch): new signals in fact registry
  push('social.airdrop_mentions', rawData?.social?.airdrop_mentions);
  push('social.hack_exploit_mentions', rawData?.social?.hack_exploit_mentions);
  push('onchain.fees_7d_prev', rawData?.onchain?.fees_7d_prev);
  push('dex.dex_price_change_m5', rawData?.dex?.dex_price_change_m5);
  // Round 381 (AutoResearch): new signals in fact registry
  push('dex.wash_trading_risk', rawData?.dex?.wash_trading_risk);
  push('dex.median_trade_size_usd', rawData?.dex?.median_trade_size_usd);
  push('market.days_since_ath', rawData?.market?.days_since_ath);
  push('market.market_cap_to_volume_ratio', rawData?.market?.market_cap_to_volume_ratio);
  push('social.narrative_freshness_score', rawData?.social?.narrative_freshness_score);
  push('narrative.narrative_momentum_quality', rawData?.narrative_momentum?.narrative_momentum_quality);
  push('github.github_velocity_tier', rawData?.github?.github_velocity_tier);
  // Round 382 (AutoResearch): Additional fact registry entries for richer LLM context
  push('dex.wash_trading_risk', rawData?.dex?.wash_trading_risk);
  push('social.avg_article_quality_score', rawData?.social?.avg_article_quality_score);
  push('market.coin_age_days', rawData?.market?.coin_age_days);
  push('onchain.protocol_age_days', rawData?.onchain?.protocol_age_days);
  push('onchain.fees_per_tvl_7d', rawData?.onchain?.fees_per_tvl_7d);
  push('github.issue_resolution_rate', rawData?.github?.issue_resolution_rate);
  push('github.has_recent_release', rawData?.github?.has_recent_release);
  push('tokenomics.unlock_risk_label', rawData?.tokenomics?.unlock_risk_label);
  push('market.price_vs_52w_pct_from_high', rawData?.market?.price_vs_52w?.pct_from_52w_high);
  // Round 361 (AutoResearch PE): Additional derived signals for LLM orientation
  push('dex.net_buy_pressure_pct', rawData?.dex?.net_buy_pressure_pct);
  push('dex.volume_to_liquidity_ratio', rawData?.dex?.volume_to_liquidity_ratio);
  push('market.price_momentum_score', rawData?.market?.price_momentum_score);
  push('market.community_score', rawData?.market?.community_score);
  push('onchain.revenue_per_active_user', rawData?.onchain?.revenue_per_active_user);
  push('github.commit_frequency', rawData?.github?.commit_frequency);
  push('github.days_since_last_commit', rawData?.github?.days_since_last_commit);
  push('github.bus_factor_score', rawData?.github?.bus_factor_score);

  // Round 383 (AutoResearch): New fields from nightly batch improvements
  push('market.weekly_price_return', rawData?.market?.weekly_price_return);
  push('market.price_range_pct_7d', rawData?.market?.price_range_pct_7d);
  push('market.ath_recovery_required_pct', rawData?.market?.ath_recovery_potential?.required_pct);
  push('onchain.tvl_vs_ath_pct', rawData?.onchain?.tvl_vs_ath_pct);
  push('onchain.weekly_tvl_velocity_usd', rawData?.onchain?.weekly_tvl_velocity_usd);
  push('github.monthly_commit_velocity_change_pct', rawData?.github?.monthly_commit_velocity?.change_pct);
  push('reddit.avg_post_score', rawData?.reddit?.avg_post_score);
  push('reddit.sentiment_momentum', rawData?.reddit?.sentiment_momentum);
  push('signal.signal_strength_index', rawData?.signal_strength_index);
  push('tokenomics.inflation_rate', rawData?.tokenomics?.inflation_rate);
  push('contract.sell_tax', rawData?.contract?.sell_tax);
  push('contract.honeypot', rawData?.contract?.honeypot);
  push('contract.is_proxy', rawData?.contract?.is_proxy);
  push('contract.audited', rawData?.contract?.audited);

  return facts;
}

/**
 * Formats a number into human-readable form (e.g. $1.2M, $68.2B).
 */
function formatNumber(value) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/**
 * Builds a compact, human-readable summary of rawData (replaces JSON dump).
 * Exported so tests can import it.
 */
export function buildDataSummary(rawData = {}) {
  const lines = ['=== VERIFIED DATA (from collectors) ===\n'];
  const gaps = [];

  // Helper to add a data point
  const add = (label, value, formatter = (v) => v) => {
    if (value != null && value !== '') {
      return `- ${label}: ${formatter(value)}`;
    }
    return null;
  };

  // MARKET [CoinGecko]
  const market = rawData.market || {};
  if (!market.error && rawData.market) {
    const marketLines = [];
    marketLines.push(add('Price', market.current_price ?? market.price, formatNumber));
    marketLines.push(add('Market Cap', market.market_cap, (v) => `${formatNumber(v)} (rank #${market.market_cap_rank ?? 'n/a'})`));
    marketLines.push(add('24h Volume', market.total_volume, formatNumber));
    marketLines.push(add('24h Change', market.price_change_percentage_24h, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`));
    marketLines.push(add('7d Change', market.price_change_percentage_7d_in_currency, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`));
    marketLines.push(add('30d Change', market.price_change_percentage_30d_in_currency, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`));
    marketLines.push(add('ATH Distance', market.ath_distance_pct, (v) => `${v.toFixed(1)}%`));
    // Round 225 (AutoResearch): ATH recency and community score context
    if (market.ath_recency) {
      const recencyLabel = market.ath_recency === 'recent_ath' ? '🔥 ATH set within 30 days' : market.ath_recency === 'near_ath' ? 'ATH set within 90 days' : market.ath_recency === 'moderate_ath' ? 'ATH set within 1 year' : 'ATH over 1 year ago';
      marketLines.push(`- ATH recency: ${recencyLabel}`);
    }
    // Round 364: price_momentum_score 0-100 composite for LLM orientation
    if (market.price_momentum_score != null) {
      const pmsLabel = market.price_momentum_score >= 75 ? 'strong bullish momentum' : market.price_momentum_score >= 50 ? 'neutral-to-positive' : market.price_momentum_score >= 25 ? 'weak/declining' : 'strong bearish momentum';
      marketLines.push(`- Price momentum score: ${market.price_momentum_score}/100 (${pmsLabel}) — across 1h/24h/7d/30d timeframes`);
    }
    if (market.community_score != null) {
      const commLabel = market.community_score >= 70 ? 'large community' : market.community_score >= 40 ? 'moderate community' : 'small community';
      marketLines.push(`- Community score: ${market.community_score}/100 (${commLabel})`);
    }
    // Round 373: coin_age_days for maturity context
    if (market.coin_age_days != null && market.coin_age_days > 0) {
      const ageYears = (market.coin_age_days / 365).toFixed(1);
      const ageLabel = market.coin_age_days >= 1825 ? 'battle-tested (5+ years)' : market.coin_age_days >= 730 ? 'established (2+ years)' : market.coin_age_days >= 365 ? 'growing (1-2 years)' : market.coin_age_days >= 180 ? 'early (6-12 months)' : 'very new (<6 months)';
      marketLines.push(`- Token age: ${ageYears} years (${ageLabel})`);
    }
    if (market.volume_spike_flag) {
      marketLines.push(`- ⚠️ Volume spike: ${market.volume_spike_flag} (vs 7d avg)`);
    }
    // Round 376: realized volatility context — institutional risk metric
    if (market.realized_vol_90d != null) {
      const rvLabel = market.realized_vol_90d >= 150 ? 'extremely volatile' : market.realized_vol_90d >= 80 ? 'high volatility' : market.realized_vol_90d >= 40 ? 'moderate volatility' : 'low volatility (stable)';
      marketLines.push(`- Realized vol 90d: ${market.realized_vol_90d.toFixed(0)}% annualized (${rvLabel})`);
    }
    // Round 376: days_since_ath for timing context
    if (market.days_since_ath != null && market.days_since_ath > 0) {
      const dsa = market.days_since_ath;
      const dsaLabel = dsa <= 30 ? 'very recent ATH' : dsa <= 180 ? 'ATH within 6 months' : dsa <= 365 ? 'ATH within 1 year' : `ATH ${(dsa/365).toFixed(1)} years ago`;
      marketLines.push(`- Days since ATH: ${dsa} days (${dsaLabel})`);
    }
    // Round 383 (AutoResearch): ATH recovery potential — how much upside just to return to ATH
    if (market.ath_recovery_potential != null) {
      const arp = market.ath_recovery_potential;
      const tierDesc = { near_recovery: 'near ATH zone', medium_recovery: 'medium recovery play', long_recovery: 'significant recovery needed', very_distant_recovery: 'extremely far from ATH' };
      marketLines.push(`- ATH recovery: needs +${arp.required_pct.toFixed(0)}% to reach ATH (${tierDesc[arp.tier] || arp.tier})`);
    }
    // Round 383 (AutoResearch): weekly price return and 7d range
    if (market.weekly_price_return != null) {
      marketLines.push(`- Weekly return: ${market.weekly_price_return >= 0 ? '+' : ''}${market.weekly_price_return.toFixed(1)}% (chart-based 7d)`);
    }
    if (market.price_range_pct_7d != null) {
      const rangeLabel = market.price_range_pct_7d >= 30 ? 'highly volatile' : market.price_range_pct_7d >= 15 ? 'volatile' : market.price_range_pct_7d >= 5 ? 'moderate' : 'stable/consolidating';
      marketLines.push(`- 7d price range: ${market.price_range_pct_7d.toFixed(1)}% (${rangeLabel})`);
    }
    // Round 233 (AutoResearch nightly): momentum divergence — is short-term vs long-term momentum aligned?
    if (market.momentum_divergence != null) {
      const div = market.momentum_divergence;
      const divLabel = div > 500 ? 'strongly accelerating' : div > 0 ? 'accelerating' : div > -500 ? 'decelerating' : 'strongly decelerating';
      marketLines.push(`- Momentum divergence: ${div > 0 ? '+' : ''}${div.toFixed(0)}% (short vs long-term, ${divLabel})`);
    }
    marketLines.push(add('FDV', market.fully_diluted_valuation ?? market.fdv, formatNumber));
    // Round 378: market_cap_to_volume_ratio — coverage metric (how many days of volume = market cap)
    if (market.market_cap != null && market.total_volume != null && market.total_volume > 0) {
      const mcvRatio = market.market_cap / market.total_volume;
      const mcvLabel = mcvRatio <= 5 ? 'very liquid (5 days of volume = MCap)' : mcvRatio <= 20 ? 'liquid' : mcvRatio <= 100 ? 'moderate' : 'illiquid (100+ days to turnover MCap)';
      marketLines.push(`- MCap/Vol ratio: ${mcvRatio.toFixed(0)}x days (${mcvLabel})`);
    }

    const validMarket = marketLines.filter(Boolean);
    if (validMarket.length) {
      lines.push('MARKET [CoinGecko]:');
      lines.push(...validMarket);
      const missing = [];
      if (market.price_change_percentage_30d_in_currency == null) missing.push('30d change');
      if (missing.length) lines.push(`(missing: ${missing.join(', ')})`);
      lines.push('');
    } else {
      gaps.push('market (no data)');
    }
  } else {
    gaps.push('market (no data)');
  }

  // ONCHAIN [DeFiLlama]
  const onchain = rawData.onchain || {};
  if (!onchain.error && rawData.onchain) {
    const onchainLines = [];
    onchainLines.push(add('TVL', onchain.tvl, formatNumber));
    onchainLines.push(add('TVL 7d Change', onchain.tvl_change_7d, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`));
    onchainLines.push(add('TVL 30d Change', onchain.tvl_change_30d, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`));
    // Round 383 (AutoResearch): TVL velocity in USD and vs ATH
    if (onchain.weekly_tvl_velocity_usd != null) {
      const vel = onchain.weekly_tvl_velocity_usd;
      const velLabel = vel >= 10_000_000 ? '🚀 major inflow' : vel >= 1_000_000 ? '📈 inflow' : vel <= -10_000_000 ? '🔴 major outflow' : vel <= -1_000_000 ? '📉 outflow' : '→ roughly stable';
      const velFmt = Math.abs(vel) >= 1e9 ? `${vel >= 0 ? '+' : ''}$${(vel / 1e9).toFixed(2)}B` : Math.abs(vel) >= 1e6 ? `${vel >= 0 ? '+' : ''}$${(vel / 1e6).toFixed(1)}M` : `${vel >= 0 ? '+' : ''}$${(vel / 1e3).toFixed(0)}K`;
      onchainLines.push(`- TVL velocity: ${velFmt}/week (${velLabel})`);
    }
    if (onchain.tvl_vs_ath_pct != null) {
      const v = onchain.tvl_vs_ath_pct;
      const vLabel = v >= -10 ? 'near TVL ATH' : v >= -50 ? `${Math.abs(v).toFixed(0)}% below TVL ATH` : `far below TVL ATH (${Math.abs(v).toFixed(0)}% down)`;
      onchainLines.push(`- TVL vs ATH: ${vLabel}`);
    }
    onchainLines.push(add('Fees 7d', onchain.fees_7d, formatNumber));
    // Round 238 (AutoResearch): surface fees_7d_prev for trend comparison in LLM context
    if (onchain.fees_7d != null && onchain.fees_7d_prev != null && onchain.fees_7d_prev > 0) {
      const feeChangePct = ((onchain.fees_7d - onchain.fees_7d_prev) / onchain.fees_7d_prev) * 100;
      const feeChangeLabel = feeChangePct > 20 ? '📈 growing' : feeChangePct < -20 ? '📉 declining' : '→ stable';
      onchainLines.push(`- Fees trend: ${feeChangeLabel} (${feeChangePct > 0 ? '+' : ''}${feeChangePct.toFixed(0)}% vs prior 7d, prev: ${formatNumber(onchain.fees_7d_prev)})`);
    }
    onchainLines.push(add('Revenue 7d', onchain.revenue_7d, formatNumber));
    onchainLines.push(add('Treasury', onchain.treasury_balance, formatNumber));
    // Round R156: Revenue-to-fees ratio (protocol efficiency — what % of fees become protocol revenue)
    if (onchain.fees_7d != null && onchain.fees_7d > 0 && onchain.revenue_7d != null) {
      const ratio = onchain.revenue_7d / onchain.fees_7d;
      const ratioLabel = ratio >= 0.5 ? 'high capture' : ratio >= 0.2 ? 'moderate capture' : 'low capture (most fees go to LPs/users)';
      onchainLines.push(`- Revenue Capture: ${(ratio * 100).toFixed(1)}% of fees → protocol (${ratioLabel})`);
    }
    // Round 362: revenue_trend (improving/declining/flat)
    if (onchain.revenue_trend && onchain.revenue_trend !== 'flat') {
      const trendEmoji = onchain.revenue_trend === 'improving' ? '📈' : '📉';
      onchainLines.push(`- Revenue trend: ${trendEmoji} ${onchain.revenue_trend} (vs prior 7d)`);
    }
    // Round 387: active_addresses_7d — user activity signal
    if (onchain.active_addresses_7d != null && onchain.active_addresses_7d > 0) {
      const aaLabel = onchain.active_addresses_7d >= 100000 ? 'massive user base' : onchain.active_addresses_7d >= 10000 ? 'large user base' : onchain.active_addresses_7d >= 1000 ? 'medium user base' : onchain.active_addresses_7d >= 100 ? 'small user base' : 'niche/early';
      onchainLines.push(`- Active addresses 7d: ${onchain.active_addresses_7d.toLocaleString('en-US')} (${aaLabel})`);
    }
    // Round 387: daily_active_users as product engagement signal  
    if (onchain.daily_active_users != null && onchain.daily_active_users > 0) {
      onchainLines.push(`- Daily active users: ~${onchain.daily_active_users.toLocaleString('en-US')}/day`);
    }

    // Round 362: fees_per_tvl_7d as capital productivity signal
    if (onchain.fees_per_tvl_7d != null && onchain.tvl > 0) {
      const ftLabel = onchain.fees_per_tvl_7d >= 0.5 ? 'highly productive capital' : onchain.fees_per_tvl_7d >= 0.1 ? 'moderate' : 'low capital productivity';
      onchainLines.push(`- Fees/TVL: ${(onchain.fees_per_tvl_7d * 100).toFixed(2)}% weekly (${ftLabel})`);
    }
    // Round 362: revenue_per_active_user (product-market fit signal)
    if (onchain.revenue_per_active_user != null) {
      const rpuLabel = onchain.revenue_per_active_user >= 1 ? 'strong monetization' : onchain.revenue_per_active_user >= 0.1 ? 'moderate' : onchain.revenue_per_active_user >= 0.01 ? 'early monetization' : 'pre-monetization';
      onchainLines.push(`- Revenue/user/day: $${onchain.revenue_per_active_user.toFixed(4)} (${rpuLabel})`);
    }
    // Round R156: TVL stickiness with context
    // Round 238 (AutoResearch): added 'growing' tier context
    if (onchain.tvl_stickiness) {
      const stickinessContext = onchain.tvl_stickiness === 'growing' ? 'capital actively inflowing — strong demand signal'
        : onchain.tvl_stickiness === 'sticky' ? 'capital retention — users committed'
        : onchain.tvl_stickiness === 'fleeing' ? 'capital exit — users withdrawing'
        : 'stable but cautious';
      onchainLines.push(`- TVL Stickiness: ${onchain.tvl_stickiness} (${stickinessContext})`);
    }
    if (onchain.protocol_maturity) {
      onchainLines.push(`- Protocol Maturity: ${onchain.protocol_maturity}`);
    }
    // Round 378: protocol_age_days for battle-tested context
    if (onchain.protocol_age_days != null && onchain.protocol_age_days > 0) {
      const ageYrs = (onchain.protocol_age_days / 365).toFixed(1);
      const ageCtx = onchain.protocol_age_days >= 1095 ? 'battle-tested (3+ years of on-chain data)' : onchain.protocol_age_days >= 365 ? 'established (1+ year of on-chain data)' : onchain.protocol_age_days >= 90 ? 'growing protocol (3-12 months)' : 'very new protocol';
      onchainLines.push(`- Protocol age: ${ageYrs} years since DeFiLlama listing (${ageCtx})`);
    }
    // Round 378: onchain_maturity_score composite index
    if (onchain.onchain_maturity_score != null) {
      const omsLabel = onchain.onchain_maturity_score >= 70 ? 'mature — sustainable model' : onchain.onchain_maturity_score >= 40 ? 'developing — improving' : 'immature — risky fundamentals';
      onchainLines.push(`- Onchain maturity score: ${onchain.onchain_maturity_score}/100 (${omsLabel})`);
    }

    const validOnchain = onchainLines.filter(Boolean);
    if (validOnchain.length) {
      lines.push('ONCHAIN [DeFiLlama]:');
      lines.push(...validOnchain);
      const missing = [];
      if (onchain.treasury_balance == null) missing.push('treasury');
      if (missing.length) lines.push(`(missing: ${missing.join(', ')})`);
      lines.push('');
    } else {
      gaps.push('onchain (no data)');
    }
  } else {
    gaps.push('onchain (no data)');
  }

  // SOCIAL [Exa/X]
  const social = rawData.social || {};
  if (!social.error && rawData.social) {
    const socialLines = [];
    const mentions = social.filtered_mentions ?? social.mentions;
    if (mentions != null) {
      const mentionLabel = mentions >= 200 ? 'viral' : mentions >= 50 ? 'active' : mentions >= 10 ? 'moderate' : 'low';
      socialLines.push(`- Mentions: ${mentions} (${mentionLabel})${social.filtered_mentions != null && social.mentions != null && social.filtered_mentions !== social.mentions ? ` — ${social.filtered_mentions} quality-filtered` : ''}`);
    }
    socialLines.push(add('Sentiment Score', social.sentiment_score, (v) => {
      const label = v > 0.4 ? 'strongly bullish' : v > 0.2 ? 'bullish-leaning' : v < -0.4 ? 'strongly bearish' : v < -0.2 ? 'bearish-leaning' : 'neutral';
      return `${v.toFixed(2)} (${label})`;
    }));
    socialLines.push(add('Bot Ratio', social.bot_ratio, (v) => {
      const quality = v > 0.4 ? 'high bot noise' : v > 0.2 ? 'moderate bot noise' : 'clean signal';
      return `${(v * 100).toFixed(0)}% (${quality})`;
    }));
    // Round R161: Surface sentiment breakdown if available
    if (social.sentiment_counts) {
      const { bullish = 0, bearish = 0, neutral = 0 } = social.sentiment_counts;
      const total = bullish + bearish + neutral;
      if (total > 0) {
        const bullPct = ((bullish / total) * 100).toFixed(0);
        const bearPct = ((bearish / total) * 100).toFixed(0);
        socialLines.push(`- Sentiment breakdown: ${bullPct}% bullish / ${bearPct}% bearish (${total} articles analyzed)`);
      }
    }
    if (Array.isArray(social.key_narratives) && social.key_narratives.length) {
      socialLines.push(`- Key narratives: ${social.key_narratives.slice(0, 4).join(', ')}`);
    }
    if (social.unlock_mentions != null && social.unlock_mentions > 0) {
      socialLines.push(`- Unlock/vesting mentions: ${social.unlock_mentions} (supply pressure signal)`);
    }
    // Round 233 (AutoResearch nightly): surface sentiment credibility for LLM context
    if (social.sentiment_credibility_score != null) {
      const credLabel = social.sentiment_credibility_score >= 60 ? 'high credibility' : social.sentiment_credibility_score >= 30 ? 'moderate credibility' : 'low credibility (noise risk)';
      socialLines.push(`- Sentiment credibility: ${social.sentiment_credibility_score}/100 (${credLabel})`);
    }
    // Round 238 (AutoResearch): combine exploit + hack_exploit mentions for fuller coverage
    const totalExploitMentions = (social.exploit_mentions ?? 0) + (social.hack_exploit_mentions ?? 0);
    if (totalExploitMentions > 0) {
      socialLines.push(`- Exploit/hack mentions: ${totalExploitMentions} ⚠️`);
    }
    // Round 238 (AutoResearch): airdrop mentions — positive catalyst signal for Grok analysis
    if (social.airdrop_mentions != null && social.airdrop_mentions > 0) {
      socialLines.push(`- Airdrop mentions: ${social.airdrop_mentions} (potential demand catalyst)`);
    }
    // Round 371: avg_article_quality_score — tells LLM if coverage is from reputable sources
    if (social.avg_article_quality_score != null) {
      const aqLabel = social.avg_article_quality_score >= 1.3 ? 'tier-1 dominated (CoinDesk/Bloomberg-class)' : social.avg_article_quality_score >= 1.1 ? 'above-average source quality' : social.avg_article_quality_score >= 0.9 ? 'average source quality' : 'low-quality/blog coverage';
      socialLines.push(`- Source quality: ${social.avg_article_quality_score.toFixed(2)}x (${aqLabel})`);
    }
    // Round 371: competitor_content_ratio — signals secondary vs primary narrative
    if (social.competitor_content_ratio != null && social.competitor_content_ratio > 0.3) {
      const compLabel = social.competitor_content_ratio > 0.6 ? '⚠️ mostly secondary coverage (discussed in competitor context)' : 'mixed — partially in competitor context';
      socialLines.push(`- Coverage type: ${(social.competitor_content_ratio * 100).toFixed(0)}% competitor-framed articles (${compLabel})`);
    }

    const validSocial = socialLines.filter(Boolean);
    if (validSocial.length) {
      lines.push('SOCIAL [Exa/X]:');
      lines.push(...validSocial);
      lines.push('');
    } else {
      gaps.push('social (no data)');
    }
  } else {
    gaps.push('social (no data)');
  }

  // GITHUB [GitHub API]
  const github = rawData.github || {};
  if (!github.error && rawData.github) {
    const githubLines = [];
    githubLines.push(add('Commits 90d', github.commits_90d, (v) => {
      const velocityLabel = v >= 100 ? 'very active' : v >= 30 ? 'active' : v >= 10 ? 'moderate' : 'low activity';
      return `${v} (${velocityLabel})`;
    }));
    githubLines.push(add('Contributors', github.contributors, (v) => {
      const breadthLabel = v >= 50 ? 'large team' : v >= 10 ? 'small team' : 'solo/micro';
      return `${v} (${breadthLabel})`;
    }));
    githubLines.push(add('Stars', github.stars, (v) => {
      const tractionLabel = v >= 10000 ? 'high traction' : v >= 1000 ? 'notable' : 'niche';
      return `${v} (${tractionLabel})`;
    }));
    githubLines.push(add('Commit Trend', github.commit_trend));
    // Round 361: commit_frequency (commits/week normalized over 90d)
    if (github.commit_frequency != null) {
      const cfLabel = github.commit_frequency >= 10 ? 'high velocity' : github.commit_frequency >= 3 ? 'steady' : 'low cadence';
      githubLines.push(`- Commit frequency: ${github.commit_frequency.toFixed(1)}/week avg (${cfLabel})`);
    }
    // Round 361: dev recency signals
    if (github.days_since_last_commit != null) {
      const staleLabel = github.days_since_last_commit <= 7 ? 'fresh' : github.days_since_last_commit <= 30 ? 'recent' : github.days_since_last_commit <= 90 ? 'slowing' : '⚠️ stale';
      githubLines.push(`- Last commit: ${github.days_since_last_commit}d ago (${staleLabel})`);
    }
    if (github.has_recent_release === true) {
      githubLines.push(`- Recent release: yes (within 90d) — active shipping signal`);
    } else if (github.has_recent_release === false) {
      githubLines.push(`- Recent release: none in 90d`);
    }
    if (github.open_prs_count != null) {
      const prLabel = github.open_prs_count >= 20 ? 'active pipeline' : github.open_prs_count >= 5 ? 'normal' : 'low';
      githubLines.push(`- Open PRs: ${github.open_prs_count} (${prLabel})`);
    }
    githubLines.push(add('Language', github.language));
    githubLines.push(add('License', github.license));
    githubLines.push(add('Watchers', github.watchers));
    // Round R153: dev_quality_index if available
    if (github.dev_quality_index != null) {
      const dqi = github.dev_quality_index;
      const dqLabel = dqi >= 70 ? 'strong' : dqi >= 40 ? 'average' : 'weak';
      githubLines.push(`- Dev Quality Index: ${dqi}/100 (${dqLabel})`);
    }
    // Round 382: critical_issue_ratio — issues per contributor (dev health signal)
    if (github.critical_issue_ratio != null) {
      const cirLabel = github.critical_issue_ratio >= 10 ? '⚠️ overwhelming backlog' : github.critical_issue_ratio >= 5 ? 'high issue load' : github.critical_issue_ratio >= 2 ? 'moderate' : '✅ healthy capacity';
      githubLines.push(`- Issues/contributor: ${github.critical_issue_ratio.toFixed(1)}x (${cirLabel})`);
    }
    // Round 367: github_velocity_tier for quick orientation
    if (github.github_velocity_tier) {
      const velTierDesc = {
        hyperspeed: '🚀 hyperspeed (2+ commits/day)',
        active: '✅ active (5-14/wk)',
        moderate: '→ moderate (1-5/wk)',
        slow: '🟡 slow (<1/wk)',
        slowing: '🟡 slowing (no commits 3-6m)',
        stale: '🔴 stale (no commits 6m+)',
        inactive: '❌ inactive',
      };
      githubLines.push(`- Velocity tier: ${velTierDesc[github.github_velocity_tier] || github.github_velocity_tier}`);
    }
    // Round 367: contributor_bus_factor qualitative label
    if (github.contributor_bus_factor && !github.bus_factor_score) {
      const bfDesc = {
        critical: '⚠️ critical — 1 person controls >80% of commits',
        high: '⚠️ high — top contributor dominates',
        moderate: '→ moderate concentration',
        healthy: '✅ healthy — distributed contributions',
      };
      githubLines.push(`- Contributor distribution: ${bfDesc[github.contributor_bus_factor] || github.contributor_bus_factor}`);
    }

    const validGithub = githubLines.filter(Boolean);
    if (validGithub.length) {
      lines.push('GITHUB [GitHub API]:');
      lines.push(...validGithub);
      lines.push('');
    } else {
      gaps.push('github (no data)');
    }
  } else {
    gaps.push('github (no data)');
  }

  // DEX [DexScreener]
  const dex = rawData.dex || {};
  if (!dex.error && rawData.dex) {
    const dexLines = [];
    dexLines.push(add('DEX Price', dex.dex_price_usd, formatNumber));
    dexLines.push(add('Liquidity', dex.dex_liquidity_usd, (v) => {
      const liqLabel = v >= 5e6 ? 'deep — institutional grade' : v >= 1e6 ? 'good — retail friendly' : v >= 100e3 ? 'moderate — light slippage' : v >= 50e3 ? 'thin — notable slippage' : 'very thin — high slippage risk';
      return `${formatNumber(v)} (${liqLabel})`;
    }));
    dexLines.push(add('Pair Count', dex.dex_pair_count, (v) => {
      return `${v} pair${v !== 1 ? 's' : ''}${dex.dex_chains?.length ? ` across ${dex.dex_chains.slice(0, 3).join(', ')}` : ''}`;
    }));
    dexLines.push(add('Buy/Sell Ratio', dex.buy_sell_ratio, (v) => {
      const pressureLabel = v >= 1.15 ? 'buy pressure 🟢' : v <= 0.87 ? 'sell pressure 🔴' : 'balanced';
      return `${v.toFixed(2)} (${pressureLabel})`;
    }));
    if (dex.buys_24h != null && dex.sells_24h != null) {
      dexLines.push(`- Txns 24h: ${dex.buys_24h} buys / ${dex.sells_24h} sells`);
    }
    if (dex.top_dex_name) {
      dexLines.push(`- Primary venue: ${dex.top_dex_name}`);
    }
    if (dex.volume_momentum) {
      const momentumLabel = dex.volume_momentum === 'accelerating' ? '📈 accelerating (1h annualized > 24h)' : dex.volume_momentum === 'decelerating' ? '📉 decelerating (1h annualized < 50% of 24h)' : 'stable';
      dexLines.push(`- Volume momentum: ${momentumLabel}`);
    }
    if (dex.chain_liquidity_breakdown && Object.keys(dex.chain_liquidity_breakdown).length > 1) {
      const topChains = Object.entries(dex.chain_liquidity_breakdown).slice(0, 3).map(([c, v]) => `${c}: $${(v / 1000).toFixed(0)}K`).join(', ');
      dexLines.push(`- Liquidity by chain: ${topChains}`);
    }
    // Round 237 (AutoResearch nightly): sell wall risk indicator
    if (dex.sell_wall_risk && dex.sell_wall_risk !== 'low') {
      dexLines.push(`- ⚠️ Sell wall risk: ${dex.sell_wall_risk.toUpperCase()} (ratio: ${dex.buy_sell_ratio ?? 'n/a'}, momentum: ${dex.volume_momentum ?? 'n/a'})`);
    }
    // Round 381 (AutoResearch): most_active_chain for liquidity context
    if (dex.most_active_chain && dex.most_active_chain !== dex.dex_chains?.[0]) {
      dexLines.push(`- Most active chain: ${dex.most_active_chain} (by 24h volume)`);
    }
    // Round 221 (AutoResearch): net buy pressure % and volume/liquidity ratio
    if (dex.net_buy_pressure_pct != null) {
      const netBuyLabel = dex.net_buy_pressure_pct > 55 ? 'accumulation' : dex.net_buy_pressure_pct < 45 ? 'distribution' : 'balanced';
      dexLines.push(`- Net buy pressure: ${dex.net_buy_pressure_pct.toFixed(1)}% of txns are buys (${netBuyLabel})`);
    }
    if (dex.volume_to_liquidity_ratio != null) {
      const vtlLabel = dex.volume_to_liquidity_ratio > 1 ? 'high capital efficiency' : dex.volume_to_liquidity_ratio > 0.1 ? 'moderate' : 'low';
      dexLines.push(`- Volume/Liquidity: ${dex.volume_to_liquidity_ratio.toFixed(3)}x (${vtlLabel})`);
    }
    // Round 381 (AutoResearch): wash trading risk + median trade size for LLM context
    if (dex.wash_trading_risk && dex.wash_trading_risk !== 'low') {
      dexLines.push(`- ⚠️ Wash trading risk: ${dex.wash_trading_risk.toUpperCase()} — avg trade size $${dex.median_trade_size_usd?.toFixed(2) ?? 'n/a'}, suspicious volume pattern`);
    } else if (dex.median_trade_size_usd != null) {
      const tradeLabel = dex.median_trade_size_usd >= 10000 ? 'whale-sized trades' : dex.median_trade_size_usd >= 500 ? 'institutional/mid retail' : dex.median_trade_size_usd >= 50 ? 'retail organic' : 'micro trades (bot risk)';
      dexLines.push(`- Avg trade size: $${dex.median_trade_size_usd.toFixed(2)} (${tradeLabel})`);
    }

    const validDex = dexLines.filter(Boolean);
    if (validDex.length) {
      lines.push('DEX [DexScreener]:');
      lines.push(...validDex);
      lines.push('');
    } else {
      gaps.push('dex (no data)');
    }
  } else {
    gaps.push('dex (no data)');
  }

  // REDDIT
  const reddit = rawData.reddit || {};
  if (!reddit.error && (reddit.post_count != null || reddit.sentiment != null)) {
    const redditLines = [];
    redditLines.push(add('Post Count', reddit.post_count));
    redditLines.push(add('Sentiment', reddit.sentiment));
    if (reddit.sentiment_momentum && reddit.sentiment_momentum !== 'stable') {
      const momEmoji = reddit.sentiment_momentum === 'improving' ? '📈' : '📉';
      redditLines.push(`- Sentiment momentum: ${momEmoji} ${reddit.sentiment_momentum} (last 24h vs week)`);
    }
    if (reddit.avg_post_score != null && reddit.avg_post_score > 0) {
      const scoreLabel = reddit.avg_post_score >= 100 ? 'high upvote quality' : reddit.avg_post_score >= 20 ? 'moderate engagement' : 'low engagement';
      redditLines.push(`- Avg post score: ${reddit.avg_post_score} upvotes (${scoreLabel})`);
    }
    if (reddit.subreddit_quality && reddit.subreddit_quality !== 'niche') {
      redditLines.push(`- Subreddit quality: ${reddit.subreddit_quality} (${reddit.tier1_subreddit_hits ?? 0} tier-1 subreddits)`);
    }
    const validReddit = redditLines.filter(Boolean);
    if (validReddit.length) {
      lines.push('REDDIT:');
      lines.push(...validReddit);
      lines.push('');
    }
  } else {
    gaps.push('reddit (no data)');
  }

  // X/TWITTER [Grok Fast]
  const xSocial = rawData.x_social || {};
  if (!xSocial.error && rawData.x_social) {
    lines.push('X/TWITTER [Grok Fast]:');
    if (xSocial.sentiment) lines.push(`- Sentiment: ${xSocial.sentiment} (score: ${xSocial.sentiment_score})`);
    if (xSocial.mention_volume) lines.push(`- Mention volume: ${xSocial.mention_volume}`);
    if (xSocial.key_narratives?.length) lines.push(`- Key narratives: ${xSocial.key_narratives.join(', ')}`);
    if (xSocial.notable_accounts?.length) lines.push(`- Notable accounts: ${xSocial.notable_accounts.map((a) => `@${a}`).join(', ')}`);
    if (xSocial.kol_sentiment) lines.push(`- KOL sentiment: ${xSocial.kol_sentiment}`);
    if (xSocial.summary) lines.push(`- Summary: ${xSocial.summary}`);
    // Round 56 (AutoResearch): surface divergence between X and Exa/web sentiment for LLM context
    const webSocial = rawData.social || {};
    if (!webSocial.error && webSocial.sentiment_score != null && xSocial.sentiment_score != null) {
      const div = (xSocial.sentiment_score - webSocial.sentiment_score).toFixed(2);
      lines.push(`- Divergence vs web: ${div > 0 ? '+' : ''}${div} (X vs web/Exa sentiment)`);
    }
    lines.push('');
  }

  // HOLDERS — Round 362: accept both field names (top10_concentration_pct and top10_holder_concentration_pct)
  const holders = rawData.holders || {};
  const holderConcentration = holders.top10_holder_concentration_pct ?? holders.top10_concentration_pct;
  if (!holders.error && holderConcentration != null) {
    lines.push('HOLDERS:');
    lines.push(add('Top 10 Concentration', holderConcentration, (v) => {
      const concLabel = v > 80 ? 'extreme — whale squeeze risk' : v > 60 ? 'high — dump risk' : v > 40 ? 'moderate' : 'well-distributed';
      return `${v.toFixed(1)}% (${concLabel})`;
    }));
    // Round 362: add holder count if available
    if (holders.holder_count != null) {
      const hdLabel = holders.holder_count >= 100000 ? 'large holder base' : holders.holder_count >= 10000 ? 'medium holder base' : holders.holder_count >= 1000 ? 'small holder base' : 'very few holders';
      lines.push(`- Holder count: ${holders.holder_count.toLocaleString('en-US')} (${hdLabel})`);
    }
    lines.push('');
  } else {
    gaps.push('holders (no data)');
  }

  // ECOSYSTEM
  const ecosystem = rawData.ecosystem || {};
  if (!ecosystem.error && (ecosystem.chain_count != null || ecosystem.primary_chain)) {
    lines.push('ECOSYSTEM:');
    if (ecosystem.chain_count != null) {
      const chainLabel = ecosystem.chain_count >= 10 ? 'highly multichain' : ecosystem.chain_count >= 5 ? 'multichain' : ecosystem.chain_count >= 2 ? 'cross-chain' : 'single chain';
      lines.push(`- Supported chains: ${ecosystem.chain_count} (${chainLabel})`);
    }
    if (ecosystem.primary_chain) lines.push(`- Primary chain: ${ecosystem.primary_chain}`);
    lines.push('');
  }

  // TOKENOMICS
  const tokenomics = rawData.tokenomics || {};
  if (!tokenomics.error && tokenomics.pct_circulating != null) {
    lines.push('TOKENOMICS:');
    lines.push(add('% Circulating', tokenomics.pct_circulating, (v) => {
      const unlockRisk = v < 30 ? 'HIGH unlock risk — most supply not yet circulating' : v < 60 ? 'moderate unlock risk' : v < 90 ? 'low unlock risk' : 'fully circulating';
      return `${v.toFixed(1)}% (${unlockRisk})`;
    }));
    // Round 363: surface composite unlock_risk_label for quicker LLM orientation
    if (tokenomics.unlock_risk_label) {
      const urlContext = tokenomics.unlock_risk_label === 'critical' ? '⚠️ immediate price suppression risk from pending unlocks/team allocations' : tokenomics.unlock_risk_label === 'high' ? 'significant dilution risk within 6-12 months' : tokenomics.unlock_risk_label === 'moderate' ? 'manageable dilution risk' : 'low dilution risk';
      lines.push(`- Unlock risk: ${tokenomics.unlock_risk_label.toUpperCase()} — ${urlContext}`);
    }
    if (tokenomics.inflation_rate != null) {
      const inflLabel = tokenomics.inflation_rate > 20 ? 'hyperinflationary' : tokenomics.inflation_rate > 8 ? 'high inflation' : tokenomics.inflation_rate > 3 ? 'moderate inflation' : tokenomics.inflation_rate > 0 ? 'low inflation' : 'deflationary';
      lines.push(`- Inflation rate: ${tokenomics.inflation_rate.toFixed(1)}%/yr (${inflLabel})`);
    }
    if (tokenomics.vesting_info) {
      const vi = tokenomics.vesting_info;
      if (vi.team_allocation_pct != null) {
        lines.push(`- Team allocation: ${vi.team_allocation_pct.toFixed(1)}%${vi.team_allocation_pct > 30 ? ' ⚠️ HIGH' : ''}`);
      }
      if (vi.vesting_schedule_summary) {
        lines.push(`- Vesting: ${vi.vesting_schedule_summary}`);
      }
    }
    lines.push('');
  }

  // CONTRACT — Round 363: enriched with audit and security data
  const contract = rawData.contract || {};
  if (!contract.error && (contract.verified != null || contract.is_proxy != null || contract.audited != null)) {
    lines.push('CONTRACT:');
    if (contract.verified != null) lines.push(`- Verified: ${contract.verified ? '✅ Yes' : '❌ No'}`);
    if (contract.is_proxy != null) lines.push(`- Proxy contract: ${contract.is_proxy ? 'Yes (upgradeable)' : 'No (immutable)'}`);
    if (contract.audited != null) lines.push(`- Audited: ${contract.audited ? '✅ Yes' : '❌ No'}`);
    if (contract.audit_firms?.length) lines.push(`- Audit firms: ${contract.audit_firms.join(', ')}`);
    if (contract.honeypot != null) lines.push(`- Honeypot: ${contract.honeypot ? '⚠️ YES — avoid' : 'No'}`);
    if (contract.buy_tax != null || contract.sell_tax != null) {
      const buyTax = contract.buy_tax != null ? `buy ${contract.buy_tax}%` : '';
      const sellTax = contract.sell_tax != null ? `sell ${contract.sell_tax}%` : '';
      const taxParts = [buyTax, sellTax].filter(Boolean).join(', ');
      if (taxParts) lines.push(`- Tax: ${taxParts}${(contract.buy_tax > 5 || contract.sell_tax > 5) ? ' ⚠️ HIGH' : ''}`);
    }
    lines.push('');
  } else {
    gaps.push('contract (no data)');
  }

  // Round 366: 52-week price context section — gives LLM institutional-grade price range context
  const priceVs52w = rawData?.market?.price_vs_52w;
  if (priceVs52w && priceVs52w.tier) {
    const tierDesc = {
      near_high: '🟢 near 52-week HIGH — price discovery / momentum phase',
      mid_range: '→ mid-range — neutral price positioning',
      below_mid: '🟡 below 52-week midpoint — under pressure, possible recovery play',
      near_low: '🔴 near 52-week LOW — structural weakness or deep value territory',
    };
    lines.push('\n52-WEEK PRICE CONTEXT:');
    lines.push(`- Position: ${tierDesc[priceVs52w.tier] || priceVs52w.tier}`);
    if (priceVs52w.pct_from_52w_high != null) lines.push(`- From 52w high: ${priceVs52w.pct_from_52w_high.toFixed(1)}%`);
    if (priceVs52w.pct_from_52w_low != null) lines.push(`- From 52w low: +${priceVs52w.pct_from_52w_low.toFixed(1)}%`);
    lines.push('');
  }

  // Round R151: Derived efficiency metrics — P/TVL ratio and Volume/MCap velocity
  const mkt = rawData.market || {};
  const och = rawData.onchain || {};
  const mcapVal = mkt.market_cap;
  const tvlVal = och.tvl;
  const volVal = mkt.total_volume;
  if (mcapVal != null && tvlVal != null && tvlVal > 0) {
    const ptvl = mcapVal / tvlVal;
    lines.push('\nDERIVED METRICS:');
    lines.push(`- P/TVL ratio: ${ptvl.toFixed(2)}x (MCap ${formatNumber(mcapVal)} / TVL ${formatNumber(tvlVal)}) — below 1.0 = undervalued vs locked capital`);
    if (volVal != null && mcapVal > 0) {
      const velPct = (volVal / mcapVal) * 100;
      lines.push(`- Volume velocity: ${velPct.toFixed(2)}% of MCap traded in 24h — above 10% = high conviction activity`);
    }
    if (och.fees_7d != null && tvlVal > 0) {
      const feeEfficiency = (och.fees_7d / (tvlVal / 1e6)).toFixed(2);
      lines.push(`- Fee efficiency: $${feeEfficiency}/M TVL per week — measures capital productivity`);
    }
    lines.push('');
  }

  // Round 237 (AutoResearch nightly): Holder engagement and Reddit activity summary
  const holderEngagement = rawData?.market?.holder_engagement_score;
  const redditActivityScore = rawData?.reddit?.reddit_activity_score;
  if (holderEngagement != null || redditActivityScore != null) {
    lines.push('\nENGAGEMENT METRICS:');
    if (holderEngagement != null) {
      const engLabel = holderEngagement >= 70 ? 'very active' : holderEngagement >= 40 ? 'moderate' : 'low';
      lines.push(`- Holder engagement: ${holderEngagement}/100 (${engLabel}) — combines volume velocity, community size, trending status`);
    }
    if (redditActivityScore != null) {
      const redLabel = redditActivityScore >= 60 ? 'strong community discussion' : redditActivityScore >= 30 ? 'moderate discussion' : 'limited discussion';
      lines.push(`- Reddit activity score: ${redditActivityScore}/100 (${redLabel}) — upvote-weighted, recency-adjusted`);
    }
    lines.push('');
  }

  // Round 371: Narrative momentum quality context
  const narrMom = rawData?.narrative_momentum;
  if (narrMom && narrMom.active_narratives?.length > 0) {
    lines.push('\nNARRATIVE MOMENTUM:');
    lines.push(`- Alignment: ${narrMom.narrative_alignment?.toUpperCase() || 'n/a'}`);
    if (narrMom.active_narratives?.length) lines.push(`- Active narratives: ${narrMom.active_narratives.slice(0, 5).map(n => n.replace(/_/g, ' ')).join(', ')}`);
    if (narrMom.narrative_dominance_score != null) {
      const ndLabel = narrMom.narrative_dominance_score >= 70 ? 'dominant narrative' : narrMom.narrative_dominance_score >= 40 ? 'moderate narrative' : 'fragmented narrative';
      lines.push(`- Dominance score: ${narrMom.narrative_dominance_score}/100 (${ndLabel})`);
    }
    if (narrMom.narrative_momentum_quality) {
      const nmqLabel = narrMom.narrative_momentum_quality === 'accelerating' ? '📈 accelerating — narrative gaining strength' : narrMom.narrative_momentum_quality === 'decelerating' ? '📉 decelerating — narrative fading' : '→ stable';
      lines.push(`- Momentum quality: ${nmqLabel}`);
    }
    lines.push('');
  }

  // Round R14: Global macro context section
  const btcDom = rawData?.market?.btc_dominance;
  const totalMcap = rawData?.market?.total_market_cap_usd;
  const globalChange = rawData?.market?.market_cap_change_pct_24h_global;
  if (btcDom != null || totalMcap != null) {
    const macroLines = [
      add('BTC dominance', btcDom, (v) => `${v.toFixed(1)}%`),
      add('Total crypto market cap', totalMcap, formatNumber),
      add('Global market 24h change', globalChange, (v) => `${Number(v).toFixed(2)}%`),
    ].filter(Boolean);
    if (macroLines.length > 0) {
      lines.push('\nMACRO CONTEXT [CoinGecko Global]');
      lines.push(...macroLines);
    }
  }

  // Round R168: Alpha signals and red flags summary for LLM orientation
  const alphaSignals = rawData.alpha_signals;
  const redFlags = rawData.red_flags;
  if (Array.isArray(alphaSignals) && alphaSignals.length > 0) {
    const strongSignals = alphaSignals.filter(s => s.strength === 'strong');
    const modSignals = alphaSignals.filter(s => s.strength === 'moderate');
    lines.push(`\nALGORITHMIC ALPHA SIGNALS (${alphaSignals.length} total, ${strongSignals.length} strong):`);
    for (const s of alphaSignals.slice(0, 5)) {
      lines.push(`- [${s.strength?.toUpperCase() || 'MODERATE'}] ${s.signal}: ${s.detail}`);
    }
    lines.push('');
  }
  if (Array.isArray(redFlags) && redFlags.length > 0) {
    const critFlags = redFlags.filter(f => f.severity === 'critical');
    lines.push(`\nALGORITHMIC RED FLAGS (${redFlags.length} total, ${critFlags.length} critical):`);
    for (const f of redFlags.slice(0, 5)) {
      lines.push(`- [${f.severity?.toUpperCase() || 'WARNING'}] ${f.flag}: ${f.detail}`);
    }
    lines.push('');
  }

  // Data gaps summary
  if (gaps.length) {
    lines.push(`DATA GAPS: ${gaps.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Round R170: Builds a compact score dimension summary block for LLM orientation.
 * Shows dimension scores with labels so the LLM understands where strength/weakness lies.
 */
export function buildScoreSummary(scores = {}) {
  if (!scores?.overall) return '';
  const dims = [
    { key: 'market_strength', label: 'Market' },
    { key: 'onchain_health', label: 'Onchain' },
    { key: 'social_momentum', label: 'Social' },
    { key: 'development', label: 'Dev' },
    { key: 'tokenomics_health', label: 'Tokenomics' },
    { key: 'risk', label: 'Risk' },
    { key: 'distribution', label: 'Distribution' },
  ];
  const parts = ['=== SCORE DIMENSIONS ==='];
  for (const { key, label } of dims) {
    const dim = scores[key];
    if (!dim) continue;
    const s = dim.score ?? 0;
    const bar = '█'.repeat(Math.round(s)) + '░'.repeat(10 - Math.round(s));
    const qLabel = s >= 7.5 ? 'strong' : s >= 5.5 ? 'moderate' : s >= 3.5 ? 'weak' : 'very weak';
    const completeness = dim.completeness != null ? ` (${dim.completeness}% data)` : '';
    parts.push(`${label.padEnd(12)} ${bar} ${s.toFixed(1)}/10 [${qLabel}]${completeness}`);
  }
  const overall = scores.overall;
  parts.push(`${'OVERALL'.padEnd(12)} ${overall.score?.toFixed(1)}/10${overall.completeness != null ? ` (data: ${overall.completeness}%)` : ''}`);
  return parts.join('\n');
}

function inferProjectCategory(rawData = {}) {
  const candidates = [
    rawData?.onchain?.category,
    rawData?.sector_comparison?.category,
    rawData?.sector_context?.category,
    rawData?.ecosystem?.category,
    rawData?.market?.category,
  ];

  for (const value of candidates) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }

  return null;
}

function summarizeChains(rawData = {}) {
  const candidates = [
    rawData?.dex?.dex_chains,
    rawData?.ecosystem?.chains,
    rawData?.onchain?.chains,
  ];

  for (const list of candidates) {
    if (Array.isArray(list) && list.length) {
      return list
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 3);
    }
  }

  const primary = String(rawData?.ecosystem?.primary_chain || '').trim();
  return primary ? [primary] : [];
}

function buildPrompt(projectName, rawData, scores) {
  const overallScore = scores?.overall?.score ?? 0;
  const factRegistry = buildFactRegistry(rawData);

  return [
    '## ROLE',
    'You are a senior crypto alpha analyst. Your job: produce actionable, evidence-based reports for sophisticated investors. No fluff, no generic disclaimers.',

    // Round R15: Add macro context instruction
    '## MACRO CONTEXT AWARENESS',
    'The RAW_DATA_SUMMARY may include macro data (BTC dominance, global market cap change). Use this to contextualize the project\'s analysis:',
    '- High BTC dominance (>58%) = alt risk-off environment → factor into risk assessment',
    '- Low BTC dominance (<45%) = altcoin season potential → factor into opportunity assessment',
    '- Global market down >3% 24h = risk-off → raise bear case weight',
    '- Global market up >3% 24h = risk-on → may inflate short-term scores',
    '',
    '## 52-WEEK RANGE CONTEXT (when available)',
    'price_vs_52w.tier provides institutional-grade context:',
    '- near_high (within 10% of 52w high): Price discovery / momentum leader — very bullish signal, mention in bull case',
    '- mid_range: Normal trading range — neutral',
    '- below_mid: Under pressure, possible recovery play — note in analysis',
    '- near_low: Structural weakness or deep value — mandatory mention in risks/bear case',
    '',
    '## CRITICAL: ANTI-HALLUCINATION RULES',
    'These rules are ABSOLUTE and override everything else:',
    '1. EVERY factual claim MUST be backed by either: (a) a specific field from RAW_DATA below, (b) a specific X Search result you found, or (c) a specific Web Search result with URL.',
    '2. If X Search or Web Search returns NO relevant results for a topic, write "No recent data found" — NEVER invent details, names, dates, or events.',
    '3. NEVER invent: funding round amounts, partnership announcements, exchange listings, protocol upgrades, TVL numbers, price targets, or any specific facts not in the provided data.',
    '4. NEVER invent KOL names, Twitter accounts, or attribute opinions to specific people unless you found them via X Search.',
    '5. If you cannot verify a catalyst or risk with data, prefix it with "[Unverified]" or omit it entirely.',
    '6. For competitor_comparison: ONLY compare metrics that exist in RAW_DATA or that you verified via search. Do not invent TVL, fees, or market cap numbers for competitors.',
    '7. For x_sentiment_summary: If X Search returned nothing meaningful, write "Limited X/Twitter data available for this project." Do NOT fabricate community sentiment.',
    '8. Numbers in your analysis MUST match RAW_DATA but FORMAT THEM FOR HUMANS: $292.6M not 292636115, -2.48% not -2.484401525322113%. Round to 2 decimal places max. Always include $ for USD values.',
    '9. When in doubt, say LESS. A shorter, accurate report is infinitely better than a longer, hallucinated one.',
    '10. NEVER expose internal field names (tvl_change_7d, dex_liquidity_usd, ecosystem.chain_count). Use human labels: "7-day TVL change", "DEX liquidity", "supported chains".',

    '## INSTRUCTIONS',
    '1. Use the attached RAW_DATA and SCORES as your PRIMARY and AUTHORITATIVE data source. These are verified from CoinGecko, DeFiLlama, GitHub, Messari, DexScreener, Reddit, and Etherscan.',
    '2. Use X Search to find RECENT discussion (last 7-30 days). Report ONLY what you actually find. If no results, say so.',
    '3. Use Web Search to check for RECENT news. Report ONLY what you actually find with source URLs. If no results, say so.',
    '4. Synthesize into a coherent thesis, but ONLY use verified information.',
    '5. Clearly separate FACTS (from data) from OPINIONS (your analysis). Your opinions are welcome but must be labeled as such.',
    '6. INTERNAL tracking: for each claim, mentally verify which data source backs it. But do NOT put [source: ...] tags in analysis_text, moat, risks, catalysts, or x_sentiment_summary. Those tags make the output unreadable for humans.',
    '7. Put source references ONLY in the facts_verified array (e.g., "TVL: $414.8M [source: RAW_DATA.onchain.tvl]").',

    '## SCORING CALIBRATION',
    `The algorithmic score is ${overallScore}/10. Use this as a starting point but adjust based on qualitative factors:`,
    '- STRONG BUY (8.5-10): Clear edge — strong fundamentals + positive narrative + upcoming catalyst. High conviction entry.',
    '- BUY (7-8.4): Solid fundamentals, constructive sentiment, risk/reward favorable. Worth accumulating.',
    '- HOLD (5.5-6.9): Mixed signals. Worth watching but no urgent entry. Wait for better setup.',
    '- AVOID (3.5-5.4): Weak fundamentals or negative developments. Better opportunities elsewhere.',
    '- STRONG AVOID (0-3.4): Clear red flags — failing fundamentals, negative catalysts, or active risk events.',

    '## OUTPUT FORMAT',
    'Return ONLY valid JSON. Required fields:',
    '- verdict: "STRONG BUY" | "BUY" | "HOLD" | "AVOID" | "STRONG AVOID"',
    '- project_summary: 1-2 sentences explaining what the project IS, in plain English for an investor seeing it for the first time. Derive from RAW_DATA and verified search results. No hype, no source tags.',
    '- project_category: the project\'s primary category (examples: "DeFi Lending", "Layer 1", "DEX", "NFT Marketplace", "AI Infrastructure", "Meme Token"). Use the most specific category you can support from RAW_DATA and verified search results.',
    '- analysis_text: 3-4 clean paragraphs for HUMAN READERS. Para 1: summary thesis with key metrics. Para 2: on-chain/fundamental evidence. Para 3: market/sentiment context. Para 4: near-term outlook. FORMAT ALL NUMBERS READABLY: use $414.8M not 414828652, use -2.48% not -2.484401525322113%, use $292.6M not 292636115. NO source tags, NO field names like "tvl_change_7d" — write human-readable labels.',
    '- moat: competitive advantage in 1-2 sentences. Must be based on RAW_DATA or verified search results.',
    '- risks: array of 3-5 risk strings. Format: "Risk type: specific detail." Only include risks you can substantiate with data. NO source tags.',
    '- catalysts: array of 2-4 upcoming catalysts. ONLY include catalysts you found via Web/X Search with evidence. Prefix unverified ones with "[Unverified]". It is OK to have fewer catalysts if data is limited.',
    '- competitor_comparison: Compare ONLY with metrics you have data for. If no competitor data available, write "Insufficient data for competitor comparison."',
    '- x_sentiment_summary: Summarize ONLY what X Search actually returned. If nothing relevant found, write "Limited X/Twitter data available."',
    '- key_findings: array of 3-5 key findings. Each MUST reference a specific data point from RAW_DATA or a search result.',
    '- liquidity_assessment: Based on RAW_DATA volume, market cap, and DEX liquidity. Do not invent slippage estimates.',
    '- bull_case: object with { thesis: string (2-3 sentences — the strongest argument FOR investing, with specific numbers from RAW_DATA), catalysts: array of 2-3 specific upcoming catalysts that could drive price up, target_conditions: string (what needs to happen for the bull case to play out), probability: string ("high"/"medium"/"low" — how likely based on current data) }. Base this ONLY on verified data.',
    '- bear_case: object with { thesis: string (2-3 sentences — the strongest argument AGAINST investing, with specific numbers), risks: array of 2-3 specific risks that could drive price down, failure_conditions: string (what would confirm the bear case), probability: string ("high"/"medium"/"low" — how likely based on current data) }. Be brutally honest.',
    '- data_gaps: array of strings listing what data was missing or could not be verified. This helps the reader assess report reliability.',
    '- facts_verified: array of 4-8 strings. ONLY hard facts, each with a [source: ...] tag.',
    '- opinions: array of 2-5 strings. Analytical interpretations; if not directly proven, prefix with [Opinion].',
    '- section_confidence: object with numbers (0-100): { fundamentals, market_sentiment, outlook, overall } based on evidence quality.',

    ...(rawData?.sector_comparison
      ? [
          '## SECTOR CONTEXT',
          'The project has been benchmarked against its sector peers. Use this to calibrate the verdict:',
          JSON.stringify(rawData.sector_comparison, null, 2),
        ]
      : []),

    ...(rawData?.percentiles
      ? [
          '## PERCENTILE CONTEXT',
          'These are the percentile rankings of this project across all historically scanned projects (0 = bottom, 100 = top):',
          JSON.stringify(rawData.percentiles, null, 2),
        ]
      : []),

    ...(Array.isArray(rawData?.red_flags) && rawData.red_flags.length
      ? [
          '## RED FLAGS',
          'The following red flags were algorithmically detected. Weigh these heavily in your risk assessment:',
          rawData.red_flags.map((f) => `- [${f.severity?.toUpperCase() || 'WARNING'}] ${f.flag}: ${f.detail}`).join('\n'),
        ]
      : []),

    ...(Array.isArray(rawData?.alpha_signals) && rawData.alpha_signals.length
      ? [
          '## ALPHA SIGNALS',
          'The following positive alpha signals were algorithmically detected. Factor these into your thesis:',
          rawData.alpha_signals.map((s) => `- [${s.strength?.toUpperCase() || 'MODERATE'}] ${s.signal}: ${s.detail}`).join('\n'),
        ]
      : []),

    ...(scores?.overall?.circuit_breakers?.capped
      ? [
          '## CIRCUIT BREAKERS ACTIVE',
          `The algorithmic score has been CAPPED from ${scores.overall.circuit_breakers.original_score}/10 to ${scores.overall.circuit_breakers.score}/10.`,
          scores.overall.circuit_breakers.breakers.map((b) => `- [${b.severity.toUpperCase()}] Cap at ${b.cap}: ${b.reason}`).join('\n'),
          `Your verdict MUST NOT exceed ${scores.overall.circuit_breakers.applied_cap}/10.`,
          'If circuit breakers are active, explain WHY they are justified, do not argue against them.',
        ]
      : []),

    // Phase 3: category-adaptive weighting context
    ...(scores?.overall?.category
      ? [
          `## TOKEN CATEGORY: ${scores.overall.category} (detected via ${scores.overall.category_source}, confidence ${(scores.overall.category_confidence * 100).toFixed(0)}%)`,
          'Adjust your analysis register for this category. For meme tokens, focus heavily on social dynamics and whale behavior. For DeFi, focus on TVL/fees/revenue fundamentals. For L1/L2, focus on development and ecosystem growth.',
        ]
      : []),

    // Round 16: DEX-specific price context
    ...(rawData?.dex && !rawData.dex.error
      ? [
          '## DEX MARKET DATA',
          `Top DEX: ${rawData.dex.top_dex_name || 'n/a'}`,
          `DEX Price: $${rawData.dex.dex_price_usd || 'n/a'}`,
          `DEX Liquidity: $${rawData.dex.dex_liquidity_usd ? Number(rawData.dex.dex_liquidity_usd).toLocaleString() : 'n/a'}`,
          // Round 238 (AutoResearch): m5 change for ultra-short-term momentum context
          ...(rawData.dex.dex_price_change_m5 != null ? [`DEX 5m change: ${rawData.dex.dex_price_change_m5 > 0 ? '+' : ''}${rawData.dex.dex_price_change_m5}%`] : []),
          `DEX 1h change: ${rawData.dex.dex_price_change_h1 != null ? rawData.dex.dex_price_change_h1 + '%' : 'n/a'}`,
          `DEX 24h change: ${rawData.dex.dex_price_change_h24 != null ? rawData.dex.dex_price_change_h24 + '%' : 'n/a'}`,
          `DEX pair count: ${rawData.dex.dex_pair_count || 'n/a'} pairs across ${(rawData.dex.dex_chains || []).join(', ') || 'n/a'}`,
          // Round 13: buy/sell pressure
          ...(rawData.dex.pressure_signal ? [
            `DEX Buy/Sell pressure: ${rawData.dex.pressure_signal} (ratio: ${rawData.dex.buy_sell_ratio ?? 'n/a'}, buys: ${rawData.dex.buys_24h ?? 'n/a'}, sells: ${rawData.dex.sells_24h ?? 'n/a'})`,
          ] : []),
        ]
      : []),

    // Round 13: price range position context
    ...(rawData?.market?.price_range_position != null
      ? [
          '## PRICE RANGE CONTEXT',
          `Price range position: ${(rawData.market.price_range_position * 100).toFixed(1)}% of ATL→ATH range (0% = ATL, 100% = ATH)`,
          `ATH distance: ${rawData.market.ath_distance_pct != null ? rawData.market.ath_distance_pct.toFixed(1) + '%' : 'n/a'}`,
          `ATL distance: ${rawData.market.atl_distance_pct != null ? '+' + rawData.market.atl_distance_pct.toFixed(1) + '%' : 'n/a'}`,
          ...(rawData?.onchain?.tvl_stickiness ? [`TVL stickiness: ${rawData.onchain.tvl_stickiness}`] : []),
        ]
      : []),

    // Round 25: volume efficiency and P/TVL vs sector
    ...(rawData?.sector_comparison?.volume_efficiency
      ? [
          '## VOLUME & VALUATION EFFICIENCY VS SECTOR',
          `Volume/TVL ratio: ${JSON.stringify(rawData.sector_comparison.volume_efficiency)}`,
          ...(rawData.sector_comparison.price_to_tvl ? [`P/TVL ratio: ${JSON.stringify(rawData.sector_comparison.price_to_tvl)}`] : []),
        ]
      : []),

    // Round 48: price alerts context
    ...(Array.isArray(rawData?.price_alerts) && rawData.price_alerts.length > 0
      ? [
          '## PRICE ALERTS',
          'The following price action events have been detected automatically:',
          rawData.price_alerts.map((a) => `- [${a.severity.toUpperCase()}] ${a.type}: ${a.message}`).join('\n'),
        ]
      : []),

    // Round 28 (AutoResearch batch): narrative momentum context
    ...(rawData?.narrative_momentum?.active_narratives?.length > 0
      ? [
          `## NARRATIVE MOMENTUM (${rawData.narrative_momentum.narrative_alignment.toUpperCase()})`,
          rawData.narrative_momentum.detail,
          `Active macro narratives: ${rawData.narrative_momentum.active_narratives.map((n) => n.replace(/_/g, ' ')).join(', ')}.`,
        ]
      : []),

    // Round 234 (AutoResearch): narrative strength score in prompt
    ...(rawData?.narrative_strength && rawData.narrative_strength.score > 0
      ? [
          `## NARRATIVE STRENGTH SCORE: ${rawData.narrative_strength.score}/100 (${rawData.narrative_strength.strength.toUpperCase()})`,
          rawData.narrative_strength.detail,
          'A higher narrative strength = stronger macro tailwind for this project. Weight this in your thesis and catalysts.',
        ]
      : []),

    // Round 18 (AutoResearch batch): trend reversal signal
    ...(rawData?.trend_reversal && rawData.trend_reversal.pattern !== 'none'
      ? [
          `## TREND REVERSAL SIGNAL: ${rawData.trend_reversal.pattern.toUpperCase()} (${rawData.trend_reversal.confidence} confidence)`,
          rawData.trend_reversal.detail,
          rawData.trend_reversal.signals.length > 0
            ? `Supporting signals: ${rawData.trend_reversal.signals.map((s) => `- ${s}`).join('; ')}`
            : '',
        ].filter(Boolean)
      : []),

    // Round 7 (AutoResearch batch): protocol maturity context
    ...(rawData?.onchain?.protocol_maturity
      ? [
          `## PROTOCOL MATURITY: ${rawData.onchain.protocol_maturity.toUpperCase()}`,
          rawData.onchain.protocol_maturity === 'tier1'
            ? 'This is a top-tier DeFi protocol by TVL and fees. Compare to blue-chip competitors (Uniswap, Aave, Compound-class).'
            : rawData.onchain.protocol_maturity === 'tier2'
              ? 'This is a mid-tier protocol with meaningful but not dominant traction. Compare to established but non-market-leader peers.'
              : rawData.onchain.protocol_maturity === 'tier3'
                ? 'This is a smaller protocol with limited traction. Emerging category or niche play — higher risk.'
                : 'Early-stage protocol. Insufficient TVL/fees data to establish tier. Treat as speculative.',
        ]
      : []),

    // Round 36: volatility regime context
    ...(rawData?.volatility && rawData.volatility.regime !== 'calm'
      ? [
          '## VOLATILITY REGIME',
          `Current volatility regime: ${rawData.volatility.regime.toUpperCase()} (caution multiplier: ${rawData.volatility.caution_multiplier})`,
          `24h price move: ${rawData.volatility.volatility_pct_24h != null ? rawData.volatility.volatility_pct_24h.toFixed(1) + '%' : 'n/a'}`,
          ...(rawData.volatility.notes.length ? rawData.volatility.notes.map((n) => `- ${n}`) : []),
          'NOTE: High volatility regimes require extra caution — reduce position sizing and tighten stops accordingly.',
        ]
      : []),

    // Round 234 (AutoResearch): Supply unlock risk context
    ...(rawData?.tokenomics && !rawData.tokenomics.error && rawData.tokenomics.unlock_overhang_pct != null
      ? [
          '## SUPPLY UNLOCK RISK',
          `Circulating supply: ${rawData.tokenomics.pct_circulating != null ? rawData.tokenomics.pct_circulating.toFixed(1) + '%' : 'n/a'} of total`,
          `Unlock overhang: ${rawData.tokenomics.unlock_overhang_pct != null ? rawData.tokenomics.unlock_overhang_pct.toFixed(1) + '%' : 'n/a'} not yet released`,
          `Dilution risk: ${rawData.tokenomics.dilution_risk || 'n/a'}`,
          ...(rawData.tokenomics.inflation_rate != null
            ? [`Annual inflation rate: ${rawData.tokenomics.inflation_rate.toFixed(1)}%`]
            : []),
          'Factor this into your risk assessment — high unlock overhang means current token holders face significant future dilution.',
        ]
      : []),

    // Round 237 (AutoResearch nightly): Sell wall risk context — surface when distribution pattern detected
    ...(rawData?.dex?.sell_wall_risk && rawData.dex.sell_wall_risk !== 'low'
      ? [
          `## ⚠️ SELL WALL RISK: ${rawData.dex.sell_wall_risk.toUpperCase()}`,
          `DEX data shows coordinated selling pattern: buy/sell ratio ${rawData.dex.buy_sell_ratio ?? 'n/a'}, ` +
          `volume momentum ${rawData.dex.volume_momentum ?? 'n/a'}, top pair concentration ${rawData.dex.top_pair_liquidity_pct != null ? `${rawData.dex.top_pair_liquidity_pct.toFixed(0)}%` : 'n/a'}.`,
          'Factor this into your bear case — active distribution on DEX is a significant near-term risk.',
        ]
      : []),

    // Round 381 (AutoResearch): ATH volatility context — tells LLM whether volatility is constructive or destructive
    ...(rawData?.volatility?.ath_volatility_context
      ? [
          `## ATH VOLATILITY CONTEXT: ${rawData.volatility.ath_volatility_context.toUpperCase()}`,
          rawData.volatility.ath_volatility_context === 'positive_discovery'
            ? 'Elevated volatility is occurring near ATH — this is price discovery phase. Volatility may be constructive (breakout). Weight bull case more heavily.'
            : 'Elevated volatility is occurring far below ATH — may indicate continued structural decline. Weight bear case more heavily and verify any catalyst claim carefully.',
        ]
      : []),

    // Round 235 (AutoResearch): Volume trend context
    ...(rawData?.market?.volume_trend_7d && rawData.market.volume_trend_7d !== 'stable'
      ? [
          `## VOLUME TREND (7d): ${rawData.market.volume_trend_7d.toUpperCase()}`,
          rawData.market.volume_trend_7d === 'increasing'
            ? 'Trading volume has been growing over the past 7 days. This is a constructive signal that can precede price moves.'
            : 'Trading volume has been declining over the past 7 days. This may indicate waning interest or reduced market participation.',
          ...(rawData.market.price_vs_ma7 != null
            ? [`Price vs 7d MA: ${rawData.market.price_vs_ma7.above_ma7 ? '+' : ''}${rawData.market.price_vs_ma7.pct_vs_ma7}% (${rawData.market.price_vs_ma7.above_ma7 ? 'above' : 'below'} 7-day moving average)`]
            : []),
        ]
      : []),

    '## FINAL REMINDER (READ THIS LAST)',
    'Before outputting your response, verify:',
    '1. Every number you cite matches FACT_REGISTRY or RAW_DATA exactly.',
    '2. Source tags go ONLY in facts_verified. Do NOT put [source: ...] in analysis_text, risks, catalysts, key_findings, moat, or any other user-facing field.',
    '3. If you wrote something you cannot trace to data or search results, DELETE IT.',
    '4. "I don\'t have data for this" is ALWAYS better than making something up.',
    '5. Shorter and accurate > longer and fabricated.',

    `PROJECT: ${projectName}`,
    `ALGORITHMIC_SCORES: ${JSON.stringify(scores, null, 2)}`,
    `FACT_REGISTRY: ${JSON.stringify(factRegistry, null, 2)}`,
    `RAW_DATA_SUMMARY:\n${buildDataSummary(rawData)}`,
  ].join('\n\n');
}

export function fallbackReport(projectName, rawData, scores, error = null) {
  const overallScore = Number(scores?.overall?.score || 0);
  const verdict = pickVerdict(overallScore);
  const risks = [];
  const catalysts = [];
  const keyFindings = [];
  const market = rawData?.market ?? {};
  const onchain = rawData?.onchain ?? {};
  const social = rawData?.social ?? {};
  const github = rawData?.github ?? {};

  const price = market.current_price ?? market.price;
  const change24h = market.price_change_pct_24h ?? market.price_change_percentage_24h ?? market.change_24h;
  const change7d = market.price_change_pct_7d ?? market.price_change_percentage_7d_in_currency;
  const mcap = market.market_cap;
  const vol24h = market.total_volume;
  const tvl = onchain.tvl;
  const tvlChange7d = onchain.tvl_change_7d;

  if ((rawData?.tokenomics?.pct_circulating || 0) < 50) {
    risks.push('Circulating supply is still limited: unlock/dilution risk remains.');
  }
  if ((rawData?.onchain?.tvl_change_30d || 0) < 0) {
    risks.push('TVL is contracting on a monthly basis.');
  }
  if ((social.sentiment || 'neutral') === 'bullish') {
    catalysts.push('Social sentiment is constructive and the narrative is active.');
  }
  if ((github.commits_90d || 0) > 30) {
    catalysts.push('Visible software development over the last 90 days.');
  }
  if ((change24h || 0) > 5) {
    catalysts.push('Strong short-term price momentum (+5% in 24h).');
  }
  if ((social.mentions || 0) > 100) {
    catalysts.push('High social mention volume detected.');
  }
  if ((tvlChange7d || 0) > 10) {
    catalysts.push('TVL growing rapidly on a weekly basis (+10%+).');
  }
  if ((vol24h || 0) > (mcap || Infinity) * 0.15) {
    catalysts.push('Volume/market-cap ratio elevated — active trading interest.');
  }
  if ((onchain.fees_7d || 0) > 0 && (onchain.revenue_7d || 0) > 0) {
    catalysts.push('Protocol is generating fees and revenue.');
  }
  if ((change24h || 0) < -10) {
    risks.push('Sharp price decline in 24h — possible negative catalyst.');
  }
  if ((social.sentiment || 'neutral') === 'bearish') {
    risks.push('Social sentiment is bearish.');
  }
  if ((vol24h || 0) < 50000) {
    risks.push('Extremely low trading volume — liquidity risk.');
  }
  if ((mcap || 0) > 0) {
    keyFindings.push(`Observed market cap: ${formatNumber(mcap)}.`);
  }
  if ((tvl || 0) > 0) {
    keyFindings.push(`Observed TVL: ${formatNumber(tvl)}.`);
  }
  if ((social.mentions || 0) > 0) {
    keyFindings.push(`Social mentions: ${social.mentions}.`);
  }
  if (github.commits_90d > 0) {
    keyFindings.push(`GitHub activity: ${github.commits_90d} commits in 90 days, ${github.contributors || 'n/a'} contributors.`);
  }
  if (rawData?.tokenomics?.pct_circulating) {
    keyFindings.push(`Circulating supply: ${rawData.tokenomics.pct_circulating.toFixed(1)}%.`);
  }

  const analysisText = (() => {
    const lines = [
      `${projectName} scores ${overallScore}/10 with a ${verdict} stance in fallback mode.`,
      price != null ? `Price is ${formatNumber(price)}${change24h != null ? `, ${Number(change24h) >= 0 ? '+' : ''}${Number(change24h).toFixed(1)}% over 24h` : ''}${change7d != null ? ` and ${Number(change7d) >= 0 ? '+' : ''}${Number(change7d).toFixed(1)}% over 7d` : ''}.` : null,
      mcap != null ? `Market cap sits at ${formatNumber(mcap)}${vol24h != null ? ` with ${formatNumber(vol24h)} in 24h volume` : ''}.` : null,
      tvl != null ? `TVL is ${formatNumber(tvl)}${tvlChange7d != null ? ` (${Number(tvlChange7d) >= 0 ? '+' : ''}${Number(tvlChange7d).toFixed(1)}% over 7d)` : ''}.` : null,
      `Dimension scores — Market ${scores?.market_strength?.score ?? 'n/a'}/10, Onchain ${scores?.onchain_health?.score ?? 'n/a'}/10, Social ${scores?.social_momentum?.score ?? 'n/a'}/10, Dev ${scores?.development?.score ?? 'n/a'}/10, Tokenomics ${scores?.tokenomics_health?.score ?? 'n/a'}/10, Distribution ${scores?.distribution?.score ?? 'n/a'}/10, Risk ${scores?.risk?.score ?? 'n/a'}/10.`,
      error ? `[Fallback: ${error}]` : null,
    ].filter(Boolean).join(' ');
    return lines;
  })();

  return {
    verdict,
    project_summary: null,
    project_category: null,
    headline: null,
    // Graceful failure: do not invent analysis when LLM failed
    analysis_text: null,
    moat:
      'Requires external qualitative validation; competitive advantage depends on network effects, liquidity, brand, and execution.',
    risks: risks.length ? risks : ['Data coverage is incomplete: further qualitative validation is required.'],
    catalysts: catalysts.length ? catalysts : ['No strong catalyst detected from on-chain data. Use full scan (with AI) for narrative and sentiment analysis.'],
    competitor_comparison:
      'Competitor comparison is unavailable in fallback mode; use category/chains/narrative to build a manual peer set.',
    x_sentiment_summary:
      'X sentiment is unavailable in local fallback mode; Grok X Search is required for qualitative validation.',
    key_findings: keyFindings.length
      ? keyFindings
      : ['Analysis is based only on local collectors and algorithmic scoring.'],
    // Bull/Bear case (algorithmic fallback)
    bull_case: null, // Requires AI analysis — not available in fallback mode
    bear_case: null, // Requires AI analysis — not available in fallback mode
    // Round 5 (AutoResearch nightly): mark as fallback so report-quality.js can flag it
    is_fallback: true,
  };
}

/**
 * Clean report text fields: strip source tags, format raw numbers, humanize field names.
 */
function cleanReportText(text) {
  if (!text || typeof text !== 'string') return text;

  let cleaned = text;

  // 1. Remove [source: ...] tags
  cleaned = cleaned.replace(/\s*\[source:\s*[^\]]*\]/gi, '');

  // 2. Fix overly precise percentages FIRST — e.g., -2.484401525322113% → -2.48%
  // (must run before number formatting to avoid conflicts)
  cleaned = cleaned.replace(/([-+]?\d+\.\d{3,})%/g, (match, numStr) => {
    const num = parseFloat(numStr);
    if (isNaN(num)) return match;
    return `${num.toFixed(2)}%`;
  });

  // 3. Format raw large numbers (7+ digits) with separators; preserve explicit $ if present.
  // Avoid forcing currency on non-USD metrics (e.g., user counts, commits).
  cleaned = cleaned.replace(/\b(\$?)(\d{7,})(?![\d%])/g, (match, dollar, intPart) => {
    const formatted = Number(intPart).toLocaleString('en-US');
    return `${dollar}${formatted}`;
  });

  // 4. Replace snake_case field names with human labels
  const fieldMap = {
    'tvl_change_7d': '7-day TVL change',
    'tvl_change_30d': '30-day TVL change',
    'fees_7d': '7-day fees',
    'fees_30d': '30-day fees',
    'revenue_7d': '7-day revenue',
    'revenue_30d': '30-day revenue',
    'dex_liquidity_usd': 'DEX liquidity',
    'dex_pair_count': 'DEX pair count',
    'dex_price_usd': 'DEX price',
    'buy_sell_ratio': 'buy/sell ratio',
    'market_cap_rank': 'market cap rank',
    'price_change_24h': '24h price change',
    'price_change_7d': '7-day price change',
    'price_change_30d': '30-day price change',
    'current_price': 'current price',
    'market_cap': 'market cap',
    'total_volume': '24h volume',
    'fully_diluted_valuation': 'fully diluted valuation',
    'ecosystem.chain_count': 'supported chains',
    'ecosystem.primary_chain': 'primary chain',
    'github.contributors': 'contributors',
    'github.stars': 'stars',
    'github.commits_90d': 'commits (90d)',
    'top10_concentration_pct': 'top 10 holder concentration',
    'contract.verified': 'contract verified',
  };
  for (const [raw, human] of Object.entries(fieldMap)) {
    // Match with optional dot notation prefix (e.g., "onchain.tvl_change_7d" or just "tvl_change_7d")
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`(?:RAW_DATA[.])?(?:\\w+[.])?${escaped}`, 'g'), human);
  }

  // 5. Remove leftover "RAW_DATA." prefix references
  cleaned = cleaned.replace(/RAW_DATA\.\w+\.\w+/g, (match) => {
    // Extract last part and humanize
    const parts = match.split('.');
    return parts[parts.length - 1].replace(/_/g, ' ');
  });

  // 6. Remove "FACT_REGISTRY" references
  cleaned = cleaned.replace(/\bFACT_REGISTRY\b\s*/gi, '');

  // 7. Clean dangling provenance fragments after source-tag stripping.
  cleaned = cleaned
    .replace(/\bfrom\s*\.(?=[\s,.;:]|$)/gi, '')
    .replace(/\bfrom\s+(RAW_DATA|FACT_REGISTRY|DEX MARKET DATA|VERIFIED DATA)\b[:\s]*/gi, '')
    .replace(/\bfrom\s+(?=[,.;]|$)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1');

  return cleaned.trim();
}

function normalizeReport(payload, projectName, rawData, scores) {
  const overallScore = Number(scores?.overall?.score || 0);
  return {
    verdict: normalizeVerdict(payload?.verdict, overallScore),
    project_summary:
      cleanReportText(String(payload?.project_summary || '').trim()) || null,
    project_category:
      cleanReportText(String(payload?.project_category || '').trim()) || inferProjectCategory(rawData) || null,
    analysis_text:
      cleanReportText(String(payload?.analysis_text || '').trim()) || null,
    moat: cleanReportText(String(payload?.moat || '').trim()) || 'n/a',
    risks: normalizeList(payload?.risks, ['n/a']).map(r => cleanReportText(r)),
    catalysts: normalizeList(payload?.catalysts, ['n/a']).map(c => cleanReportText(c)),
    competitor_comparison: cleanReportText(String(payload?.competitor_comparison || '').trim()) || 'n/a',
    x_sentiment_summary: cleanReportText(String(payload?.x_sentiment_summary || '').trim()) || 'n/a',
    key_findings: normalizeList(payload?.key_findings, ['n/a']).map(f => cleanReportText(f)),
    data_gaps: normalizeList(payload?.data_gaps, []),
    facts_verified: normalizeList(payload?.facts_verified, []),
    opinions: normalizeList(payload?.opinions, []),
    section_confidence: {
      fundamentals: Number(payload?.section_confidence?.fundamentals ?? 50),
      market_sentiment: Number(payload?.section_confidence?.market_sentiment ?? 50),
      outlook: Number(payload?.section_confidence?.outlook ?? 50),
      overall: Number(payload?.section_confidence?.overall ?? 50),
    },
    // Round 7: liquidity assessment
    liquidity_assessment: String(payload?.liquidity_assessment || '').trim() || null,
    // Bull/Bear case analysis
    bull_case: payload?.bull_case ? {
      thesis: cleanReportText(String(payload.bull_case.thesis || '').trim()) || null,
      catalysts: normalizeList(payload.bull_case.catalysts, []).map(c => cleanReportText(c)),
      target_conditions: cleanReportText(String(payload.bull_case.target_conditions || '').trim()) || null,
      probability: String(payload.bull_case.probability || 'medium').toLowerCase(),
    } : null,
    bear_case: payload?.bear_case ? {
      thesis: cleanReportText(String(payload.bear_case.thesis || '').trim()) || null,
      risks: normalizeList(payload.bear_case.risks, []).map(r => cleanReportText(r)),
      failure_conditions: cleanReportText(String(payload.bear_case.failure_conditions || '').trim()) || null,
      probability: String(payload.bear_case.probability || 'medium').toLowerCase(),
    } : null,
    // Round 60: short headline (first sentence of analysis_text) for feed/preview use
    headline: (() => {
      const text = cleanReportText(String(payload?.analysis_text || '').trim());
      if (!text) return null;
      // End headline at a real sentence boundary without cutting decimal prices like $92.48.
      const firstSentence = text.match(/^.*?[.!?](?=\s+[A-Z\[]|$)/)?.[0];
      return firstSentence ? firstSentence.trim() : text.slice(0, 140) + (text.length > 140 ? '...' : '');
    })(),
  };
}

function hasSourceTag(text) {
  return /\[source:\s*[^\]]+\]/i.test(String(text || ''));
}

function clampPct(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Post-LLM validation: cross-check report claims against raw collector data.
 * Flags or sanitizes hallucinated content.
 */
export function validateReport(report, rawData, scores = null) {
  const warnings = [];
  // Round 365: extract overall score for verdict consistency check
  const overallScore = scores?.overall?.score ?? rawData?._scores?.overall?.score ?? 0;

  // 0. Normalize + R176: auto-calibrate section confidence based on data availability
  // If LLM reports very high confidence but key data sources are missing, cap confidence
  const hasOnchain = rawData?.onchain && !rawData.onchain.error && rawData.onchain.tvl != null;
  const hasSocial = rawData?.social && !rawData.social.error && (rawData.social.mentions > 0 || rawData.social.filtered_mentions > 0);
  const hasGithub = rawData?.github && !rawData.github.error && rawData.github.commits_90d > 0;
  const hasMarket = rawData?.market && !rawData.market.error && rawData.market.market_cap != null;

  // Cap fundamentals confidence if onchain data is missing
  const maxFundamentals = hasOnchain ? 90 : hasMarket ? 60 : 35;
  // Cap market_sentiment if no social data
  const maxSentiment = hasSocial ? 90 : 45;
  // Cap outlook if both onchain and social are missing
  const maxOutlook = (hasOnchain || hasSocial) ? 85 : 40;

  const rawFundamentals = clampPct(report?.section_confidence?.fundamentals);
  const rawSentiment = clampPct(report?.section_confidence?.market_sentiment);
  const rawOutlook = clampPct(report?.section_confidence?.outlook);

  report.section_confidence = {
    fundamentals: Math.min(rawFundamentals, maxFundamentals),
    market_sentiment: Math.min(rawSentiment, maxSentiment),
    outlook: Math.min(rawOutlook, maxOutlook),
    overall: clampPct(report?.section_confidence?.overall),
  };
  // Recalculate overall as weighted average if it seems unrealistically high
  const weightedOverall = Math.round(
    report.section_confidence.fundamentals * 0.4 +
    report.section_confidence.market_sentiment * 0.3 +
    report.section_confidence.outlook * 0.3
  );
  if (report.section_confidence.overall > weightedOverall + 20) {
    warnings.push(`section_confidence.overall (${report.section_confidence.overall}) capped to data-weighted estimate (${weightedOverall})`);
    report.section_confidence.overall = weightedOverall;
  }

  if (!Array.isArray(report.facts_verified)) report.facts_verified = [];
  if (!Array.isArray(report.opinions)) report.opinions = [];

  // facts_verified is the ONLY field where [source: ...] tags are expected
  report.facts_verified = report.facts_verified
    .map((f) => String(f || '').trim())
    .filter(Boolean)
    .map((f) => (hasSourceTag(f) ? f : `${f} [source: missing]`));

  // key_findings and risks are user-facing — do NOT add source tags
  report.key_findings = (report.key_findings || []).map((k) => String(k || '').trim()).filter(Boolean);
  report.risks = (report.risks || []).map((r) => String(r || '').trim()).filter(Boolean);

  // 1. Check if x_sentiment_summary seems fabricated (mentions specific accounts but social data is empty)
  const socialData = rawData?.social;
  const hasSocialData = socialData && !socialData.error && (socialData.mentions > 0 || socialData.filtered_mentions > 0);
  if (!hasSocialData && report.x_sentiment_summary && report.x_sentiment_summary !== 'n/a') {
    // If no social collector data AND the summary looks substantive (not a "no data" message)
    const looksSubstantive = report.x_sentiment_summary.length > 80 &&
      !report.x_sentiment_summary.toLowerCase().includes('limited') &&
      !report.x_sentiment_summary.toLowerCase().includes('no data') &&
      !report.x_sentiment_summary.toLowerCase().includes('no recent');
    if (looksSubstantive || /@[a-z0-9_]{2,}/i.test(report.x_sentiment_summary)) {
      warnings.push('x_sentiment_summary may contain unverified claims (no social collector data available)');
      report.x_sentiment_summary = 'Limited X/Twitter data available for this project.';
    }
  }

  // 2. Validate market cap / price numbers in analysis_text against raw data
  // Match "$X market cap" or "market cap of $X" or "market cap: $X" — use only the FIRST dollar value directly adjacent to "market cap"
  const market = rawData?.market;
  if (market && report.analysis_text) {
    const reportedMcap = report.analysis_text.match(/\$([0-9,.]+)\s*(billion|million|B|M)\s+market\s*cap|market\s*cap\s+(?:of\s+|at\s+|:\s+|is\s+)?\$([0-9,.]+)\s*(billion|million|B|M)/i);
    if (reportedMcap && market.market_cap) {
      const rawVal = reportedMcap[1] ?? reportedMcap[3];
      const rawUnit = reportedMcap[2] ?? reportedMcap[4];
      const reportedValue = parseFloat(rawVal.replace(/,/g, ''));
      const unit = rawUnit.toLowerCase();
      const multiplier = (unit === 'billion' || unit === 'b') ? 1e9 : 1e6;
      const reportedActual = reportedValue * multiplier;
      const realMcap = market.market_cap;
      const deviation = Math.abs(reportedActual - realMcap) / realMcap;
      if (deviation > 0.25) {
        warnings.push(`Market cap in analysis ($${reportedValue}${unit}) deviates ${(deviation * 100).toFixed(0)}% from RAW_DATA ($${(realMcap / 1e9).toFixed(2)}B)`);
      }
    }
  }

  // 2b. Validate TVL numbers — match "TVL of $X" or "$X TVL" patterns only (not "TVL and $Y" which is a separate value)
  const onchain = rawData?.onchain;
  if (report.analysis_text) {
    const reportedTvl = report.analysis_text.match(/\$([0-9,.]+)\s*(billion|million|B|M)\s+TVL|TVL\s+(?:of|at|:|stands at|is|totals|reached|hit)?\s*\$([0-9,.]+)\s*(billion|million|B|M)/i);
    if (reportedTvl) {
      const rawVal = reportedTvl[1] ?? reportedTvl[3];
      const rawUnit = reportedTvl[2] ?? reportedTvl[4];
      const reportedValue = parseFloat(rawVal.replace(/,/g, ''));
      const unit = rawUnit.toLowerCase();
      const multiplier = (unit === 'billion' || unit === 'b') ? 1e9 : 1e6;
      const reportedActual = reportedValue * multiplier;

      if (!onchain?.tvl) {
        // LLM invented a TVL when raw data has none — hallucination!
        warnings.push(`TVL ($${reportedValue}${rawUnit}) mentioned but RAW_DATA has no TVL — removing hallucinated TVL`);
        report.analysis_text = report.analysis_text.replace(/[^.]*\$[0-9,.]+\s*(billion|million|B|M)\s+TVL[^.]*\./gi, '').replace(/[^.]*TVL\s+(?:of|at|:|stands at|is|totals|reached|hit)?\s*\$[0-9,.]+\s*(billion|million|B|M)[^.]*\./gi, '').trim();
      } else {
        const realTvl = onchain.tvl;
        const deviation = Math.abs(reportedActual - realTvl) / realTvl;
        if (deviation > 0.25) {
          warnings.push(`TVL in analysis ($${reportedValue}${unit}) deviates ${(deviation * 100).toFixed(0)}% from RAW_DATA ($${(realTvl / 1e9).toFixed(2)}B)`);
        }
      }
    }
  }

  // 2c. Validate circulating supply percentage — catch "0% circulating" when data says otherwise
  if (report.analysis_text) {
    const reportedCirc = report.analysis_text.match(/(\d+(?:\.\d+)?)\s*%\s*circulating/i);
    if (reportedCirc) {
      const reportedPct = parseFloat(reportedCirc[1]);
      const realPct = rawData?.tokenomics?.pct_circulating;
      if (realPct != null && realPct > 0 && Math.abs(reportedPct - realPct) > 15) {
        warnings.push(`Circulating supply in analysis (${reportedPct}%) deviates from RAW_DATA (${realPct.toFixed(1)}%) — correcting`);
        report.analysis_text = report.analysis_text.replace(
          new RegExp(`${reportedPct}\\s*%\\s*circulating`, 'gi'),
          `${realPct.toFixed(1)}% circulating`
        );
      } else if (reportedPct === 0 && (realPct == null || realPct === 0)) {
        // Both null/0 — flag but don't correct
        warnings.push('Circulating supply reported as 0% — data may be unavailable');
      }
    }
  }

  // 3. Check for common hallucination patterns
  const hallucinationPatterns = [
    /partnership with (google|microsoft|apple|amazon|meta)/i,
    /raised \$\d+.*(series [A-Z]|seed|funding)/i,  // funding claims need verification
    /listed on (binance|coinbase|kraken).*recently/i,  // listing claims
    /\$\d+[MBK]\s+(?:market cap|tvl|volume)\s+(?:for|of)\s+(?:uniswap|aave|compound|curve|maker|synthetix|sushi)/i,  // invented competitor numbers
  ];

  if (report.analysis_text) {
    for (const pattern of hallucinationPatterns) {
      const match = report.analysis_text.match(pattern);
      if (match) {
        warnings.push(`Potential unverified claim detected: "${match[0]}"`);
      }
    }
  }

  // 3b. Round R155: Validate competitor_comparison doesn't cite TVL/MCap for competitors when no sector data
  if (report.competitor_comparison && rawData && !rawData.sector_comparison) {
    // If there's no sector_comparison data but the LLM cited specific competitor TVL/mcap numbers, flag it
    const competitorNumbers = report.competitor_comparison.match(/(?:uniswap|aave|compound|maker|curve|sushi|balancer|gmx|dydx|jupiter)[^.]*\$[\d.,]+[MBK]?/gi);
    if (competitorNumbers && competitorNumbers.length > 0) {
      warnings.push(`competitor_comparison cites specific competitor numbers without sector_comparison data — possible hallucination: ${competitorNumbers.slice(0, 2).join('; ')}`);
      // Replace with a safe message rather than deleting entirely
      report.competitor_comparison = 'No sector comparison data available for this scan. Competitor metrics would require additional data collection.';
    }
  }

  // 4. If catalysts reference specific dates/events, flag if not from search
  if (Array.isArray(report.catalysts)) {
    report.catalysts = report.catalysts.map((c) => {
      const item = String(c || '').trim();
      if (!item) return item;
      let out = item;
      // Flag catalysts with very specific dates that might be hallucinated
      if (/Q[1-4]\s*20\d{2}|January|February|March|April|May|June|July|August|September|October|November|December\s+20\d{2}/i.test(out) && !out.includes('[Verified]')) {
        if (!out.startsWith('[')) out = '[Unverified timeline] ' + out;
      }
      // Catalysts are user-facing — do NOT add source tags
      return out;
    });
  }

  // 5. Ensure data_gaps field exists
  if (!report.data_gaps) {
    report.data_gaps = [];
    const collectors = ['market', 'onchain', 'social', 'github', 'tokenomics', 'dex', 'reddit', 'holders', 'ecosystem', 'contract'];
    for (const col of collectors) {
      if (!rawData?.[col] || rawData[col]?.error) {
        report.data_gaps.push(`${col}: data not available`);
      }
    }
  }

  // 6. User-facing text hygiene: remove source tags/snake_case/raw unformatted numbers.
  // Round 379: Also detect generic moat phrases and flag them as warnings
  if (report.moat && typeof report.moat === 'string') {
    const forbiddenMoatPhrases = [
      /\bfirst.?mover advantage\b/i,
      /\bstrong community\b(?! with \d)/i, // allow "strong community with 50K members" but not bare "strong community"
      /\bnetwork effects\b(?! (from|with|of) [\w$])/i, // allow "network effects from 5M users"
      /\brobust ecosystem\b/i,
      /\binnovative (technology|protocol|approach)\b/i,
      /\bunique (approach|technology|solution)\b/i,
    ];
    const foundForbidden = forbiddenMoatPhrases.filter(p => p.test(report.moat));
    if (foundForbidden.length > 0) {
      warnings.push(`moat contains ${foundForbidden.length} generic/unverifiable phrase(s) — may be hallucinated`);
    }
  }

  const userFacingFields = ['analysis_text', 'moat', 'competitor_comparison', 'x_sentiment_summary', 'liquidity_assessment'];
  for (const field of userFacingFields) {
    if (report[field]) report[field] = cleanReportText(report[field]);
    if (hasSourceTag(report[field])) warnings.push(`${field} contains source tag(s)`);
    if (/\b[a-z]+_[a-z0-9_]+\b/.test(String(report[field] || ''))) {
      warnings.push(`${field} contains snake_case field name(s)`);
    }
    if (/\b\d{7,}(?:\.\d+)?\b/.test(String(report[field] || ''))) {
      warnings.push(`${field} may contain unformatted large number(s)`);
    }
  }

  // 6c. Round R159: Detect and remove near-duplicate sentences in analysis_text
  // LLMs sometimes repeat the same fact across multiple paragraphs
  if (report.analysis_text && typeof report.analysis_text === 'string') {
    const sentences = report.analysis_text.match(/[^.!?]+[.!?]+/g) || [];
    const seen = new Set();
    const deduped = [];
    let duplicatesFound = 0;
    for (const s of sentences) {
      // Normalize for comparison: lowercase, strip numbers/punctuation, collapse spaces
      const normalized = s.toLowerCase().replace(/[\d$%,]/g, '').replace(/\s+/g, ' ').trim();
      if (normalized.length < 20) { deduped.push(s); continue; } // too short to dedupe
      if (seen.has(normalized)) {
        duplicatesFound++;
        continue; // skip duplicate sentence
      }
      seen.add(normalized);
      deduped.push(s);
    }
    if (duplicatesFound > 0) {
      warnings.push(`analysis_text had ${duplicatesFound} near-duplicate sentence(s) removed`);
      report.analysis_text = deduped.join('').replace(/\s{2,}/g, ' ').trim();
    }
  }
  // 6b. Validate risks/key_findings for circulating supply hallucination
  const realPctCirc = rawData?.tokenomics?.pct_circulating;
  if (realPctCirc != null && realPctCirc > 0) {
    const fixCircInText = (text) => {
      const m = text.match(/(\d+(?:\.\d+)?)\s*%\s*circulating/i);
      if (m && Math.abs(parseFloat(m[1]) - realPctCirc) > 15) {
        warnings.push(`Risk/finding claims ${m[1]}% circulating but RAW_DATA says ${realPctCirc.toFixed(1)}% — correcting`);
        return text.replace(new RegExp(`${m[1]}\\s*%\\s*circulating`, 'gi'), `${realPctCirc.toFixed(1)}% circulating`);
      }
      return text;
    };
    report.risks = (report.risks || []).map((r) => fixCircInText(r));
    report.key_findings = (report.key_findings || []).map((k) => fixCircInText(k));
  }

  report.risks = (report.risks || []).map((r) => cleanReportText(r));
  report.catalysts = (report.catalysts || []).map((c) => cleanReportText(c));
  report.key_findings = (report.key_findings || []).map((k) => cleanReportText(k));

  // 7. Data sanity: DEX liquidity should not be implausibly above market cap.
  const mcap = Number(rawData?.market?.market_cap || 0);
  const dexLiquidity = Number(rawData?.dex?.dex_liquidity_usd || 0);
  if (mcap > 0 && dexLiquidity > mcap * 10) {
    warnings.push(`DEX liquidity ($${dexLiquidity.toLocaleString('en-US')}) exceeds 10x market cap ($${mcap.toLocaleString('en-US')}) — likely bad data`);
  }

  // 7a. Round 369: Validate github commits in analysis vs RAW_DATA — LLMs often invent commit counts
  const realCommits = rawData?.github?.commits_90d;
  if (realCommits != null && realCommits > 0 && report.analysis_text) {
    // Match commit counts in various time window expressions
    const commitPatterns = [
      /(\d{2,})\s*commits?\s*(?:in|over|per|within|in the last|in the past)?\s*(?:the\s+)?(?:last\s+|past\s+)?(?:90\s*days?|3\s*months?)/i,
      /(\d{2,})\s*commits?\s*(?:in|over)\s*(?:the\s+)?(?:last|past)\s*(?:quarter|90d)/i,
    ];
    for (const pattern of commitPatterns) {
      const commitMatch = report.analysis_text.match(pattern);
      if (commitMatch) {
        const reportedCommits = parseInt(commitMatch[1]);
        if (Math.abs(reportedCommits - realCommits) / realCommits > 0.3) {
          warnings.push(`Commit count in analysis (${reportedCommits}) deviates >30% from RAW_DATA (${realCommits}) — possible hallucination`);
        }
        break; // Only check first match
      }
    }
  }

  // 7b. Round R165: Validate bull/bear case thesis quality — must contain at least one number
  const hasNumber = (text) => /\$[\d.,]+[MBKmb]?|\b\d+[\d.,]*%|\b\d{2,}[\d.,]*\b/.test(String(text || ''));
  if (report.bull_case?.thesis && !hasNumber(report.bull_case.thesis)) {
    warnings.push('bull_case.thesis contains no specific numbers — may be too generic');
    // Append a note to the thesis to prompt more specific language
    report.bull_case.thesis = report.bull_case.thesis + ' [Note: cite specific metrics from the data to strengthen this thesis]';
  }
  if (report.bear_case?.thesis && !hasNumber(report.bear_case.thesis)) {
    warnings.push('bear_case.thesis contains no specific numbers — may be too generic');
    report.bear_case.thesis = report.bear_case.thesis + ' [Note: cite specific metrics from the data to strengthen this thesis]';
  }
  // Validate probability field is valid
  const validProbs = ['high', 'medium', 'low'];
  if (report.bull_case?.probability && !validProbs.includes(String(report.bull_case.probability).toLowerCase())) {
    report.bull_case.probability = 'medium';
  }
  if (report.bear_case?.probability && !validProbs.includes(String(report.bear_case.probability).toLowerCase())) {
    report.bear_case.probability = 'medium';
  }

  // Round 376: key_findings quality — warn if findings lack specific numbers
  if (Array.isArray(report.key_findings) && report.key_findings.length > 0) {
    let findingsWithoutNumbers = 0;
    for (const finding of report.key_findings) {
      if (!hasNumber(finding)) findingsWithoutNumbers++;
    }
    if (findingsWithoutNumbers > 2) {
      warnings.push(`${findingsWithoutNumbers}/${report.key_findings.length} key_findings contain no specific numbers — too generic`);
    }

    // Round 389: Detect duplicate/overlapping key_findings (same metric type mentioned twice)
    const metricKeywords = ['tvl', 'market cap', 'volume', 'commits', 'contributors', 'sentiment', 'fees', 'revenue', 'liquidity'];
    const foundMetrics = new Map();
    for (let i = 0; i < report.key_findings.length; i++) {
      const findingLower = report.key_findings[i].toLowerCase();
      for (const metric of metricKeywords) {
        if (findingLower.includes(metric)) {
          if (foundMetrics.has(metric)) {
            warnings.push(`key_findings has duplicate metric type "${metric}" in findings #${foundMetrics.get(metric)+1} and #${i+1} — consider merging`);
          } else {
            foundMetrics.set(metric, i);
          }
        }
      }
    }
  }

  // Round 365: verdict-score consistency check
  // If algorithmic score is very different from implied verdict, log a warning
  const verdictScoreMap = { 'STRONG BUY': 9, 'BUY': 7.5, 'HOLD': 6, 'AVOID': 4.5, 'STRONG AVOID': 2.5 };
  const impliedScore = verdictScoreMap[report.verdict];
  if (impliedScore != null && overallScore > 0) {
    const scoreDiff = Math.abs(impliedScore - overallScore);
    if (scoreDiff > 2.5) {
      warnings.push(`Verdict "${report.verdict}" (implied score ~${impliedScore}) diverges ${scoreDiff.toFixed(1)} pts from algorithmic score ${overallScore.toFixed(1)} — may be miscalibrated`);
    }
  }

  // Round 383: analysis_text paragraph count check — ensure proper structure
  if (report.analysis_text && typeof report.analysis_text === 'string' && report.analysis_text.length > 100) {
    const paragraphs = report.analysis_text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
    if (paragraphs.length < 2) {
      warnings.push(`analysis_text appears to be a single block (${paragraphs.length} paragraphs detected) — expected 3-4 paragraphs with clear scopes`);
    } else if (paragraphs.length > 6) {
      warnings.push(`analysis_text has ${paragraphs.length} paragraphs — may be fragmented, expect 3-4 focused paragraphs`);
    }
  }

  // Round R171: analysis_text quality assessment
  const analysisLen = String(report.analysis_text || '').length;
  const analysisWords = String(report.analysis_text || '').split(/\s+/).filter(Boolean).length;
  let analysisQuality = 'none';
  if (analysisLen === 0) {
    warnings.push('analysis_text is empty — report is unusable without AI analysis');
  } else if (analysisWords < 50) {
    warnings.push(`analysis_text is very short (${analysisWords} words) — likely incomplete`);
    analysisQuality = 'minimal';
  } else if (analysisWords < 100) {
    analysisQuality = 'brief';
  } else if (analysisWords < 200) {
    analysisQuality = 'adequate';
  } else {
    analysisQuality = 'comprehensive';
  }

  // Attach validation metadata
  report._validation = {
    warnings,
    validated_at: new Date().toISOString(),
    data_sources_available: Object.keys(rawData || {}).filter(k => rawData[k] && !rawData[k]?.error),
    analysis_quality: analysisQuality,
    analysis_word_count: analysisWords,
  };

  if (warnings.length > 0) {
    console.log(`[validate-report] ${warnings.length} warning(s): ${warnings.join('; ')}`);
  }

  return report;
}

/**
 * Request Opus via OpenClaw gateway (OAuth, zero cost).
 * Falls back to direct Anthropic API if gateway unavailable and ANTHROPIC_API_KEY is set.
 */
async function requestAnthropic({ apiKey, model, systemPrompt, userMessage, timeoutMs = OPUS_TIMEOUT_MS }) {
  // Try OpenClaw gateway first (OAuth — free via Claude Max)
  const gatewayToken = OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN;
  if (gatewayToken) {
    try {
      const text = await requestViaGateway({ gatewayToken, systemPrompt, userMessage, timeoutMs });
      if (text && text.length > 10) return text;
    } catch (err) {
      console.error(`[full-llm] Gateway Opus failed: ${err.message}, trying direct API...`);
    }
  }

  // Fallback: direct Anthropic API (costs money — only for production)
  if (!apiKey) throw new Error('No gateway token and no ANTHROPIC_API_KEY available');

  const response = await withTimeout(timeoutMs, (signal) =>
    fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: OPUS_MODEL_DIRECT,
        max_tokens: 4096,
        temperature: 0.1,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: '{' },
        ],
      }),
      signal,
    })
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text || '';
  return '{' + text;
}

/**
 * Request via OpenClaw gateway (OpenAI-compatible chat completions endpoint).
 * Uses OAuth — zero cost with Claude Max subscription.
 */
async function requestViaGateway({ gatewayToken, systemPrompt, userMessage, timeoutMs }) {
  const response = await withTimeout(timeoutMs, (signal) =>
    fetch(OPENCLAW_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gatewayToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPUS_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage + '\n\nRespond with valid JSON only. Start with {' },
        ],
        max_tokens: 4096,
        temperature: 0.1,
      }),
      signal,
    })
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gateway returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || '';
  // Extract JSON from response (may be wrapped in markdown code block)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Gateway response contains no JSON object');
  return jsonMatch[0];
}

/**
 * Builds a split prompt for Opus (no tools — all data pre-collected).
 * Returns { system, user } where system = ROLE + RULES + FORMAT, user = DATA.
 */
export function buildOpusPrompt(projectName, rawData, scores) {
  const overallScore = scores?.overall?.score ?? 0;
  const factRegistry = buildFactRegistry(rawData);

  const system = [
    '## ROLE',
    'You are a senior crypto alpha analyst. Your job: produce actionable, evidence-based reports for sophisticated investors. No fluff, no generic disclaimers.',

    '## CRITICAL: ANTI-HALLUCINATION RULES',
    'These rules are ABSOLUTE and override everything else:',
    '1. EVERY factual claim MUST be backed by a specific field from the provided data (RAW_DATA, X_SOCIAL, or SCORES).',
    '2. If the provided data has NO relevant information for a topic, write "No recent data found" — NEVER invent details, names, dates, or events.',
    '3. NEVER invent: funding round amounts, partnership announcements, exchange listings, protocol upgrades, TVL numbers, price targets, or any specific facts not in the provided data.',
    '4. NEVER invent KOL names, Twitter accounts, or attribute opinions to specific people unless they appear in the X_SOCIAL data provided below.',
    '5. If you cannot verify a catalyst or risk with data, prefix it with "[Unverified]" or omit it entirely.',
    '6. For competitor_comparison: ONLY compare metrics that exist in RAW_DATA. Do not invent TVL, fees, or market cap numbers for competitors.',
    '7. For x_sentiment_summary: Summarize the X_SOCIAL data provided below. If X_SOCIAL is empty or has errors, write "No X/Twitter data available."',
    '8. Numbers in your analysis MUST match RAW_DATA but FORMAT THEM FOR HUMANS: $292.6M not 292636115, -2.48% not -2.484401525322113%. Round to 2 decimal places max. Always include $ for USD values.',
    '9. When in doubt, say LESS. A shorter, accurate report is infinitely better than a longer, hallucinated one.',
    '10. NEVER expose internal field names (tvl_change_7d, dex_liquidity_usd, ecosystem.chain_count). Use human labels: "7-day TVL change", "DEX liquidity", "supported chains".',

    '## INSTRUCTIONS',
    '1. Use the attached RAW_DATA and SCORES as your PRIMARY and AUTHORITATIVE data source. These are verified from CoinGecko, DeFiLlama, GitHub, Messari, DexScreener, Reddit, and Etherscan.',
    '2. Use the X_SOCIAL section below for Twitter/X discussion data (collected by Grok Fast). Report ONLY what is in X_SOCIAL. If no X_SOCIAL data, say so.',
    '3. All data is pre-collected. Do NOT reference tools you don\'t have.',
    '4. Synthesize into a coherent thesis, but ONLY use verified information.',
    '5. Clearly separate FACTS (from data) from OPINIONS (your analysis). Your opinions are welcome but must be labeled as such.',
    '6. INTERNAL tracking: for each claim, mentally verify which data source backs it. But do NOT put [source: ...] tags in analysis_text, moat, risks, catalysts, or x_sentiment_summary. Those tags make the output unreadable for humans.',
    '7. Put source references ONLY in the facts_verified array (e.g., "TVL: $414.8M [source: RAW_DATA.onchain.tvl]").',
    '8. VERDICT CONSISTENCY: your analysis_text, risks, catalysts, bull_case, and bear_case must be CONSISTENT with your verdict. If verdict=HOLD, the bull and bear cases should be roughly balanced. If verdict=BUY, the bull case should be clearly stronger. Inconsistent verdict/narrative = low credibility.',

    '## SCORING CALIBRATION',
    `The algorithmic score is ${overallScore}/10 (data completeness: ${scores?.overall?.completeness ?? 'n/a'}%). Use this as a starting point but adjust based on qualitative factors:`,
    '- STRONG BUY (8.5-10): Clear edge — strong fundamentals + positive narrative + upcoming catalyst. High conviction entry. Requires: 2+ strong alpha signals OR sector-leading metrics.',
    '- BUY (7-8.4): Solid fundamentals, constructive sentiment, risk/reward favorable. Worth accumulating. Requires: no critical red flags.',
    '- HOLD (5.5-6.9): Mixed signals. Worth watching but no urgent entry. Wait for better setup.',
    '- AVOID (3.5-5.4): Weak fundamentals or negative developments. Better opportunities elsewhere.',
    '- STRONG AVOID (0-3.4): Clear red flags — failing fundamentals, negative catalysts, or active risk events.',
    '⚠️ DOWNGRADE: if data completeness < 40%, cap at HOLD. If critical red flags, cap at AVOID. If circuit breakers, follow the cap.',
    '⚠️ UPGRADE: only upgrade above algorithmic score if you found a specific qualitative catalyst in X_SOCIAL or data that the algorithm missed.',

    '## OUTPUT FORMAT',
    'Return ONLY valid JSON. Required fields:',
    '- verdict: "STRONG BUY" | "BUY" | "HOLD" | "AVOID" | "STRONG AVOID"',
    '- project_summary: 2-3 sentences MAX. Sentence 1: MUST name the protocol type, its primary blockchain/chain from ECOSYSTEM data, and core use case (e.g. "X is a lending protocol on Ethereum and Base"). Sentence 2: the single most important traction metric from RAW_DATA — prioritize TVL > fees > MCap rank > GitHub commits (e.g. "$XM TVL growing +Y% weekly" or "ranked #Z by MCap with $XM 24h volume"). Sentence 3 (optional): key differentiator or primary user type. Use only RAW_DATA and X_SOCIAL — no hype, no source tags, no vague claims.',
    '- project_category: the project\'s primary category (examples: "DeFi Lending", "Layer 1", "DEX", "NFT Marketplace", "AI Infrastructure", "Meme Token"). Use the most specific category you can support from RAW_DATA.',
    '- analysis_text: 3-4 clean paragraphs for HUMAN READERS. STRICT PARAGRAPH SCOPES — each paragraph covers EXCLUSIVE territory, NO metric appears in 2 paragraphs:\n  Para 1 [VERDICT + TOP METRICS]: State verdict explicitly. Use the 2-3 highest-signal metrics (usually: overall score, P/TVL or market cap rank, and the single strongest signal — TVL growth OR social spike OR dev velocity). End Para 1 with a one-sentence verdict justification.\n  Para 2 [FUNDAMENTALS DEEP-DIVE]: On-chain numbers ONLY — TVL change, fees, revenue, protocol health, supply metrics. NEVER re-state Para 1 numbers. Add context: compare fees to peers if sector data available, highlight stickiness or growth trajectory.\n  Para 3 [MARKET + SENTIMENT]: Price action (24h/7d/30d), DEX pressure, social signal, volume patterns. NEVER re-state on-chain numbers from Para 2.\n  Para 4 [OUTLOOK]: Near-term risk/reward — what specific data threshold would change the verdict? What\'s the primary catalyst to watch? What\'s the main risk trigger? Be concrete with numbers.\n  FORMAT: $414.8M not 414828652 | -2.48% not -2.484401525322113% | NO source tags | NO snake_case field names.',
    '- moat: competitive advantage in 1-2 sentences. MANDATORY: use EXACTLY ONE evidence-backed moat type with specific numbers from RAW_DATA:\n  → SCALE MOAT (if SECTOR_CONTEXT available): "Leads category by TVL at $X, 2.5x larger than #2 competitor at $Y." Use only when SECTOR_CONTEXT has comparative data.\n  → DEV/TECH MOAT (if github data available): "Active dev team: X contributors, Y commits/week, Z GitHub stars — typical category protocol averages W commits/week." Must use github.contributors, github.commit_frequency or commits_90d.\n  → LIQUIDITY/NETWORK MOAT (if DEX/onchain data available): "$XM deep liquidity across Z chains + Y% revenue capture creates LP switching costs." Must use dex_liquidity_usd and chain_count.\n  → TOKENOMICS MOAT (if circulating supply data available): "Z% circulating supply with only Y% annual inflation gives controlled dilution vs category avg W%." Must use pct_circulating and inflation_rate.\n  ABSOLUTE FORBIDDEN (delete on sight): "first mover advantage", "strong community", "network effects" (without user/TVL numbers), "innovative", "unique", "robust ecosystem".\n  If NO genuine moat exists from data: write EXACTLY "No clear moat identified from available data — competitive position unverifiable without sector comparison."',
    '- risks: array of 3-5 risk strings. Use format: "[SEVERITY] [Risk Type]: [specific detail WITH a number from RAW_DATA]. [concrete price impact if risk materializes]". Severity labels: [CRITICAL] / [HIGH] / [MEDIUM] / [LOW]. Examples: "[HIGH] Dilution: 42% circulating supply means 58% unlocking over 18 months = sustained sell pressure of ~3.2% monthly." | "[CRITICAL] DEX Sell pressure: buy/sell ratio 0.78 over 24h suggests active distribution from large holders." | "[HIGH] TVL Concentration: 73% TVL on single chain creates bridge/exploit single-point-of-failure." ABSOLUTELY FORBIDDEN: "[MEDIUM] Regulatory uncertainty" (no context), "[LOW] Smart contract risk" (no audit data), any risk without a specific number. Risks without numbers = useless. Risks without severity = unranked noise.',
    '- catalysts: array of 2-4 upcoming catalysts. Format: "[Catalyst Type]: [specific observation from data] → [expected price/usage impact]". Examples: "[Protocol upgrade]: Active dev team (Y commits/week) with recent release suggests protocol updates are in pipeline → potential TVL inflow if adopted." | "[Revenue inflection]: Fee efficiency $X/M TVL vs sector average $Y — approaching breakeven threshold that could trigger fee switch discussion." | "[Valuation re-rating]: P/TVL of Z is below sector median W — institutional discovery could drive re-rating." ONLY include catalysts supported by RAW_DATA patterns. Prefix uncertain ones with "[Unverified]". Having 1-2 strong data-backed catalysts > 4 generic ones.',
    '- competitor_comparison: Compare ONLY with metrics you have data for. If no competitor data available, write "Insufficient data for competitor comparison."',
    '- x_sentiment_summary: Summarize the X_SOCIAL data provided below. If X_SOCIAL is empty or has errors, write "No X/Twitter data available."',
    '- key_findings: array of 3-5 key findings. Format: "[Metric]: [value] — [what this means for investors]". Example: "TVL: $45.2M growing +8% weekly — suggests growing protocol adoption." Each MUST cite a specific data point from RAW_DATA or X_SOCIAL.',
    '- liquidity_assessment: Based on RAW_DATA volume, market cap, and DEX liquidity. Do not invent slippage estimates.',
    '- bull_case: object with { thesis: string (2-3 sentences — the STRONGEST argument FOR investing. MANDATORY: cite at least 2 specific numbers from RAW_DATA, e.g. "TVL of $X growing +Y% weekly", "P/TVL of Z is below sector median of W", "fee efficiency $X/M TVL vs sector avg $Y". When SECTOR_CONTEXT is available, MUST compare against it. Explain WHY those numbers are bullish vs benchmarks.), catalysts: array of 2-3 specific events/metrics that could drive price up (data-backed, e.g. "fee efficiency $X/M TVL signals product-market fit"), target_conditions: string (concrete threshold conditions — e.g. "TVL crosses $XM, weekly fees above $Y"), probability: string ("high"/"medium"/"low" with one-sentence justification based on data) }. NEVER use generic phrases like "strong fundamentals" without specific numbers.',
    '- bear_case: object with { thesis: string (2-3 sentences — the STRONGEST argument AGAINST investing. MANDATORY: cite at least 2 specific numbers from RAW_DATA that support the bear thesis. When SECTOR_CONTEXT is available, highlight where this project underperforms peers (e.g. "P/TVL of X is 3x above sector median Y"). Be brutally honest about relative underperformance.), risks: array of 2-3 specific measurable risks (e.g. "DEX sell pressure ratio 0.82 — possible distribution"), failure_conditions: string (concrete conditions that confirm the bear case — e.g. "TVL falls below $XM, price breaks below $Y"), probability: string ("high"/"medium"/"low" with one-sentence justification) }. Do NOT soften bear cases.',
    '- data_gaps: array of strings listing what data was missing or could not be verified. This helps the reader assess report reliability.',
    '- facts_verified: array of 4-8 strings. ONLY hard facts, each with a [source: ...] tag.',
    '- opinions: array of 2-5 strings. Analytical interpretations; if not directly proven, prefix with [Opinion].',
    '- section_confidence: object with numbers (0-100): { fundamentals, market_sentiment, outlook, overall } based on evidence quality.',

    '## FINAL REMINDER (READ THIS LAST)',
    'Before outputting your response, verify:',
    '1. Every number you cite matches FACT_REGISTRY or RAW_DATA exactly.',
    '2. Source tags go ONLY in facts_verified. Do NOT put [source: ...] in analysis_text, risks, catalysts, key_findings, moat, or any other user-facing field.',
    '3. If you wrote something you cannot trace to data, DELETE IT.',
    '4. "I don\'t have data for this" is ALWAYS better than making something up.',
    '5. Shorter and accurate > longer and fabricated.',
    '6. CHECK FOR REPETITION: scan your analysis_text — if the same metric (e.g., TVL, price, fees) appears in more than one paragraph, remove it from the less important paragraph. Each paragraph = unique information.',
    '7. CHECK BULL/BEAR CASES: do they contain at least 2 specific numbers from RAW_DATA? If not, add them or delete the generic claim.',
    '8. CHECK VERDICT: does your narrative actually justify the verdict? If you say HOLD but your evidence is all positive, recalibrate.',
    '9. TOKENOMICS SANITY CHECK: if unlock_risk_label is "critical" or "high", this MUST appear in your bear case risks array and your analysis_text risk paragraph. Do not ignore critical tokenomics red flags.',
    '10. INFLATION AWARENESS: if annual inflation rate > 30%, explicitly address dilution timeline in the bear case. High-yield protocols with high inflation require yield > inflation to be net positive for holders.',
  ].join('\n\n');

  // Round R179: Build composite indexes block from scoring output
  const compositeIndexes = (() => {
    const parts = [];
    const mkt = scores?.market_strength;
    const och = scores?.onchain_health;
    const dev = scores?.development;
    const soc = scores?.social_momentum;
    const risk = scores?.risk;
    if (mkt?.market_efficiency_score != null) parts.push(`Market efficiency index: ${mkt.market_efficiency_score}/100`);
    if (och?.onchain_maturity_score != null) parts.push(`Onchain maturity index: ${och.onchain_maturity_score}/100`);
    if (dev?.dev_quality_index != null) parts.push(`Dev quality index: ${dev.dev_quality_index}/100`);
    if (soc?.social_health_index != null) parts.push(`Social health index: ${soc.social_health_index}/100`);
    if (risk?.liquidity_risk_score != null) parts.push(`Liquidity risk score: ${risk.liquidity_risk_score}/100 (higher=safer)`);
    return parts.length ? `COMPOSITE INDEXES:\n${parts.map(p => `- ${p}`).join('\n')}` : null;
  })();

  const userParts = [
    `PROJECT: ${projectName}`,
    buildScoreSummary(scores),
    compositeIndexes,
    `ALGORITHMIC_SCORES: ${JSON.stringify(scores, null, 2)}`,
    `FACT_REGISTRY: ${JSON.stringify(factRegistry, null, 2)}`,
    `RAW_DATA_SUMMARY:\n${buildDataSummary(rawData)}`,
  ].filter(Boolean);

  if (rawData?.sector_comparison) {
    userParts.push(`SECTOR_CONTEXT:\n${JSON.stringify(rawData.sector_comparison, null, 2)}`);
  }

  // Round 372: narrative strength score context in user message
  if (rawData?.narrative_momentum?.active_narratives?.length > 0) {
    const narrMom = rawData.narrative_momentum;
    const narrParts = [`NARRATIVE_CONTEXT (alignment: ${narrMom.narrative_alignment?.toUpperCase() || 'n/a'}):`];
    if (narrMom.active_narratives?.length) narrParts.push(`- Active narratives: ${narrMom.active_narratives.slice(0, 5).map(n => n.replace(/_/g, ' ')).join(', ')}`);
    if (narrMom.narrative_dominance_score != null) narrParts.push(`- Dominance: ${narrMom.narrative_dominance_score}/100 (higher = stronger macro tailwind)`);
    if (narrMom.narrative_momentum_quality) narrParts.push(`- Trend: ${narrMom.narrative_momentum_quality}`);
    if (narrMom.detail) narrParts.push(`- Summary: ${narrMom.detail}`);
    userParts.push(narrParts.join('\n'));
  }

  if (rawData?.percentiles) {
    userParts.push(`PERCENTILE_CONTEXT:\n${JSON.stringify(rawData.percentiles, null, 2)}`);
  }

  if (Array.isArray(rawData?.red_flags) && rawData.red_flags.length) {
    userParts.push(`RED_FLAGS:\n${rawData.red_flags.map((f) => `- [${f.severity?.toUpperCase() || 'WARNING'}] ${f.flag}: ${f.detail}`).join('\n')}`);
  }

  // Round 385: TEMPORAL_SIGNALS — score momentum direction from historical comparisons
  const tempDelta = rawData?.temporal_delta;
  if (tempDelta && tempDelta.has_history) {
    const tParts = ['TEMPORAL_SIGNALS (how scores changed since last scan):'];
    if (tempDelta.narrative) tParts.push(`- Overall: ${tempDelta.narrative}`);
    if (tempDelta.signals?.length) {
      for (const s of tempDelta.signals.slice(0, 3)) {
        const dir = s.type === 'SCORE_MOMENTUM' ? (s.data_json?.delta > 0 ? '📈' : '📉') : '';
        tParts.push(`- ${dir} ${s.title}: ${s.detail}`);
      }
    }
    tParts.push('→ Use score momentum direction in your catalysts (improving) or risks (declining) assessment.');
    userParts.push(tParts.join('\n'));
  }

  // Round 384: CROSS_DIMENSIONAL_SIGNALS — surface notable divergences and convergences
  const crossDim = rawData?.cross_dimensional;
  if (crossDim && (crossDim.divergences?.length > 0 || crossDim.convergences?.length > 0)) {
    const xdParts = ['CROSS_DIMENSIONAL_SIGNALS (algorithmically detected patterns):'];
    if (crossDim.convergences?.length > 0) {
      xdParts.push('CONVERGENCES (multiple dimensions aligned):');
      for (const c of crossDim.convergences.slice(0, 3)) {
        xdParts.push(`- [BULLISH] ${c.type}: ${c.detail}`);
      }
    }
    if (crossDim.divergences?.length > 0) {
      xdParts.push('DIVERGENCES (conflicting signals):');
      for (const d of crossDim.divergences.slice(0, 3)) {
        xdParts.push(`- [DIVERGENCE] ${d.type}: ${d.detail}`);
      }
    }
    xdParts.push('→ Use these cross-dimensional patterns to strengthen thesis or identify hidden risks.');
    userParts.push(xdParts.join('\n'));
  }

  // Round 380: DATA_COMPLETENESS context — explicit collectors OK/failed for verdict calibration
  if (rawData?.metadata?.collectors) {
    const collectors = rawData.metadata.collectors;
    const okList = Object.entries(collectors).filter(([,v]) => v === true || v?.ok).map(([k]) => k);
    const failList = Object.entries(collectors).filter(([,v]) => v === false || (v && !v?.ok)).map(([k]) => k);
    const completeness = scores?.overall?.completeness ?? rawData?.metadata?.completeness;
    const compParts = [`DATA_COMPLETENESS: ${completeness != null ? completeness + '%' : 'unknown'}`];
    if (okList.length) compParts.push(`- Available collectors: ${okList.join(', ')}`);
    if (failList.length) compParts.push(`- Failed collectors: ${failList.join(', ')}`);
    if (completeness != null && completeness < 40) {
      compParts.push('⚠️ LOW COMPLETENESS: With <40% data coverage, cap your verdict at HOLD. Do not upgrade to BUY/STRONG BUY without unusually strong data-backed justification.');
    }
    userParts.push(compParts.join('\n'));
  }

  if (Array.isArray(rawData?.alpha_signals) && rawData.alpha_signals.length) {
    userParts.push(`ALPHA_SIGNALS:\n${rawData.alpha_signals.map((s) => `- [${s.strength?.toUpperCase() || 'MODERATE'}] ${s.signal}: ${s.detail}`).join('\n')}`);
  }

  // Round 370: TOKENOMICS RISK SUMMARY block — aggregates key dilution/unlock signals for Opus
  const tok = rawData?.tokenomics;
  if (tok && !tok.error) {
    const tokLines = [];
    if (tok.pct_circulating != null) tokLines.push(`- Circulating: ${tok.pct_circulating.toFixed(1)}% of total supply`);
    if (tok.unlock_risk_label) tokLines.push(`- Unlock risk: ${tok.unlock_risk_label.toUpperCase()}${tok.unlock_risk_label === 'critical' ? ' ⚠️ price suppression likely' : ''}`);
    if (tok.inflation_rate != null) tokLines.push(`- Annual inflation: ${tok.inflation_rate.toFixed(1)}%${tok.inflation_rate < 0 ? ' (deflationary 🔥)' : ''}`);
    if (tok.vesting_info?.team_allocation_pct != null) tokLines.push(`- Team allocation: ${tok.vesting_info.team_allocation_pct.toFixed(1)}%${tok.vesting_info.team_allocation_pct > 25 ? ' ⚠️ HIGH' : ''}`);
    if (tok.vesting_info?.vesting_schedule_summary) tokLines.push(`- Vesting: ${tok.vesting_info.vesting_schedule_summary}`);
    if (tok.tokenomics_risk_score != null) tokLines.push(`- Tokenomics risk score: ${tok.tokenomics_risk_score}/100 (higher=safer)`);
    if (tokLines.length) {
      userParts.push(`TOKENOMICS_RISK_SUMMARY:\n${tokLines.join('\n')}`);
    }
  }

  if (scores?.overall?.circuit_breakers?.capped) {
    const cb = scores.overall.circuit_breakers;
    userParts.push([
      `CIRCUIT_BREAKERS_ACTIVE: Score capped from ${cb.original_score}/10 to ${cb.score}/10.`,
      cb.breakers.map((b) => `- [${b.severity.toUpperCase()}] Cap at ${b.cap}: ${b.reason}`).join('\n'),
      `Your verdict MUST NOT exceed ${cb.applied_cap}/10. Explain WHY the circuit breakers are justified.`,
    ].join('\n'));
  }

  // Round 374: LIQUIDITY CONTEXT block — combines DEX, holders, and market cap for position sizing guidance
  const dexD = rawData?.dex;
  const holdD = rawData?.holders;
  const mktD = rawData?.market;
  if ((dexD && !dexD.error) || (holdD && holdD.top10_holder_concentration_pct != null)) {
    const liqLines = ['LIQUIDITY_CONTEXT (for position sizing and exit risk):'];
    if (mktD?.total_volume != null && mktD?.market_cap != null) {
      const velPct = (mktD.total_volume / mktD.market_cap * 100).toFixed(2);
      liqLines.push(`- Volume velocity: ${velPct}% of MCap traded daily (above 5% = good liquidity for most position sizes)`);
    }
    if (dexD?.dex_liquidity_usd != null) {
      const dexLiq = dexD.dex_liquidity_usd;
      const maxPos = dexLiq * 0.01; // 1% of liquidity = max position without significant slippage
      const liqLabel = dexLiq >= 5e6 ? 'can support $50K+ positions' : dexLiq >= 1e6 ? 'can support $10K-$50K positions' : dexLiq >= 100e3 ? 'limited to <$10K positions' : 'micro-cap, use limit orders only';
      liqLines.push(`- DEX liquidity: ${formatNumber(dexD.dex_liquidity_usd)} → ${liqLabel} (1% slippage threshold)`);
    }
    if (holdD?.top10_holder_concentration_pct != null) {
      const concPct = holdD.top10_holder_concentration_pct;
      const concRisk = concPct > 80 ? 'extreme dump risk — whale-controlled' : concPct > 60 ? 'high concentration — monitor whale wallets' : concPct > 40 ? 'moderate concentration' : 'well-distributed';
      liqLines.push(`- Top-10 concentration: ${concPct.toFixed(1)}% (${concRisk})`);
    }
    if (dexD?.sell_wall_risk && dexD.sell_wall_risk !== 'low') {
      liqLines.push(`- ⚠️ Sell wall risk: ${dexD.sell_wall_risk.toUpperCase()} — potential coordinated selling detected`);
    }
    userParts.push(liqLines.join('\n'));
  }

  // Round 368: DEVELOPMENT CONTEXT block — surfaces key github signals for Opus orientation
  const gh = rawData?.github;
  if (gh && !gh.error && gh.commits_90d != null) {
    const devLines = ['DEVELOPMENT_CONTEXT:'];
    devLines.push(`- Commits/week: ${gh.commit_frequency != null ? gh.commit_frequency.toFixed(1) : (gh.commits_90d / 13).toFixed(1)}/wk (90d avg)`);
    if (gh.contributors != null) devLines.push(`- Team size: ${gh.contributors} contributors`);
    if (gh.days_since_last_commit != null) {
      const recencyLabel = gh.days_since_last_commit <= 3 ? 'actively shipping' : gh.days_since_last_commit <= 14 ? 'recent activity' : gh.days_since_last_commit <= 60 ? 'slowing down' : '⚠️ stale repo';
      devLines.push(`- Last commit: ${gh.days_since_last_commit}d ago (${recencyLabel})`);
    }
    if (gh.bus_factor_score != null) {
      const bfLabel = gh.bus_factor_score >= 70 ? 'healthy distribution' : gh.bus_factor_score >= 40 ? 'moderate concentration' : '⚠️ key-person risk';
      devLines.push(`- Bus factor score: ${gh.bus_factor_score}/100 (${bfLabel})`);
    }
    if (gh.contributor_bus_factor) devLines.push(`- Contributor concentration: ${gh.contributor_bus_factor}`);
    if (gh.has_recent_release === true) devLines.push(`- Recent release: yes (active shipping)`);
    if (gh.dev_quality_index != null) devLines.push(`- Dev quality index: ${gh.dev_quality_index}/100`);
    // Round 381 (AutoResearch): velocity tier for quick LLM orientation
    if (gh.github_velocity_tier) {
      const velDesc = { hyperspeed: '2+ commits/day — very active shipping', active: '5-14 commits/wk — steady development', moderate: '1-5 commits/wk — moderate pace', slow: '<1 commit/wk — slow cadence', slowing: 'no commits in 3-6 months — concern', stale: 'no commits in 6+ months — potentially abandoned', inactive: 'no recent commits' };
      devLines.push(`- Development velocity: ${gh.github_velocity_tier} (${velDesc[gh.github_velocity_tier] || gh.github_velocity_tier})`);
    }
    userParts.push(devLines.join('\n'));
  }

  // Round 377: VOLATILITY_CONTEXT block in Opus user message when regime data available
  if (rawData?.volatility && rawData.volatility.regime !== 'calm') {
    const vol = rawData.volatility;
    const volParts = [`VOLATILITY_CONTEXT (regime: ${vol.regime?.toUpperCase() || 'UNKNOWN'}, caution: ${vol.caution_multiplier}x):`];
    if (vol.volatility_pct_24h != null) volParts.push(`- 24h price swing: ${vol.volatility_pct_24h.toFixed(1)}%`);
    if (vol.notes?.length) volParts.push(...vol.notes.map(n => `- ${n}`));
    if (rawData.market?.realized_vol_90d != null) {
      const rv = rawData.market.realized_vol_90d;
      const rvLabel = rv >= 150 ? 'extremely volatile asset' : rv >= 80 ? 'high volatility' : 'moderate volatility';
      volParts.push(`- 90d realized vol: ${rv.toFixed(0)}% annualized (${rvLabel})`);
    }
    volParts.push('→ Reduce position size recommendations accordingly. Widen stop-loss guidance in trade_setup context.');
    userParts.push(volParts.join('\n'));
  }

  // X_SOCIAL data section (collected by Grok Fast collector)
  const xSocial = rawData?.x_social;
  if (xSocial && !xSocial.error) {
    const xLines = ['X_SOCIAL (collected by Grok Fast):'];
    if (xSocial.sentiment) xLines.push(`- Sentiment: ${xSocial.sentiment} (score: ${xSocial.sentiment_score})`);
    if (xSocial.mention_volume) xLines.push(`- Mention volume: ${xSocial.mention_volume}`);
    if (xSocial.key_narratives?.length) xLines.push(`- Key narratives: ${xSocial.key_narratives.join(', ')}`);
    if (xSocial.notable_accounts?.length) xLines.push(`- Notable accounts: ${xSocial.notable_accounts.join(', ')}`);
    if (xSocial.kol_sentiment) xLines.push(`- KOL sentiment: ${xSocial.kol_sentiment}`);
    if (xSocial.summary) xLines.push(`- Summary: ${xSocial.summary}`);
    userParts.push(xLines.join('\n'));
  } else {
    userParts.push('X_SOCIAL: No X/Twitter data collected.');
  }

  return { system, user: userParts.join('\n\n') };
}

async function requestXai({ apiKey, model, input, tools = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const response = await withTimeout(timeoutMs, (signal) =>
    fetch(XAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input,
        tools,
        text: { format: { type: 'json_object' } },
        max_output_tokens: 4000,
        temperature: 0,
      }),
      signal,
    })
  );

  if (!response.ok) {
    throw new Error(`xAI returned ${response.status}`);
  }

  return response.json();
}

export async function generateQuickReport(projectName, rawData, scores, { apiKey: explicitKey } = {}) {
  const apiKey = explicitKey || process.env.XAI_API_KEY;
  if (!apiKey) {
    return fallbackReport(projectName, rawData, scores, 'XAI_API_KEY missing');
  }

  const overallScore = scores?.overall?.score ?? 0;
  const prompt = [
    '## ROLE',
    'You are a senior crypto alpha analyst. Produce a concise but actionable quick-scan report. No tools available — rely ENTIRELY on attached data.',

    '## CRITICAL: ANTI-HALLUCINATION RULES (VIOLATIONS = USELESS REPORT)',
    '1. ZERO TOOLS. You have NO web search, NO X search, NO external data. You ONLY use the RAW_DATA_SUMMARY and SCORES attached below.',
    '2. NEVER invent: facts, numbers, events, partnerships, funding rounds, KOL names/opinions, Twitter handles, token prices, TVL, fees, competitor metrics — if it\'s not in RAW_DATA_SUMMARY, it doesn\'t exist.',
    '3. EVERY claim = specific RAW_DATA field. If you cannot point to the exact field in the attached data, DELETE the claim.',
    '4. MISSING DATA → write "Insufficient data" in that field. DO NOT fill blanks with plausible-sounding info.',
    '5. x_sentiment_summary BANNED unless social.filtered_mentions > 0 AND no social.error in RAW_DATA. If social data is empty → OMIT this field entirely. This is the #1 hallucination vector — DO NOT write about "the community", "X/Twitter users say", or ANY social narrative without verified social data.',
    '6. catalysts: ONLY patterns observable from numeric data (e.g., "commit_frequency 8/wk suggests active development"). NEVER invent: CEX listing dates, partnership names, upgrade version numbers, specific events not mentioned in attached data.',
    '7. competitor_comparison: ONLY write if SECTOR_CONTEXT block exists in attached data. Otherwise write "No sector data available." — do NOT invent competitor TVL, fees, or rankings.',
    '8. bull_case AND bear_case: each MUST cite at least 2 specific numbers from RAW_DATA_SUMMARY. Generic "strong fundamentals" = hallucination. Cite $TVL, %growth, fee efficiency, P/TVL, etc.',
    '9. Shorter accurate report >> longer hallucinated report. When uncertain: omit, don\'t guess.',
    '10. SOURCE TAGS: ONLY in facts_verified. Never in analysis_text, risks, catalysts, moat, key_findings.',
    '11. FORMAT ALL NUMBERS: $414.8M not 414828652, -2.48% not -2.484401525322113%. NEVER expose snake_case field names to users.',

    '## SCORING CALIBRATION',
    `Algorithmic score: ${overallScore}/10. Adjust verdict based on data quality and signal strength:`,
    '- STRONG BUY (8.5-10): Exceptional fundamentals + strong momentum + clear catalyst',
    '- BUY (7-8.4): Solid across most dimensions, favorable risk/reward',
    '- HOLD (5.5-6.9): Mixed or insufficient signals',
    '- AVOID (3.5-5.4): Weak fundamentals or concerning metrics',
    '- STRONG AVOID (0-3.4): Multiple red flags present',

    '## OUTPUT FORMAT',
    'Return ONLY valid JSON with these REQUIRED fields:',
    '- verdict: "STRONG BUY" | "BUY" | "HOLD" | "AVOID" | "STRONG AVOID"',
    '- project_summary: 1-2 sentences explaining what the project IS, using only RAW_DATA. No hype, no source tags.',
    '- project_category: OPTIONAL. The project\'s primary category if it is clear from RAW_DATA. If unclear, OMIT this field entirely.',
    '- analysis_text: 2-3 clean paragraphs for HUMAN READERS. NO repetition across paragraphs — each paragraph covers NEW information. Para 1: verdict + the single most important data signal that drives it. Para 2: 2-3 supporting evidence points (different from Para 1). Para 3: risk/reward and what to watch next. Format numbers readably ($292.6M, -2.48%). No source tags. No snake_case.',
    '- moat: specific competitive advantage (1-2 sentences, avoid generics like "first mover")',
    '- risks: array of 3-5 risks, format: "Risk type: specific detail"',
    '- catalysts: array of 1-3 catalysts ONLY inferable from data (e.g., active dev = likely updates). Do NOT invent events. Prefix uncertain ones with "[Inferred]".',
    '- competitor_comparison: OPTIONAL. Only if sector_comparison data exists in RAW_DATA. If no sector data → OMIT this field entirely (do not write it).',
    '- x_sentiment_summary: OPTIONAL. Summarize ONLY social collector data from RAW_DATA. If social.mentions is 0 or social has error → OMIT this field entirely.',
    '- key_findings: array of 3-5 data-backed insights. Format: "[Metric]: [value] — [what this means for investors]". Example: "TVL: $45.2M growing +8% weekly — capital inflows suggest growing protocol adoption." Each MUST cite a specific number.',
    '- liquidity_assessment: based on volume and market_cap from RAW_DATA only.',
    '- data_gaps: array of strings listing which data sources were missing or had errors.',
    '- facts_verified: array of 3-6 strings with explicit [source: RAW_DATA.<field>] tags.',
    '- opinions: array of 1-3 strings prefixed with [Opinion].',
    '- section_confidence: object with numbers (0-100): { fundamentals, market_sentiment, outlook, overall }.',

    // Round 37: quick report also includes volatility regime
    ...(rawData?.volatility && rawData.volatility.regime !== 'calm'
      ? [
          `## VOLATILITY: ${rawData.volatility.regime.toUpperCase()} — 24h move ${rawData.volatility.volatility_pct_24h != null ? rawData.volatility.volatility_pct_24h.toFixed(1) + '%' : 'n/a'}. Adjust sizing and stops accordingly.`,
        ]
      : []),

    ...(scores?.overall?.circuit_breakers?.capped
      ? [
          '## CIRCUIT BREAKERS ACTIVE',
          `The algorithmic score has been CAPPED from ${scores.overall.circuit_breakers.original_score}/10 to ${scores.overall.circuit_breakers.score}/10.`,
          scores.overall.circuit_breakers.breakers.map((b) => `- [${b.severity.toUpperCase()}] Cap at ${b.cap}: ${b.reason}`).join('\n'),
          `Your verdict MUST NOT exceed ${scores.overall.circuit_breakers.applied_cap}/10.`,
          'If circuit breakers are active, explain WHY they are justified, do not argue against them.',
        ]
      : []),

    // Phase 3 + R154: category-adaptive deep analysis instructions
    ...(scores?.overall?.category
      ? [
          `## TOKEN CATEGORY: ${scores.overall.category} (detected via ${scores.overall.category_source}, confidence ${(scores.overall.category_confidence * 100).toFixed(0)}%)`,
          (() => {
            const cat = scores?.overall?.category || '';
            const catMap = {
              meme_token: 'MEME TOKEN ANALYSIS: Focus on (1) social velocity — is mention volume accelerating or decelerating? (2) whale/holder concentration — top-10 concentration above 60% = squeeze risk; (3) exchange listing breadth; (4) narrative freshness — how long has this meme been running?',
              defi_lending: 'DEFI LENDING ANALYSIS: Focus on (1) utilization rate (TVL vs borrow volume) — above 80% = high yield but liquidation risk; (2) bad debt ratio if available; (3) collateral quality; (4) P/TVL vs Aave/Compound benchmarks (Aave ~0.3x, Compound ~0.4x). Fee efficiency > /M TVL/week = healthy.',
              defi_dex: 'DEX ANALYSIS: Focus on (1) volume/TVL ratio — Uniswap v3 benchmarks at 3-8x daily; (2) fee tier distribution; (3) impermanent loss risk for LPs; (4) real yield (fees - emissions) — negative real yield = mercenary capital risk.',
              layer_1: 'L1 ANALYSIS: Focus on (1) developer activity — commits/contributors vs Ethereum/Solana benchmarks; (2) ecosystem TVL as % of mcap; (3) transaction throughput and fee revenue; (4) validator/node decentralization if data available.',
              layer_2: 'L2 ANALYSIS: Focus on (1) L1 security vs L2 independence tradeoff; (2) sequencer decentralization; (3) TVL migration from L1; (4) fee competitiveness; (5) canonical bridge TVL if available.',
              rwa: 'RWA ANALYSIS: Focus on (1) regulatory compliance signals — is the issuer licensed/regulated? (2) asset backing quality and on-chain proof of reserves; (3) yield source — TradFi yield vs Ponzi mechanics (real yield = sustainable, token emissions = unsustainable); (4) counterparty risk — custodian reputation, audit frequency; (5) benchmark: good RWA protocols generate 4-8% real yield with sub-2% platform fees.',
              depin: 'DePIN ANALYSIS: Focus on (1) network utility metrics — actual service demand (GB delivered, GPU-hours sold, not just token staking); (2) token emission vs network revenue ratio — above 5x emissions/revenue = Ponzi-like; (3) hardware deployment growth rate; (4) break-even node economics — at what token price is running a node profitable?; (5) key risk: DePIN tokens are often just speculation on future demand with no current product-market fit.',
              // Round 364: new category-specific analysis registers
              ai_infrastructure: 'AI INFRASTRUCTURE ANALYSIS: Focus on (1) real API usage vs speculative token demand — revenue/fees from actual compute usage is the key signal; (2) developer adoption rate via GitHub stars/commits; (3) integration count with other protocols; (4) token utility — is the token required for API access or just governance?; (5) benchmark: AI infra tokens with actual revenue > $1M/week signal product-market fit.',
              web3_gaming: 'WEB3 GAMING ANALYSIS: Focus on (1) daily active users (DAU) vs token holders — genuine gameplay vs farming; (2) in-game economy health — are token sinks working to control inflation?; (3) NFT floor price trend as user engagement proxy; (4) studio credibility — prior games shipped, team size; (5) key risk: most web3 games die when token emissions exceed player-generated demand.',
              cross_chain_bridge: 'BRIDGE ANALYSIS: Focus on (1) bridge TVL and volume — total locked value and daily bridge volume signal usage; (2) security track record — any hacks or close calls?; (3) supported chains and market share; (4) security model (optimistic vs ZK vs multisig — ZK is most secure); (5) canonical benchmark: Stargate TVL > $1B = market leader. NOTE: bridges are the highest-exploit-risk category in DeFi.',
              derivatives: 'DERIVATIVES/PERPS ANALYSIS: Focus on (1) open interest vs liquidity — OI should not exceed 5x total liquidity; (2) funding rates — extreme positive = crowded longs, extreme negative = crowded shorts; (3) liquidation depth — how much OI could cascade?; (4) volume/OI ratio — >100% daily turnover = active market; (5) benchmark: dYdX/GMX class protocol handles $500M+ OI sustainably.',
            };
            return catMap[cat] || `Adjust your analysis for this category. Focus on the most relevant fundamentals for ${cat.replace(/_/g, ' ')} projects.`;
          })()
        ]
      : []),

    // Round 59 + R157: Enriched market snapshot with derived efficiency signals
    (() => {
      const m = rawData?.market ?? {};
      const o = rawData?.onchain ?? {};
      const price = m.current_price ?? m.price;
      const mcap = m.market_cap;
      const vol = m.total_volume;
      const tvl = o.tvl;
      const c24h = m.price_change_pct_24h ?? m.price_change_percentage_24h;
      const c7d = m.price_change_pct_7d ?? m.price_change_percentage_7d_in_currency;
      const c30d = m.price_change_percentage_30d_in_currency;
      const athDist = m.ath_distance_pct;
      const parts = ['## MARKET SNAPSHOT (verified data only)'];
      if (price != null) parts.push(`Price: $${Number(price).toLocaleString('en-US', { maximumSignificantDigits: 6 })}`);
      if (mcap != null) {
        const mcapStr = mcap >= 1e9 ? `$${(mcap / 1e9).toFixed(2)}B` : `$${(mcap / 1e6).toFixed(1)}M`;
        parts.push(`MCap: ${mcapStr}${m.market_cap_rank ? ` (#${m.market_cap_rank})` : ''}`);
      }
      if (vol != null && mcap != null) {
        const velPct = (vol / mcap * 100).toFixed(1);
        parts.push(`Vol24h: $${(Number(vol) / 1e6).toFixed(1)}M (${velPct}% velocity)`);
      } else if (vol != null) {
        parts.push(`Vol24h: $${(Number(vol) / 1e6).toFixed(1)}M`);
      }
      if (tvl != null) {
        const tvlStr = tvl >= 1e9 ? `$${(tvl / 1e9).toFixed(2)}B` : `$${(tvl / 1e6).toFixed(1)}M`;
        const ptvl = mcap != null ? ` P/TVL: ${(mcap / tvl).toFixed(2)}x` : '';
        parts.push(`TVL: ${tvlStr}${ptvl}`);
      }
      const changes = [];
      if (c24h != null) changes.push(`24h: ${Number(c24h) >= 0 ? '+' : ''}${Number(c24h).toFixed(1)}%`);
      if (c7d != null) changes.push(`7d: ${Number(c7d) >= 0 ? '+' : ''}${Number(c7d).toFixed(1)}%`);
      if (c30d != null) changes.push(`30d: ${Number(c30d) >= 0 ? '+' : ''}${Number(c30d).toFixed(1)}%`);
      if (changes.length) parts.push(changes.join(' / '));
      if (athDist != null) parts.push(`ATH dist: ${athDist.toFixed(1)}%`);
      // Round 367: add price_momentum_score and unlock_risk_label to quick market snapshot
      if (rawData?.market?.price_momentum_score != null) {
        const pm = rawData.market.price_momentum_score;
        const pmLabel = pm >= 70 ? '🟢 bullish' : pm >= 30 ? '→ neutral' : '🔴 bearish';
        parts.push(`Momentum: ${pm}/100 (${pmLabel})`);
      }
      if (rawData?.tokenomics?.unlock_risk_label && rawData.tokenomics.unlock_risk_label !== 'low') {
        parts.push(`Unlock risk: ⚠️ ${rawData.tokenomics.unlock_risk_label.toUpperCase()}`);
      }
      return parts.length > 1 ? parts.join(' | ') : null;
    })(),

    // Round 375: quick tokenomics risk inline for the fast model
    (() => {
      const tokQ = rawData?.tokenomics;
      if (!tokQ || tokQ.error) return null;
      const parts = ['## TOKENOMICS QUICK VIEW'];
      if (tokQ.pct_circulating != null) parts.push(`Circulating: ${tokQ.pct_circulating.toFixed(1)}%`);
      if (tokQ.unlock_risk_label && tokQ.unlock_risk_label !== 'low') parts.push(`Unlock risk: ${tokQ.unlock_risk_label.toUpperCase()} ⚠️`);
      if (tokQ.inflation_rate != null) parts.push(`Inflation: ${tokQ.inflation_rate.toFixed(1)}%/yr`);
      if (tokQ.vesting_info?.team_allocation_pct != null && tokQ.vesting_info.team_allocation_pct > 20) {
        parts.push(`Team allocation: ${tokQ.vesting_info.team_allocation_pct.toFixed(1)}% ⚠️`);
      }
      return parts.length > 1 ? parts.join(' | ') : null;
    })(),
    // Round 374: LIQUIDITY CONTEXT block for quick report — helps fast model with position sizing context
    (() => {
      const dexQ = rawData?.dex;
      const mktQ = rawData?.market;
      if (!dexQ || dexQ.error || !dexQ.dex_liquidity_usd) return null;
      const liqParts = ['## LIQUIDITY CONTEXT'];
      const liq = dexQ.dex_liquidity_usd;
      const liqLabel = liq >= 5e6 ? 'deep ($50K+ positions viable)' : liq >= 1e6 ? 'good ($10K-$50K positions)' : liq >= 100e3 ? 'moderate (<$10K recommended)' : 'thin (small orders only, high slippage)';
      liqParts.push(`DEX liquidity: ${formatNumber(liq)} → ${liqLabel}`);
      if (mktQ?.total_volume && mktQ?.market_cap) {
        const vel = (mktQ.total_volume / mktQ.market_cap * 100).toFixed(1);
        liqParts.push(`Volume velocity: ${vel}% of MCap traded daily`);
      }
      if (dexQ.buy_sell_ratio != null) {
        const bsLabel = dexQ.buy_sell_ratio >= 1.15 ? '🟢 buy pressure' : dexQ.buy_sell_ratio <= 0.87 ? '🔴 sell pressure' : '→ balanced';
        liqParts.push(`Buy/sell pressure: ${dexQ.buy_sell_ratio.toFixed(2)} (${bsLabel})`);
      }
      return liqParts.join(' | ');
    })(),
    // Round 386: Inline DEVELOPMENT CONTEXT for quick report
    (() => {
      const gh = rawData?.github;
      if (!gh || gh.error || gh.commits_90d == null) return null;
      const freq = gh.commit_frequency ?? (gh.commits_90d / 13);
      const tier = gh.github_velocity_tier ?? (freq >= 14 ? 'hyperspeed' : freq >= 5 ? 'active' : freq >= 1 ? 'moderate' : 'slow');
      const parts = ['## DEV CONTEXT'];
      parts.push(`Commits/wk: ${freq.toFixed(1)} (${tier})`);
      if (gh.contributors != null) parts.push(`Contributors: ${gh.contributors}`);
      if (gh.days_since_last_commit != null) parts.push(`Last commit: ${gh.days_since_last_commit}d ago`);
      if (gh.dev_quality_index != null) parts.push(`Dev quality: ${gh.dev_quality_index}/100`);
      return parts.join(' | ');
    })(),
    `PROJECT: ${projectName}`,
    buildScoreSummary(scores),
    `ALGORITHMIC_SCORES: ${JSON.stringify(scores, null, 2)}`,
    `RAW_DATA_SUMMARY:\n${buildDataSummary(rawData)}`,
  ].filter(Boolean).join('\n\n');

  // Round 26: retry chain — fast model first, then longer timeout, then fallback
  const attempts = [
    { model: FAST_MODEL, timeoutMs: 25000 },
    { model: FAST_MODEL, timeoutMs: 35000 }, // same model, more time
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      const payload = await requestXai({ apiKey, model: attempt.model, input: prompt, tools: [], timeoutMs: attempt.timeoutMs });
      const text = extractOutputText(payload);
      if (!text || text.length < 50) {
        lastError = new Error('Empty response from xAI');
        continue;
      }
      console.log(`[quick-llm] Grok response length: ${text.length}`);
      const parsed = JSON.parse(text);
      const report = validateReport(normalizeReport(parsed, projectName, rawData, scores), rawData, scores);
      console.log(`[quick-llm] x_sentiment: ${report.x_sentiment_summary?.substring(0, 60)}`);
      return report;
    } catch (err) {
      console.error(`[quick-llm] Attempt failed (${attempt.model}/${attempt.timeoutMs}ms): ${err.message}`);
      lastError = err;
      // Don't retry on parse errors — content is corrupt, not transient
      if (err instanceof SyntaxError) break;
    }
  }

  console.error(`[quick-llm] All attempts failed — using fallback`);
  return fallbackReport(
    projectName,
    rawData,
    scores,
    lastError?.name === 'AbortError' ? 'xAI quick timeout' : (lastError?.message ?? 'unknown error')
  );
}

export async function generateReport(projectName, rawData, scores, { apiKey: explicitKey, anthropicKey: explicitAnthropicKey } = {}) {
  // Try Opus via OpenClaw gateway (OAuth, free) or direct API
  const anthropicKey = explicitAnthropicKey || process.env.ANTHROPIC_API_KEY;
  const hasGateway = !!(OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN);
  if (hasGateway || anthropicKey) {
    try {
      const { system, user } = buildOpusPrompt(projectName, rawData, scores);
      const text = await requestAnthropic({
        apiKey: anthropicKey,
        model: OPUS_MODEL,
        systemPrompt: system,
        userMessage: user,
        timeoutMs: OPUS_TIMEOUT_MS,
      });

      if (!text || text.length < 50) throw new Error('Empty Opus response');
      console.log(`[full-llm] Opus response length: ${text.length}`);

      const parsed = JSON.parse(text);
      const report = validateReport(normalizeReport(parsed, projectName, rawData, scores), rawData, scores);
      report._model = OPUS_MODEL;
      return report;
    } catch (err) {
      console.error(`[full-llm] Opus failed: ${err.message}`);
      // Fall through to Grok reasoning as backup
    }
  }

  // Fallback: Grok reasoning (original behavior)
  const xaiKey = explicitKey || process.env.XAI_API_KEY;
  if (!xaiKey) {
    return fallbackReport(projectName, rawData, scores, 'No LLM API key available (ANTHROPIC_API_KEY and XAI_API_KEY both missing)');
  }

  const prompt = buildPrompt(projectName, rawData, scores);
  try {
    const payload = await requestXai({
      apiKey: xaiKey,
      model: REASONING_MODEL,
      input: prompt,
      tools: [{ type: 'web_search' }, { type: 'x_search' }],
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    const text = extractOutputText(payload);
    const report = normalizeReport(JSON.parse(text), projectName, rawData, scores);
    report._model = REASONING_MODEL;
    return validateReport(report, rawData, scores);
  } catch (error) {
    return fallbackReport(
      projectName,
      rawData,
      scores,
      error.name === 'AbortError' ? 'xAI timeout' : error.message
    );
  }
}
