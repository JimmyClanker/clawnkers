function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderList(items = []) {
  if (!Array.isArray(items) || !items.length) return '<li>n/a</li>';
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function renderScoreLine(label, payload) {
  // Round 391 (AutoResearch): score always 1 decimal for consistency; show confidence label
  const rawScore = payload?.score;
  const scoreFmt = rawScore != null ? `${Number(rawScore).toFixed(1)}/10` : 'n/a';
  const reasoning = payload?.reasoning || 'n/a';
  const conf = payload?.confidence_label ?? (payload?.confidence != null ? `${payload.confidence}%` : null);
  const confStr = conf != null ? ` [${conf}]` : '';
  return `${label}: ${scoreFmt}${confStr} — ${reasoning}`;
}

function fmtNumber(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'n/a';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(decimals)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(decimals)}K`;
  return `$${n.toFixed(decimals)}`;
}

function fmtPct(value, decimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return `${n > 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

// Round 392 (AutoResearch): fmtPlain — format plain numbers (no $ prefix) for counts, ratios, commits
function fmtPlain(value, decimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'n/a';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(decimals)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(decimals);
}

// Round 26: format trade setup for text reports
function renderTradeSetup(tradeSetup) {
  if (!tradeSetup || !tradeSetup.entry_zone) return null;
  const ts = tradeSetup;
  const lines = [
    `Entry zone: $${ts.entry_zone.low} – $${ts.entry_zone.high}`,
    `Stop loss: $${ts.stop_loss ?? 'n/a'}`,
    `TP1: $${ts.take_profit_targets?.[0]?.price ?? 'n/a'} (+${ts.take_profit_targets?.[0]?.pct_gain ?? '?'}%)`,
    `TP2: $${ts.take_profit_targets?.[1]?.price ?? 'n/a'} (+${ts.take_profit_targets?.[1]?.pct_gain ?? '?'}%)`,
    `R/R: ${ts.risk_reward_ratio ?? 'n/a'} | Quality: ${ts.setup_quality ?? 'n/a'}`,
  ];
  return lines.join(' | ');
}

function verdictColor(verdict) {
  switch ((verdict || '').toUpperCase()) {
    case 'STRONG BUY': return '#22c55e';
    case 'BUY':        return '#86efac';
    case 'HOLD':       return '#fbbf24';
    case 'AVOID':      return '#f87171';
    case 'STRONG AVOID': return '#ef4444';
    default:           return '#e8e8e8';
  }
}

function volatileRegimeBadge(volatility) {
  if (!volatility || volatility.regime === 'calm') return '';
  const colors = { elevated: '#fbbf24', high: '#f97316', extreme: '#ef4444' };
  const color = colors[volatility.regime] || '#fbbf24';
  const pct = volatility.volatility_pct_24h != null ? ` (${volatility.volatility_pct_24h.toFixed(1)}% 24h)` : '';
  return `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${color};color:#000;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-left:8px;">⚡ ${volatility.regime}${pct}</span>`;
}

function scoreColor(s) {
  const v = Number(s?.score ?? 0);
  if (v >= 7.5) return '#22c55e';
  if (v >= 6) return '#a8e6cf';
  if (v >= 4) return '#fbbf24';
  return '#f87171';
}

function extractKeyMetrics(rawData, scores) {
  const market = rawData?.market ?? {};
  const onchain = rawData?.onchain ?? {};
  const dex = rawData?.dex ?? {};

  const price = Number(market.current_price ?? market.price ?? 0);
  const marketCap = Number(market.market_cap ?? 0);
  const tvl = Number(onchain.tvl ?? 0);
  const volume24h = Number(market.total_volume ?? market.volume_24h ?? 0);
  const overallScore = Number(scores?.overall?.score ?? 0);
  const priceChange24h = market.price_change_percentage_24h != null ? Number(market.price_change_percentage_24h) : null;
  const priceChange7d = market.price_change_percentage_7d != null ? Number(market.price_change_percentage_7d) : null;

  // Round 8: DEX pressure + TVL stickiness context
  const dexPressure = dex.pressure_signal ?? null;
  const dexBuySellRatio = dex.buy_sell_ratio ?? null;
  const tvlStickiness = onchain.tvl_stickiness ?? null;

  // Round 234 (AutoResearch): FDV overhang + volume trend context for key metrics
  const tokenomics = rawData?.tokenomics ?? {};
  const fdv = Number(market.fully_diluted_valuation ?? 0);
  const mcapForFdv = Number(market.market_cap ?? 0);
  const fdvMcapRatio = mcapForFdv > 0 && fdv > mcapForFdv ? fdv / mcapForFdv : null;
  const volumeTrend7d = market.volume_trend_7d ?? null;
  const priceVsMa7 = market.price_vs_ma7 ?? null;
  const feeRevenueAccel = onchain.fee_revenue_acceleration ?? null;
  const dailyFeeRateAnnualized = onchain.daily_fee_rate_annualized ?? null;
  const pctCirculating = tokenomics.pct_circulating ?? null;
  const liquidityDepthScore = dex.liquidity_depth_score ?? null;

  return {
    price: price > 0 ? price : null,
    market_cap: marketCap > 0 ? marketCap : null,
    tvl: tvl > 0 ? tvl : null,
    volume_24h: volume24h > 0 ? volume24h : null,
    overall_score: overallScore,
    price_change_24h: priceChange24h,
    price_change_7d: priceChange7d,
    price_fmt: price > 0 ? fmtNumber(price, price < 0.01 ? 6 : price < 1 ? 4 : 2) : 'n/a',
    market_cap_fmt: marketCap > 0 ? fmtNumber(marketCap) : 'n/a',
    tvl_fmt: tvl > 0 ? fmtNumber(tvl) : 'n/a',
    volume_24h_fmt: volume24h > 0 ? fmtNumber(volume24h) : 'n/a',
    overall_score_fmt: `${overallScore.toFixed(1)}/10`,
    price_change_24h_fmt: priceChange24h != null ? fmtPct(priceChange24h) : 'n/a',
    price_change_7d_fmt: priceChange7d != null ? fmtPct(priceChange7d) : 'n/a',
    dex_pressure: dexPressure,
    dex_buy_sell_ratio: dexBuySellRatio,
    tvl_stickiness: tvlStickiness,
    // Round 234 additions
    fdv_mcap_ratio: fdvMcapRatio != null ? parseFloat(fdvMcapRatio.toFixed(2)) : null,
    fdv_fmt: fdv > 0 ? fmtNumber(fdv) : 'n/a',
    volume_trend_7d: volumeTrend7d,
    price_vs_ma7: priceVsMa7,
    fee_revenue_acceleration: feeRevenueAccel,
    daily_fee_rate_annualized: dailyFeeRateAnnualized,
    pct_circulating: pctCirculating,
    pct_circulating_fmt: pctCirculating != null ? `${pctCirculating.toFixed(1)}%` : 'n/a',
    liquidity_depth_score: liquidityDepthScore,
    // Round 236 (AutoResearch): 52-week range context for key metrics display
    price_vs_52w: market.price_vs_52w ?? null,
    price_vs_52w_fmt: (() => {
      const v = market.price_vs_52w;
      if (!v) return 'n/a';
      const direction = v.pct_from_52w_high >= 0 ? 'at' : `${Math.abs(v.pct_from_52w_high).toFixed(1)}% below`;
      return `${direction} 52w high ($${v.high_52w})`;
    })(),
    // Round 381 (AutoResearch): ATH distance context for key metrics display
    ath_distance_pct: market.ath_distance_pct ?? null,
    ath_distance_fmt: (() => {
      const d = market.ath_distance_pct;
      if (d == null) return 'n/a';
      return `${d.toFixed(1)}% from ATH`;
    })(),
    // Round 381 (AutoResearch): days_since_ath — LLM-legible recency signal
    days_since_ath: market.days_since_ath ?? null,
    days_since_ath_fmt: (() => {
      const d = market.days_since_ath;
      if (d == null) return 'n/a';
      if (d <= 30) return `ATH set ${d}d ago (recent)`;
      if (d <= 90) return `ATH set ${d}d ago (near)`;
      if (d <= 365) return `ATH set ${Math.round(d / 30)}mo ago`;
      return `ATH set ${(d / 365).toFixed(1)}yr ago`;
    })(),
    // Round 381 (AutoResearch): market_cap_to_volume_ratio — valuation efficiency signal
    market_cap_to_volume_ratio: market.market_cap_to_volume_ratio ?? null,
    // Round 382 (AutoResearch): DEX data quality signals for report consumers
    wash_trading_risk: dex.wash_trading_risk ?? null,
    median_trade_size_usd: dex.median_trade_size_usd ?? null,
    median_trade_size_fmt: (() => {
      const v = dex.median_trade_size_usd;
      if (v == null) return 'n/a';
      if (v >= 10000) return `$${(v / 1000).toFixed(1)}K (whale)`;
      if (v >= 500) return `$${v.toFixed(0)} (institutional/mid retail)`;
      if (v >= 50) return `$${v.toFixed(0)} (retail organic)`;
      return `$${v.toFixed(2)} (micro/bot risk)`;
    })(),
    // Round 382 (AutoResearch): article quality score for social signal reliability
    avg_article_quality_score: rawData?.social?.avg_article_quality_score ?? null,
    article_quality_fmt: (() => {
      const q = rawData?.social?.avg_article_quality_score;
      if (q == null) return 'n/a';
      if (q >= 1.4) return `${q.toFixed(2)}x (tier-1 dominated)`;
      if (q >= 1.2) return `${q.toFixed(2)}x (above average)`;
      if (q >= 0.9) return `${q.toFixed(2)}x (average)`;
      return `${q.toFixed(2)}x (low quality)`;
    })(),
  };
}

export function formatReport(projectName, rawData, scores, llmAnalysis) {
  const collectors = rawData?.metadata?.collectors || {};
  const failedCollectors = Object.entries(collectors)
    .filter(([, payload]) => payload?.ok === false || payload?.error)
    .map(([name, payload]) => `${name}: ${payload?.error || 'unknown error'}`);

  const keyMetrics = extractKeyMetrics(rawData, scores);

    // Round 44 (AutoResearch): build structured data quality summary for MCP consumers
  const collectorMeta = rawData?.metadata?.collectors ?? {};
  const totalCollectors = Object.keys(collectorMeta).length;
  const okCollectors = Object.values(collectorMeta).filter((c) => c?.ok !== false && !c?.error).length;
  const dataQualitySummary = {
    total_collectors: totalCollectors,
    ok_collectors: okCollectors,
    failed_collectors: failedCollectors.length,
    coverage_pct: totalCollectors > 0 ? Math.round((okCollectors / totalCollectors) * 100) : null,
    completeness_pct: scores?.overall?.completeness ?? null,
    overall_confidence: scores?.overall?.overall_confidence ?? null,
    data_freshness_score: rawData?.report_quality?.data_freshness_score ?? null,
    quality_tier: (() => {
      const cov = totalCollectors > 0 ? okCollectors / totalCollectors : 0;
      if (cov >= 0.8 && (scores?.overall?.completeness ?? 0) >= 70) return 'high';
      if (cov >= 0.5 && (scores?.overall?.completeness ?? 0) >= 40) return 'medium';
      return 'low';
    })(),
    // Round 238 (AutoResearch): surface which specific collectors failed for better diagnostics
    failed_collector_names: failedCollectors.slice(0, 5), // max 5 for brevity
    slow_collectors: (() => {
      const SLOW_MS = 8000;
      return Object.entries(collectorMeta)
        .filter(([, c]) => c?.latency_ms != null && c.latency_ms > SLOW_MS)
        .map(([name, c]) => ({ name, latency_ms: c.latency_ms }))
        .sort((a, b) => b.latency_ms - a.latency_ms)
        .slice(0, 3);
    })(),
  };

const json = {
    project_name: projectName,
    generated_at: new Date().toISOString(),
    engine_version: 'r63-2026-03-27', // bump: 30-round AutoResearch Prompt Engineering batch (R361-390)
    verdict: llmAnalysis?.verdict || 'HOLD',
    headline: llmAnalysis?.headline ?? null,
    project_summary: llmAnalysis?.project_summary ?? null,
    project_category: llmAnalysis?.project_category ?? rawData?.onchain?.category ?? null,
    // Round 46 (AutoResearch): surface category detection metadata for transparency
    category_detection: rawData?.category_weights
      ? {
          category: rawData.category_weights.category,
          source: rawData.category_weights.source,
          confidence: rawData.category_weights.confidence,
          confidence_label: rawData.category_weights.confidence >= 0.8 ? 'high' : rawData.category_weights.confidence >= 0.5 ? 'medium' : 'low',
        }
      : null,
    // Round 52 (AutoResearch): composite_alpha_index — 0-100 normalized overall opportunity score
    // Combines: overall score (50%), signal count (15%), quality tier (20%), thesis conviction (15%)
    composite_alpha_index: (() => {
      const overallScore = scores?.overall?.score ?? 5;
      const alphaSignalCount = Math.min(Array.isArray(rawData?.alpha_signals) ? rawData.alpha_signals.length : 0, 5);
      const qualityTier = dataQualitySummary.quality_tier;
      const qualityBonus = qualityTier === 'high' ? 20 : qualityTier === 'medium' ? 10 : 0;
      const convictionScore = rawData?.thesis?.conviction_score ?? 50;
      return Math.round(
        (overallScore / 10) * 50 +        // normalized score (0-50)
        alphaSignalCount * 3 +            // alpha signals (0-15)
        qualityBonus +                    // data quality (0-20)
        (convictionScore / 100) * 15      // thesis conviction (0-15)
      );
    })(),
    score: scores?.overall?.score ?? null,
    validation_warnings: llmAnalysis?._validation?.warnings ?? [],
    data_quality: dataQualitySummary,
    // Round 54 (AutoResearch): red_flags_summary — compact risk overview for MCP consumers
    red_flags_summary: (() => {
      const flags = Array.isArray(rawData?.red_flags) ? rawData.red_flags : [];
      const critical = flags.filter((f) => f.severity === 'critical');
      const warnings = flags.filter((f) => f.severity === 'warning');
      const infos = flags.filter((f) => f.severity === 'info');
      const worst = critical[0] ?? warnings[0] ?? infos[0] ?? null;
      return {
        total: flags.length,
        critical: critical.length,
        warnings: warnings.length,
        info: infos.length,
        worst_flag: worst ? { flag: worst.flag, severity: worst.severity } : null,
        risk_level: critical.length >= 2 ? 'critical' : critical.length >= 1 ? 'high' : warnings.length >= 3 ? 'elevated' : warnings.length >= 1 ? 'moderate' : 'low',
      };
    })(),
    key_metrics: keyMetrics,
    scores,
    formatted_scores: ['market_strength','onchain_health','social_momentum','development','tokenomics_health','distribution','risk','overall'].map(dim => ({
      dimension: dim,
      score: scores?.[dim]?.score ?? null,
      score_fmt: scores?.[dim]?.score != null ? `${Number(scores[dim].score).toFixed(1)}/10` : 'n/a',
      confidence: scores?.[dim]?.confidence ?? null,
      confidence_label: scores?.[dim]?.confidence_label ?? null,
    })),
    llm_analysis: llmAnalysis,
    raw_data: rawData,
  };

  // Round 393 (AutoResearch): headline + project_summary in header; alpha index + conviction side-by-side
  const convictionStr = rawData?.conviction ? ` | Conviction: ${rawData.conviction.score}/100 (${rawData.conviction.label})` : '';
  const alphaIndexStr = json.composite_alpha_index != null ? ` | Alpha Index: ${json.composite_alpha_index}/100` : '';
  const text = [
    `🧠 Alpha Scanner Report — ${projectName}`,
    `📌 Verdict: ${json.verdict}${alphaIndexStr}${convictionStr}`,
    ...(llmAnalysis?.headline ? [`📰 ${llmAnalysis.headline}`] : []),
    ...(json.project_summary ? [`💬 ${json.project_summary}`] : []),
    `🕒 Generated: ${json.generated_at}`,
    `📡 Data: ${json.data_quality.quality_tier} quality | ${json.data_quality.coverage_pct ?? 'n/a'}% coverage | ${json.data_quality.completeness_pct ?? 'n/a'}% completeness${failedCollectors.length ? ` | ⚠️ ${failedCollectors.length} collector(s) failed` : ''}`,
    '',
    '💎 Key Metrics',
    `- Price: ${keyMetrics.price_fmt}`,
    ...(keyMetrics.price_change_24h != null ? [`- 24h Change: ${keyMetrics.price_change_24h_fmt}`] : []),
    ...(keyMetrics.price_change_7d != null ? [`- 7d Change: ${keyMetrics.price_change_7d_fmt}`] : []),
    `- Market Cap: ${keyMetrics.market_cap_fmt}`,
    `- TVL: ${keyMetrics.tvl_fmt}`,
    `- 24h Volume: ${keyMetrics.volume_24h_fmt}`,
    `- Overall Score: ${keyMetrics.overall_score_fmt}`,
    // conviction shown in header line (R393); skip redundant line here
    ...(keyMetrics.dex_pressure ? [`- DEX Pressure: ${keyMetrics.dex_pressure} (ratio: ${keyMetrics.dex_buy_sell_ratio ?? 'n/a'})`] : []),
    ...(rawData?.dex?.sell_wall_risk && rawData.dex.sell_wall_risk !== 'low' ? [`- ⚠️ Sell Wall Risk: ${rawData.dex.sell_wall_risk.toUpperCase()}`] : []),
    ...(rawData?.market?.holder_engagement_score != null ? [`- Holder Engagement: ${rawData.market.holder_engagement_score}/100`] : []),
    ...(keyMetrics.tvl_stickiness ? [`- TVL Stickiness: ${keyMetrics.tvl_stickiness}`] : []),
    // Round 13 (AutoResearch batch): protocol maturity + DEX liquidity depth
    ...(rawData?.onchain?.protocol_maturity ? [`- Protocol Maturity: ${rawData.onchain.protocol_maturity}`] : []),
    ...(rawData?.dex?.liquidity_category ? [`- DEX Liquidity: ${rawData.dex.liquidity_category} (${ rawData?.dex?.dex_liquidity_usd ? fmtNumber(rawData.dex.dex_liquidity_usd) : 'n/a' })`] : []),
    // Round 238 (AutoResearch): DEX ultra-short-term momentum in key metrics text
    ...(rawData?.dex?.dex_price_change_m5 != null ? [`- DEX 5m Price Change: ${rawData.dex.dex_price_change_m5 > 0 ? '+' : ''}${rawData.dex.dex_price_change_m5.toFixed(2)}%`] : []),
    ...(rawData?.social?.airdrop_mentions > 0 ? [`- 🪂 Airdrop Mentions: ${rawData.social.airdrop_mentions} articles`] : []),
    ...(rawData?.social?.hack_exploit_mentions > 0 ? [`- 🚨 Hack/Exploit Mentions: ${rawData.social.hack_exploit_mentions} ⚠️`] : []),
    // Round 394 (AutoResearch): FDV/mcap ratio + circulating supply % in key metrics text
    ...(keyMetrics.fdv_mcap_ratio != null && keyMetrics.fdv_mcap_ratio > 1 ? [`- FDV/MCap: ${keyMetrics.fdv_mcap_ratio.toFixed(2)}x (FDV: ${keyMetrics.fdv_fmt})`] : []),
    ...(keyMetrics.pct_circulating != null ? [`- Circulating Supply: ${keyMetrics.pct_circulating_fmt}`] : []),
    ...(keyMetrics.ath_distance_fmt !== 'n/a' ? [`- ATH: ${keyMetrics.ath_distance_fmt}${keyMetrics.days_since_ath_fmt !== 'n/a' ? ` — ${keyMetrics.days_since_ath_fmt}` : ''}`] : []),
    '',
    '📊 Scores',
    `- ${renderScoreLine('Market strength', scores?.market_strength)}`,
    `- ${renderScoreLine('Onchain health', scores?.onchain_health)}`,
    `- ${renderScoreLine('Social momentum', scores?.social_momentum)}`,
    `- ${renderScoreLine('Development', scores?.development)}`,
    `- ${renderScoreLine('Tokenomics health', scores?.tokenomics_health)}`,
    `- ${renderScoreLine('Distribution', scores?.distribution)}`,
    `- ${renderScoreLine('Risk', scores?.risk)}`,
    `- ${renderScoreLine('Overall', scores?.overall)}`,
    '',
    '🛡️ Moat',
    llmAnalysis?.moat || 'n/a',
    '',
    '⚠️ Risks',
    ...(llmAnalysis?.risks?.length ? llmAnalysis.risks.map((item) => `- ${item}`) : ['- n/a']),
    '',
    '🚀 Catalysts',
    ...(llmAnalysis?.catalysts?.length ? llmAnalysis.catalysts.map((item) => `- ${item}`) : ['- n/a']),
    '',
    `🚨 Risk flags: ${json.red_flags_summary.total} total (${json.red_flags_summary.critical} critical, ${json.red_flags_summary.warnings} warnings) — risk level: ${json.red_flags_summary.risk_level}`,
    '',
    '🐦 X sentiment',
    llmAnalysis?.x_sentiment_summary || 'n/a',
    // Round 35 (AutoResearch): Surface raw x_social KOL data when available
    ...(rawData?.x_social && !rawData.x_social.error && rawData.x_social.notable_accounts?.length
      ? [`- KOLs: ${rawData.x_social.notable_accounts.slice(0, 4).map((a) => `@${a}`).join(', ')} (${rawData.x_social.kol_sentiment || 'n/a'})`]
      : []),
    ...(rawData?.x_social && !rawData.x_social.error && rawData.x_social.key_narratives?.length
      ? [`- Narratives: ${rawData.x_social.key_narratives.slice(0, 3).join('; ')}`]
      : []),
    '',
    `🔎 Key findings (${llmAnalysis?.key_findings?.length ?? 0})`,
    ...(llmAnalysis?.key_findings?.length ? llmAnalysis.key_findings.map((item) => `- ${item}`) : ['- n/a']),
    ...(Array.isArray(rawData?.alpha_signals) && rawData.alpha_signals.length
      ? ['', `🔍 Alpha signals (${rawData.alpha_signals.length})`, ...rawData.alpha_signals.slice(0,5).map(s => `- [${s.strength || '?'}] ${s.signal}: ${s.detail || ''}`)]
      : []),
    // Round 234 (AutoResearch): Narrative strength section in text report
    ...(rawData?.narrative_strength && rawData.narrative_strength.score > 0
      ? ['', `🌊 Narrative strength: ${rawData.narrative_strength.strength.toUpperCase()} (${rawData.narrative_strength.score}/100)`,
         rawData.narrative_strength.detail]
      : []),
    // Round 234b (AutoResearch): Supply unlock risk section
    ...(rawData?.supply_unlock_risk && rawData.supply_unlock_risk.risk_level !== 'unknown'
      ? ['', `🔓 Supply unlock risk: ${rawData.supply_unlock_risk.risk_level.toUpperCase()}`,
         ...rawData.supply_unlock_risk.notes]
      : []),
    '',
    '🥊 Competitor comparison',
    llmAnalysis?.competitor_comparison || 'n/a',
    '',
    ...(llmAnalysis?.liquidity_assessment ? ['💧 Liquidity assessment', llmAnalysis.liquidity_assessment, ''] : []),
    '📝 Analysis',
    llmAnalysis?.analysis_text || 'n/a',
    '',
    ...(rawData?.elevator_pitch ? ['', `💡 Elevator pitch: ${rawData.elevator_pitch}`] : []),
    // Round 28: Investment thesis section
    ...(rawData?.thesis
      ? [
          '📈 Investment Thesis',
          // Round 395 (AutoResearch): thesis one_liner + time horizons + conviction score in text
          ...(rawData.thesis.one_liner ? [`💡 ${rawData.thesis.one_liner}`] : []),
          ...(rawData.thesis.conviction_score != null ? [`📊 Conviction: ${rawData.thesis.conviction_score}/100`] : []),
          `🐂 Bull: ${rawData.thesis.bull_case || 'n/a'}`,
          `🐻 Bear: ${rawData.thesis.bear_case || 'n/a'}`,
          `🔄 Neutral: ${rawData.thesis.neutral_case || 'n/a'}`,
          ...(rawData.thesis.time_horizon_short ? [`📅 Short: ${rawData.thesis.time_horizon_short}`] : []),
          ...(rawData.thesis.time_horizon_medium ? [`📅 Medium: ${rawData.thesis.time_horizon_medium}`] : []),
        ]
      : []),
    ...(rawData?.trade_setup?.entry_zone ? [
      '',
      '📐 Trade Setup',
      renderTradeSetup(rawData.trade_setup) || 'n/a',
    ] : []),
  ].join('\n');

  const html = `
    <article style="background:#0a0a0a;color:#e8e8e8;font-family:'IBM Plex Mono',monospace;padding:28px;border-radius:24px;border:1px solid rgba(232,232,232,0.16);box-shadow:0 18px 50px rgba(0,0,0,0.35);max-width:960px;margin:0 auto;">
      <header style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;border-bottom:1px dashed rgba(232,232,232,0.16);padding-bottom:18px;margin-bottom:18px;">
        <div>
          <div style="color:#888888;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;">Alpha Scanner report</div>
          <h1 style="font-family:'Caveat',cursive;font-size:48px;line-height:0.95;margin:8px 0 10px;">🧠 ${escapeHtml(projectName)}</h1>
          <div style="color:#b5c7d3;">Generated at ${escapeHtml(json.generated_at)} · completeness ${escapeHtml(scores?.overall?.completeness ?? 'n/a')}%</div>
        </div>
        <div style="text-align:right;min-width:220px;">
          <div style="color:#888888;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:6px;">Research verdict</div>
          <div style="display:inline-block;padding:12px 20px;border-radius:999px;border:1px dashed rgba(232,232,232,0.28);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;background:rgba(255,255,255,0.04);color:${verdictColor(json.verdict)};">${escapeHtml(json.verdict)}</div>${volatileRegimeBadge(rawData?.volatility)}
          ${json.composite_alpha_index != null ? `<div style="margin-top:8px;color:#b5c7d3;font-size:12px;">⚡ Alpha Index: <strong style="color:#ffd3b6;">${json.composite_alpha_index}/100</strong></div>` : ''}
          <div style="margin-top:10px;color:#ffd3b6;">Collector failures: ${escapeHtml(failedCollectors.length ? failedCollectors.join(' | ') : 'none')}</div>
        </div>
      </header>

      ${(llmAnalysis?.headline || json.project_summary) ? `
      <section style="margin-bottom:20px;padding:16px;background:linear-gradient(135deg,rgba(255,211,182,0.06),rgba(181,199,211,0.06));border:1px dashed rgba(181,199,211,0.28);border-radius:18px;">
        ${llmAnalysis?.headline ? `<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#ffd3b6;letter-spacing:0.03em;">${escapeHtml(llmAnalysis.headline)}</p>` : ''}
        ${json.project_summary ? `<p style="margin:0;line-height:1.7;color:#d1d5db;font-size:13px;">${escapeHtml(json.project_summary)}</p>` : ''}
      </section>` : ''}

      <section style="margin-bottom:20px;padding:16px;background:rgba(255,255,255,0.03);border:1px dashed rgba(181,199,211,0.28);border-radius:18px;">
        <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 12px;color:#ffd3b6;">💎 Key Metrics</h2>
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Price</div>
            <div style="font-size:18px;font-weight:700;color:#e8e8e8;">${escapeHtml(keyMetrics.price_fmt)}</div>
          </div>
          ${keyMetrics.price_change_24h != null ? `
          <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">24h Change</div>
            <div style="font-size:18px;font-weight:700;color:${keyMetrics.price_change_24h >= 0 ? '#22c55e' : '#ef4444'};">${escapeHtml(keyMetrics.price_change_24h_fmt)}</div>
          </div>` : ''}
          ${keyMetrics.price_change_7d != null ? `
          <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">7d Change</div>
            <div style="font-size:18px;font-weight:700;color:${keyMetrics.price_change_7d >= 0 ? '#22c55e' : '#ef4444'};">${escapeHtml(keyMetrics.price_change_7d_fmt)}</div>
          </div>` : ''}
          ${keyMetrics.fdv_mcap_ratio != null && keyMetrics.fdv_mcap_ratio > 1 ? `
          <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">FDV/MCap</div>
            <div style="font-size:18px;font-weight:700;color:${keyMetrics.fdv_mcap_ratio > 5 ? '#ef4444' : keyMetrics.fdv_mcap_ratio > 2 ? '#fbbf24' : '#a8e6cf'};">${keyMetrics.fdv_mcap_ratio.toFixed(2)}x</div>
            <div style="color:#888;font-size:10px;margin-top:2px;">FDV: ${escapeHtml(keyMetrics.fdv_fmt)}</div>
          </div>` : ''}
          <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Market Cap</div>
            <div style="font-size:18px;font-weight:700;color:#e8e8e8;">${escapeHtml(keyMetrics.market_cap_fmt)}</div>
          </div>
          <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">TVL</div>
            <div style="font-size:18px;font-weight:700;color:#e8e8e8;">${escapeHtml(keyMetrics.tvl_fmt)}</div>
          </div>
          <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">24h Volume</div>
            <div style="font-size:18px;font-weight:700;color:#e8e8e8;">${escapeHtml(keyMetrics.volume_24h_fmt)}</div>
          </div>
          <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Overall Score</div>
            <div style="font-size:18px;font-weight:700;color:#a8e6cf;">${escapeHtml(keyMetrics.overall_score_fmt)}</div>
          </div>
          ${rawData?.conviction ? `
          <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Conviction</div>
            <div style="font-size:18px;font-weight:700;color:#ffd3b6;">${escapeHtml(rawData.conviction.score)}/100</div>
            <div style="color:#888;font-size:10px;margin-top:2px;">${escapeHtml(rawData.conviction.label)}</div>
          </div>` : ''}
        </div>
      </section>

      <section style="margin-bottom:20px;">
        <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 10px;color:#b5c7d3;">📊 Scores</h2>
        <ul style="margin:0;padding-left:18px;line-height:1.8;">
          <li><span style="color:${scoreColor(scores?.market_strength)};font-weight:700;">${escapeHtml(String(scores?.market_strength?.score ?? 'n/a'))}/10</span> Market strength${scores?.market_strength?.confidence_label ? ` [${escapeHtml(scores.market_strength.confidence_label)}]` : ''} — ${escapeHtml(scores?.market_strength?.reasoning || 'n/a')}</li>
          <li><span style="color:${scoreColor(scores?.onchain_health)};font-weight:700;">${escapeHtml(String(scores?.onchain_health?.score ?? 'n/a'))}/10</span> Onchain health${scores?.onchain_health?.confidence_label ? ` [${escapeHtml(scores.onchain_health.confidence_label)}]` : ''} — ${escapeHtml(scores?.onchain_health?.reasoning || 'n/a')}</li>
          <li><span style="color:${scoreColor(scores?.social_momentum)};font-weight:700;">${escapeHtml(String(scores?.social_momentum?.score ?? 'n/a'))}/10</span> Social momentum${scores?.social_momentum?.confidence_label ? ` [${escapeHtml(scores.social_momentum.confidence_label)}]` : ''} — ${escapeHtml(scores?.social_momentum?.reasoning || 'n/a')}</li>
          <li><span style="color:${scoreColor(scores?.development)};font-weight:700;">${escapeHtml(String(scores?.development?.score ?? 'n/a'))}/10</span> Development${scores?.development?.confidence_label ? ` [${escapeHtml(scores.development.confidence_label)}]` : ''} — ${escapeHtml(scores?.development?.reasoning || 'n/a')}</li>
          <li><span style="color:${scoreColor(scores?.tokenomics_health)};font-weight:700;">${escapeHtml(String(scores?.tokenomics_health?.score ?? 'n/a'))}/10</span> Tokenomics health${scores?.tokenomics_health?.confidence_label ? ` [${escapeHtml(scores.tokenomics_health.confidence_label)}]` : ''} — ${escapeHtml(scores?.tokenomics_health?.reasoning || 'n/a')}</li>
          <li><span style="color:${scoreColor(scores?.distribution)};font-weight:700;">${escapeHtml(String(scores?.distribution?.score ?? 'n/a'))}/10</span> Distribution${scores?.distribution?.confidence_label ? ` [${escapeHtml(scores.distribution.confidence_label)}]` : ''} — ${escapeHtml(scores?.distribution?.reasoning || 'n/a')}</li>
          <li><span style="color:${scoreColor(scores?.risk)};font-weight:700;">${escapeHtml(String(scores?.risk?.score ?? 'n/a'))}/10</span> Risk${scores?.risk?.confidence_label ? ` [${escapeHtml(scores.risk.confidence_label)}]` : ''} — ${escapeHtml(scores?.risk?.reasoning || 'n/a')}</li>
          <li><span style="color:${scoreColor(scores?.overall)};font-weight:700;">${escapeHtml(String(scores?.overall?.score ?? 'n/a'))}/10</span> Overall${scores?.overall?.confidence_label ? ` [${escapeHtml(scores.overall.confidence_label)}]` : ''} — ${escapeHtml(scores?.overall?.reasoning || 'n/a')}</li>
        </ul>
      </section>

      ${json.red_flags_summary.total > 0 ? `
      <section style="margin-bottom:20px;padding:16px;background:rgba(255,100,100,0.06);border:1px dashed rgba(239,68,68,0.3);border-radius:18px;">
        <h2 style="font-family:'Caveat',cursive;font-size:30px;margin:0 0 8px;color:#ef4444;">🚨 Risk Summary</h2>
        <p style="margin:0;color:#f87171;">Risk level: <strong>${json.red_flags_summary.risk_level}</strong> — ${json.red_flags_summary.total} flag(s): ${json.red_flags_summary.critical} critical, ${json.red_flags_summary.warnings} warnings</p>
        ${json.red_flags_summary.worst_flag ? `<p style="margin:4px 0 0;color:#888;font-size:12px;">Worst: ${escapeHtml(json.red_flags_summary.worst_flag.flag)} [${json.red_flags_summary.worst_flag.severity}]</p>` : ''}
      </section>` : ''}

      <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:20px;">
        <div style="border:1px dashed rgba(168,230,207,0.28);border-radius:18px;padding:16px;background:rgba(255,255,255,0.03);">
          <h2 style="font-family:'Caveat',cursive;font-size:30px;margin:0 0 8px;color:#a8e6cf;">🛡️ Moat</h2>
          <p style="margin:0;line-height:1.8;">${escapeHtml(llmAnalysis?.moat || 'n/a')}</p>
        </div>
        <div style="border:1px dashed rgba(255,139,148,0.28);border-radius:18px;padding:16px;background:rgba(255,255,255,0.03);">
          <h2 style="font-family:'Caveat',cursive;font-size:30px;margin:0 0 8px;color:#ff8b94;">⚠️ Risks</h2>
          <ul style="margin:0;padding-left:18px;line-height:1.8;">${renderList(llmAnalysis?.risks)}</ul>
        </div>
        <div style="border:1px dashed rgba(255,211,182,0.28);border-radius:18px;padding:16px;background:rgba(255,255,255,0.03);">
          <h2 style="font-family:'Caveat',cursive;font-size:30px;margin:0 0 8px;color:#ffd3b6;">🚀 Catalysts</h2>
          <ul style="margin:0;padding-left:18px;line-height:1.8;">${renderList(llmAnalysis?.catalysts)}</ul>
        </div>
      </section>

      <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:20px;">
        <div>
          <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 8px;color:#b5c7d3;">🐦 X sentiment</h2>
          <p style="margin:0;line-height:1.8;">${escapeHtml(llmAnalysis?.x_sentiment_summary || 'n/a')}</p>
        </div>
        <div>
          <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 8px;color:#b5c7d3;">🥊 Competitor comparison</h2>
          <p style="margin:0;line-height:1.8;">${escapeHtml(llmAnalysis?.competitor_comparison || 'n/a')}</p>
        </div>
      </section>

      ${rawData?.thesis ? `
      <section style="margin-bottom:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">
        <div style="border:1px dashed rgba(34,197,94,0.28);border-radius:18px;padding:16px;background:rgba(34,197,94,0.04);">
          <h3 style="font-family:'Caveat',cursive;font-size:24px;margin:0 0 8px;color:#22c55e;">🐂 Bull Case</h3>
          <p style="margin:0;line-height:1.7;color:#d1d5db;">${escapeHtml(rawData.thesis.bull_case || 'n/a')}</p>
        </div>
        <div style="border:1px dashed rgba(248,113,113,0.28);border-radius:18px;padding:16px;background:rgba(248,113,113,0.04);">
          <h3 style="font-family:'Caveat',cursive;font-size:24px;margin:0 0 8px;color:#f87171;">🐻 Bear Case</h3>
          <p style="margin:0;line-height:1.7;color:#d1d5db;">${escapeHtml(rawData.thesis.bear_case || 'n/a')}</p>
        </div>
        <div style="border:1px dashed rgba(251,191,36,0.28);border-radius:18px;padding:16px;background:rgba(251,191,36,0.04);">
          <h3 style="font-family:'Caveat',cursive;font-size:24px;margin:0 0 8px;color:#fbbf24;">🔄 Neutral Case</h3>
          <p style="margin:0;line-height:1.7;color:#d1d5db;">${escapeHtml(rawData.thesis.neutral_case || 'n/a')}</p>
        </div>
      </section>` : ''}

      <section style="margin-bottom:20px;">
        <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 8px;color:#b5c7d3;">🔎 Key findings</h2>
        <ul style="margin:0;padding-left:18px;line-height:1.8;">${renderList(llmAnalysis?.key_findings)}</ul>
      </section>

      ${Array.isArray(rawData?.alpha_signals) && rawData.alpha_signals.length > 0 ? `
      <section style="margin-bottom:20px;padding:16px;background:rgba(34,197,94,0.04);border:1px dashed rgba(34,197,94,0.28);border-radius:18px;">
        <h2 style="font-family:'Caveat',cursive;font-size:30px;margin:0 0 10px;color:#22c55e;">🔍 Alpha Signals (${rawData.alpha_signals.length})</h2>
        <ul style="margin:0;padding-left:18px;line-height:2;">
          ${rawData.alpha_signals.slice(0, 6).map(s => {
            const color = s.strength === 'strong' ? '#22c55e' : s.strength === 'moderate' ? '#fbbf24' : '#888';
            return `<li><span style="color:${color};font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">[${escapeHtml(s.strength || '?')}]</span> <strong>${escapeHtml(s.signal)}</strong>${s.detail ? ` — <span style="color:#aaa;">${escapeHtml(s.detail)}</span>` : ''}</li>`;
          }).join('')}
        </ul>
      </section>` : ''}

      ${rawData?.narrative_strength && rawData.narrative_strength.score > 0 ? `
      <section style="margin-bottom:20px;padding:14px;background:rgba(255,255,255,0.02);border:1px dashed rgba(181,199,211,0.2);border-radius:16px;">
        <h2 style="font-family:'Caveat',cursive;font-size:28px;margin:0 0 6px;color:#b5c7d3;">🌊 Narrative Strength</h2>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
          <span style="font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.1em;color:${rawData.narrative_strength.strength === 'strong' || rawData.narrative_strength.strength === 'very_strong' ? '#22c55e' : rawData.narrative_strength.strength === 'moderate' ? '#fbbf24' : '#888'};">${escapeHtml(rawData.narrative_strength.strength?.toUpperCase() ?? 'UNKNOWN')}</span>
          <span style="color:#888;font-size:12px;">${rawData.narrative_strength.score}/100</span>
        </div>
        ${rawData.narrative_strength.detail ? `<p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">${escapeHtml(rawData.narrative_strength.detail)}</p>` : ''}
      </section>` : ''}

      ${rawData?.elevator_pitch ? `
      <section style="margin-bottom:20px;padding:16px;background:linear-gradient(135deg,rgba(255,211,182,0.08),rgba(168,230,207,0.08));border:1px dashed rgba(255,211,182,0.3);border-radius:18px;">
        <h2 style="font-family:'Caveat',cursive;font-size:28px;margin:0 0 8px;color:#ffd3b6;">💡 Elevator Pitch</h2>
        <p style="margin:0;line-height:1.7;font-size:15px;color:#e8e8e8;">${escapeHtml(rawData.elevator_pitch)}</p>
      </section>` : ''}

      <section style="margin-bottom:20px;">
        <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 8px;color:#b5c7d3;">📝 Analysis</h2>
        <p style="margin:0;line-height:1.9;white-space:pre-wrap;">${escapeHtml(llmAnalysis?.analysis_text || 'n/a')}</p>
      </section>

      <footer style="border-top:1px dashed rgba(232,232,232,0.12);padding-top:14px;margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">
        <div style="color:#555;font-size:11px;letter-spacing:0.08em;">
          Engine: <span style="color:#888;">${escapeHtml(json.engine_version ?? 'unknown')}</span>
          &nbsp;·&nbsp; Quality: <span style="color:${json.data_quality.quality_tier === 'high' ? '#22c55e' : json.data_quality.quality_tier === 'medium' ? '#fbbf24' : '#f87171'};font-weight:700;">${escapeHtml(json.data_quality.quality_tier?.toUpperCase() ?? 'N/A')}</span>
          &nbsp;·&nbsp; Coverage: <span style="color:#888;">${escapeHtml(String(json.data_quality.coverage_pct ?? 'n/a'))}%</span>
          &nbsp;·&nbsp; Completeness: <span style="color:#888;">${escapeHtml(String(json.data_quality.completeness_pct ?? 'n/a'))}%</span>
        </div>
        <div style="color:#444;font-size:11px;">${escapeHtml(json.generated_at)}</div>
      </footer>

      ${rawData?.trade_setup?.entry_zone ? `
      <section style="margin-top:20px;padding:16px;background:rgba(255,255,255,0.03);border:1px dashed rgba(181,199,211,0.28);border-radius:18px;">
        <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 12px;color:#ffd3b6;">📐 Trade Setup</h2>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          ${rawData.trade_setup.entry_zone ? `<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:8px 14px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">Entry Zone</div><div style="font-weight:700;color:#e8e8e8;">$${rawData.trade_setup.entry_zone.low} – $${rawData.trade_setup.entry_zone.high}</div></div>` : ''}
          ${rawData.trade_setup.stop_loss ? `<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:8px 14px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">Stop Loss</div><div style="font-weight:700;color:#ef4444;">$${rawData.trade_setup.stop_loss}</div></div>` : ''}
          ${rawData.trade_setup.take_profit_targets?.[0] ? `<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:8px 14px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">TP1</div><div style="font-weight:700;color:#22c55e;">$${rawData.trade_setup.take_profit_targets[0].price} <span style="color:#888;font-size:11px;">(+${rawData.trade_setup.take_profit_targets[0].pct_gain}%)</span></div></div>` : ''}
          ${rawData.trade_setup.take_profit_targets?.[1] ? `<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:8px 14px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">TP2</div><div style="font-weight:700;color:#22c55e;">$${rawData.trade_setup.take_profit_targets[1].price} <span style="color:#888;font-size:11px;">(+${rawData.trade_setup.take_profit_targets[1].pct_gain}%)</span></div></div>` : ''}
          ${rawData.trade_setup.risk_reward_ratio ? `<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:8px 14px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">R/R</div><div style="font-weight:700;color:#ffd3b6;">${rawData.trade_setup.risk_reward_ratio}</div></div>` : ''}
          ${rawData.trade_setup.setup_quality ? `<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:8px 14px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">Quality</div><div style="font-weight:700;color:#b5c7d3;">${escapeHtml(rawData.trade_setup.setup_quality)}</div></div>` : ''}
        </div>
      </section>` : ''}
    </article>
  `;

  // Round 28: Attach thesis to json output if available
  if (rawData?.thesis && typeof rawData.thesis === 'object') {
    json.thesis = rawData.thesis;
  }

  // Round 403 (AutoResearch): risk_profile — consolidated risk signals for agent decision-making
  json.risk_profile = {
    risk_score: scores?.risk?.score ?? null,
    risk_level: json.red_flags_summary.risk_level,
    critical_flags: json.red_flags_summary.critical,
    total_flags: json.red_flags_summary.total,
    circuit_breakers_active: scores?.overall?.circuit_breakers?.capped ?? false,
    volatility_regime: rawData?.volatility?.regime ?? 'calm',
    volatility_pct_24h: rawData?.volatility?.volatility_pct_24h ?? null,
    supply_unlock_risk: rawData?.supply_unlock_risk?.risk_level ?? 'unknown',
    fdv_overhang: keyMetrics.fdv_mcap_ratio != null && keyMetrics.fdv_mcap_ratio > 2 ? 'high' : keyMetrics.fdv_mcap_ratio != null && keyMetrics.fdv_mcap_ratio > 1.5 ? 'moderate' : 'low',
    wash_trading_risk: keyMetrics.wash_trading_risk ?? null,
  };

  // Round 402 (AutoResearch): add tl_dr field — one-sentence summary for quick agent consumption
  json.tl_dr = (() => {
    const verdict = json.verdict;
    const score = scores?.overall?.score;
    const scoreFmt = score != null ? `${Number(score).toFixed(1)}/10` : 'n/a';
    const pitch = rawData?.elevator_pitch ?? rawData?.thesis?.one_liner ?? null;
    const base = `${projectName}: ${verdict} (${scoreFmt})`;
    return pitch ? `${base} — ${pitch}` : base;
  })();

  return { json, text, html };
}

/**
 * Generate a Markdown report.
 * Clean, portable, linkable format.
 */
export function formatMarkdown(projectName, rawData, scores, llmAnalysis) {
  const keyMetrics = extractKeyMetrics(rawData, scores);
  const conviction = rawData?.conviction;
  const crossDim = rawData?.cross_dimensional;
  const riskMatrix = rawData?.risk_matrix;

  const lines = [
    `# 🧠 Alpha Scanner — ${projectName}`,
    '',
    `**Verdict:** ${llmAnalysis?.verdict || 'HOLD'}`,
    `**Overall Score:** ${keyMetrics.overall_score_fmt}`,
    `**Generated:** ${new Date().toISOString()}`,
    ...(rawData?.elevator_pitch ? [`**Elevator Pitch:** ${rawData.elevator_pitch}`] : []),
    ...(conviction ? [`**Conviction:** ${conviction.score}/100 (${conviction.label})`] : []),
    '',
    '## 💎 Key Metrics',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Price | ${keyMetrics.price_fmt} |`,
    `| Market Cap | ${keyMetrics.market_cap_fmt} |`,
    `| TVL | ${keyMetrics.tvl_fmt} |`,
    `| 24h Volume | ${keyMetrics.volume_24h_fmt} |`,
    '',
    '## 📊 Scores',
    '',
    `| Dimension | Score | Confidence |`,
    `|-----------|-------|------------|`,
    ...['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'distribution', 'risk'].map(dim => {
      const s = scores?.[dim];
      return `| ${dim.replace(/_/g, ' ')} | ${s?.score ?? 'n/a'}/10 | ${s?.confidence_label ?? s?.confidence ?? 'n/a'} |`;
    }),
    `| **Overall** | ${scores?.overall?.score ?? 'n/a'}/10 | ${scores?.overall?.overall_confidence ?? 'n/a'}% |`,
    '',
    '## 🛡️ Moat',
    '',
    llmAnalysis?.moat || 'n/a',
    '',
    '## ⚠️ Risks',
    '',
    ...(llmAnalysis?.risks?.length ? llmAnalysis.risks.map(r => `- ${r}`) : ['- n/a']),
    '',
    '## 🚀 Catalysts',
    '',
    ...(llmAnalysis?.catalysts?.length ? llmAnalysis.catalysts.map(c => `- ${c}`) : ['- n/a']),
    '',
    ...(crossDim?.divergences?.length ? [
      '## 🔀 Cross-Dimensional Insights',
      '',
      ...crossDim.divergences.map(d => `- **${d.type}**: ${d.detail}`),
      ...crossDim.convergences.map(c => `- **${c.type}**: ${c.detail}`),
      '',
    ] : []),
    ...(riskMatrix ? [
      '## 🛑 Risk Matrix',
      '',
      `**Overall Risk:** ${riskMatrix.risk_level} (${riskMatrix.overall_risk_score}/10)`,
      '',
      ...riskMatrix.heatmap.filter(h => h.flag_count > 0).map(h => `- **${h.label}**: ${h.flag_count} flag(s), impact ${(h.impact * 100).toFixed(0)}%`),
      '',
    ] : []),
    '## 📝 Analysis',
    '',
    llmAnalysis?.analysis_text || 'n/a',
    '',
    '## 🔎 Key Findings',
    '',
    ...(llmAnalysis?.key_findings?.length ? llmAnalysis.key_findings.map(f => `- ${f}`) : ['- n/a']),
  ];

  return lines.join('\n');
}

/**
 * Generate a plain text report for Discord/Telegram.
 * Target: <1500 chars.
 */
export function formatPlainText(projectName, rawData, scores, llmAnalysis) {
  const keyMetrics = extractKeyMetrics(rawData, scores);
  const conviction = rawData?.conviction;
  const riskMatrix = rawData?.risk_matrix;

  // Round 410 (AutoResearch): add alpha index + risk level + conviction in plain text header
  const collectorMetaPlain = rawData?.metadata?.collectors ?? {};
  const totalCollectorsPlain = Object.keys(collectorMetaPlain).length;
  const okCollectorsPlain = Object.values(collectorMetaPlain).filter((c) => c?.ok !== false && !c?.error).length;
  const alphaIndexPlain = (() => {
    const overallScore = scores?.overall?.score ?? 5;
    const alphaSignalCount = Math.min(Array.isArray(rawData?.alpha_signals) ? rawData.alpha_signals.length : 0, 5);
    const qualityTier = totalCollectorsPlain > 0 ? (okCollectorsPlain / totalCollectorsPlain >= 0.8 ? 'high' : 'medium') : 'low';
    const qualityBonus = qualityTier === 'high' ? 20 : 10;
    const convictionScore = rawData?.thesis?.conviction_score ?? 50;
    return Math.round((overallScore / 10) * 50 + alphaSignalCount * 3 + qualityBonus + (convictionScore / 100) * 15);
  })();
  const redFlagsPlain = Array.isArray(rawData?.red_flags) ? rawData.red_flags : [];
  const criticalFlagsPlain = redFlagsPlain.filter(f => f.severity === 'critical').length;
  const riskLevelPlain = criticalFlagsPlain >= 2 ? 'critical' : criticalFlagsPlain >= 1 ? 'high' : redFlagsPlain.filter(f => f.severity === 'warning').length >= 3 ? 'elevated' : 'moderate';

  const parts = [
    `🧠 ${projectName} — ${llmAnalysis?.verdict || 'HOLD'} (${keyMetrics.overall_score_fmt}) ⚡${alphaIndexPlain}/100 🛡️${riskLevelPlain}`,
  ];

  if (conviction) {
    parts.push(`📊 Conviction: ${conviction.score}/100 (${conviction.label})`);
  }

  parts.push(`💰 Price ${keyMetrics.price_fmt} | MCap ${keyMetrics.market_cap_fmt} | TVL ${keyMetrics.tvl_fmt}`);

  // Top 2 risks
  const risks = (llmAnalysis?.risks ?? []).slice(0, 2);
  if (risks.length) parts.push(`⚠️ ${risks.join(' | ')}`);

  // Top 2 catalysts
  const catalysts = (llmAnalysis?.catalysts ?? []).slice(0, 2);
  if (catalysts.length) parts.push(`🚀 ${catalysts.join(' | ')}`);

  // Risk level
  if (riskMatrix) parts.push(`🛑 Risk: ${riskMatrix.risk_level} (${riskMatrix.total_flags} flags)`);

  // First sentence of analysis
  const firstSentence = (llmAnalysis?.analysis_text ?? '').match(/^[^.!?]+[.!?]/)?.[0];
  if (firstSentence) parts.push(`📝 ${firstSentence}`);

  // Elevator pitch if available
  const pitch = rawData?.elevator_pitch ?? rawData?.thesis?.one_liner;
  if (pitch && parts.join('\n').length < 1200) parts.push(`💡 ${pitch}`);

  // Truncate to 1500 chars
  let result = parts.join('\n');
  if (result.length > 1500) result = result.slice(0, 1497) + '...';
  return result;
}

/**
 * Generate a JSON report optimized for agent consumption.
 * Includes conviction, cross-dimensional, and risk matrix.
 */
export function formatAgentJSON(projectName, rawData, scores, llmAnalysis) {
  const keyMetrics = extractKeyMetrics(rawData, scores);

  // Calculate composite_alpha_index (same logic as formatReport)
  const collectorMeta = rawData?.metadata?.collectors ?? {};
  const totalCollectors = Object.keys(collectorMeta).length;
  const okCollectors = Object.values(collectorMeta).filter((c) => c?.ok !== false && !c?.error).length;
  const dataQualityTier = (() => {
    const cov = totalCollectors > 0 ? okCollectors / totalCollectors : 0;
    if (cov >= 0.8 && (scores?.overall?.completeness ?? 0) >= 70) return 'high';
    if (cov >= 0.5 && (scores?.overall?.completeness ?? 0) >= 40) return 'medium';
    return 'low';
  })();
  const compositeAlphaIndex = (() => {
    const overallScore = scores?.overall?.score ?? 5;
    const alphaSignalCount = Math.min(Array.isArray(rawData?.alpha_signals) ? rawData.alpha_signals.length : 0, 5);
    const qualityBonus = dataQualityTier === 'high' ? 20 : dataQualityTier === 'medium' ? 10 : 0;
    const convictionScore = rawData?.thesis?.conviction_score ?? 50;
    return Math.round(
      (overallScore / 10) * 50 +
      alphaSignalCount * 3 +
      qualityBonus +
      (convictionScore / 100) * 15
    );
  })();

  // Build red_flags_summary (same logic as formatReport)
  const flags = Array.isArray(rawData?.red_flags) ? rawData.red_flags : [];
  const critical = flags.filter((f) => f.severity === 'critical');
  const warnings = flags.filter((f) => f.severity === 'warning');
  const infos = flags.filter((f) => f.severity === 'info');
  const worst = critical[0] ?? warnings[0] ?? infos[0] ?? null;
  const redFlagsSummary = {
    total: flags.length,
    critical: critical.length,
    warnings: warnings.length,
    info: infos.length,
    worst_flag: worst ? { flag: worst.flag, severity: worst.severity } : null,
    risk_level: critical.length >= 2 ? 'critical' : critical.length >= 1 ? 'high' : warnings.length >= 3 ? 'elevated' : warnings.length >= 1 ? 'moderate' : 'low',
  };

  return {
    project_name: projectName,
    generated_at: new Date().toISOString(),
    verdict: llmAnalysis?.verdict || 'HOLD',
    headline: llmAnalysis?.headline ?? null,
    overall_score: scores?.overall?.score ?? null,
    conviction: rawData?.conviction ?? null,
    composite_alpha_index: compositeAlphaIndex,
    // Round 404 (AutoResearch): alpha_index_label for quick agent interpretation
    alpha_index_label: (() => {
      if (compositeAlphaIndex >= 80) return 'exceptional';
      if (compositeAlphaIndex >= 65) return 'strong';
      if (compositeAlphaIndex >= 50) return 'moderate';
      if (compositeAlphaIndex >= 35) return 'weak';
      return 'poor';
    })(),
    // Round 404 (AutoResearch): tl_dr — one-sentence agent-friendly summary
    tl_dr: (() => {
      const scoreFmt = scores?.overall?.score != null ? `${Number(scores.overall.score).toFixed(1)}/10` : 'n/a';
      const pitch = rawData?.elevator_pitch ?? rawData?.thesis?.one_liner ?? null;
      const base = `${projectName}: ${llmAnalysis?.verdict || 'HOLD'} (${scoreFmt})`;
      return pitch ? `${base} — ${pitch}` : base;
    })(),
    elevator_pitch: rawData?.elevator_pitch ?? null,
    red_flags_summary: redFlagsSummary,
    key_metrics: keyMetrics,
    scores: Object.fromEntries(
      ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'distribution', 'risk'].map(dim => [
        dim,
        {
          score: scores?.[dim]?.score ?? null,
          confidence: scores?.[dim]?.confidence ?? null,
          confidence_label: scores?.[dim]?.confidence_label ?? null,
        },
      ])
    ),
    // Round 405 (AutoResearch): risk_profile — consolidated risk for agent consumption
    risk_profile: {
      risk_score: scores?.risk?.score ?? null,
      risk_level: redFlagsSummary.risk_level,
      critical_flags: redFlagsSummary.critical,
      circuit_breakers_active: scores?.overall?.circuit_breakers?.capped ?? false,
      volatility_regime: rawData?.volatility?.regime ?? 'calm',
      supply_unlock_risk: rawData?.supply_unlock_risk?.risk_level ?? 'unknown',
      fdv_overhang: (() => {
        const ratio = keyMetrics.fdv_mcap_ratio;
        if (ratio == null) return 'unknown';
        if (ratio > 2) return 'high';
        if (ratio > 1.5) return 'moderate';
        return 'low';
      })(),
      wash_trading_risk: keyMetrics.wash_trading_risk ?? null,
    },
    cross_dimensional: rawData?.cross_dimensional ?? null,
    risk_matrix: rawData?.risk_matrix ? {
      overall_risk_score: rawData.risk_matrix.overall_risk_score,
      risk_level: rawData.risk_matrix.risk_level,
      verdict_modifier: rawData.risk_matrix.verdict_modifier,
      active_categories: rawData.risk_matrix.active_categories,
    } : null,
    sector_context: rawData?.sector_context ?? null,
    temporal_delta: rawData?.temporal_delta ? {
      has_history: rawData.temporal_delta.has_history,
      narrative: rawData.temporal_delta.narrative,
    } : null,
    thesis: rawData?.thesis ?? null,
    moat: llmAnalysis?.moat ?? null,
    risks: llmAnalysis?.risks ?? [],
    catalysts: llmAnalysis?.catalysts ?? [],
    key_findings: llmAnalysis?.key_findings ?? [],
  };
}

/**
 * Format report in the requested format.
 *
 * @param {string} format - 'html' | 'md' | 'json' | 'text'
 * @param {string} projectName
 * @param {object} rawData
 * @param {object} scores
 * @param {object} llmAnalysis
 * @returns {object} { content, contentType }
 */
export function formatReportMulti(format, projectName, rawData, scores, llmAnalysis) {
  switch (format) {
    case 'md':
    case 'markdown':
      return {
        content: formatMarkdown(projectName, rawData, scores, llmAnalysis),
        contentType: 'text/markdown',
      };
    case 'text':
    case 'plain':
      return {
        content: formatPlainText(projectName, rawData, scores, llmAnalysis),
        contentType: 'text/plain',
      };
    case 'json':
      return {
        content: formatAgentJSON(projectName, rawData, scores, llmAnalysis),
        contentType: 'application/json',
      };
    case 'html':
    default: {
      const result = formatReport(projectName, rawData, scores, llmAnalysis);
      return {
        content: result.html,
        contentType: 'text/html',
      };
    }
  }
}

export { fmtNumber, fmtPct };
