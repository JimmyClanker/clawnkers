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
  return `${label}: ${payload?.score ?? 'n/a'}/10 — ${payload?.reasoning || 'n/a'}`;
}

function fmtNumber(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'n/a';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(decimals)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(decimals)}K`;
  return `$${n.toFixed(decimals)}`;
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

function extractKeyMetrics(rawData, scores) {
  const market = rawData?.market ?? {};
  const onchain = rawData?.onchain ?? {};
  const dex = rawData?.dex ?? {};

  const price = Number(market.current_price ?? market.price ?? 0);
  const marketCap = Number(market.market_cap ?? 0);
  const tvl = Number(onchain.tvl ?? 0);
  const volume24h = Number(market.total_volume ?? market.volume_24h ?? 0);
  const overallScore = Number(scores?.overall?.score ?? 0);

  // Round 8: DEX pressure + TVL stickiness context
  const dexPressure = dex.pressure_signal ?? null;
  const dexBuySellRatio = dex.buy_sell_ratio ?? null;
  const tvlStickiness = onchain.tvl_stickiness ?? null;

  return {
    price: price > 0 ? price : null,
    market_cap: marketCap > 0 ? marketCap : null,
    tvl: tvl > 0 ? tvl : null,
    volume_24h: volume24h > 0 ? volume24h : null,
    overall_score: overallScore,
    price_fmt: price > 0 ? fmtNumber(price, price < 0.01 ? 6 : price < 1 ? 4 : 2) : 'n/a',
    market_cap_fmt: marketCap > 0 ? fmtNumber(marketCap) : 'n/a',
    tvl_fmt: tvl > 0 ? fmtNumber(tvl) : 'n/a',
    volume_24h_fmt: volume24h > 0 ? fmtNumber(volume24h) : 'n/a',
    overall_score_fmt: `${overallScore.toFixed(1)}/10`,
    dex_pressure: dexPressure,
    dex_buy_sell_ratio: dexBuySellRatio,
    tvl_stickiness: tvlStickiness,
  };
}

export function formatReport(projectName, rawData, scores, llmAnalysis) {
  const collectors = rawData?.metadata?.collectors || {};
  const failedCollectors = Object.entries(collectors)
    .filter(([, payload]) => payload?.ok === false || payload?.error)
    .map(([name, payload]) => `${name}: ${payload?.error || 'unknown error'}`);

  const keyMetrics = extractKeyMetrics(rawData, scores);

  const json = {
    project_name: projectName,
    generated_at: new Date().toISOString(),
    engine_version: 'r30-2026-03-25', // bump on significant engine changes
    verdict: llmAnalysis?.verdict || 'HOLD',
    headline: llmAnalysis?.headline ?? null,
    project_summary: llmAnalysis?.project_summary ?? null,
    project_category: llmAnalysis?.project_category ?? rawData?.onchain?.category ?? null,
    score: scores?.overall?.score ?? null,
    validation_warnings: llmAnalysis?._validation?.warnings ?? [],
    key_metrics: keyMetrics,
    scores,
    llm_analysis: llmAnalysis,
    raw_data: rawData,
  };

  const text = [
    `🧠 Alpha Scanner Report — ${projectName}`,
    `📌 Verdict: ${json.verdict}`,
    `🕒 Generated at: ${json.generated_at}`,
    `🧩 Data completeness: ${scores?.overall?.completeness ?? 'n/a'}%`,
    `🧪 Collector failures: ${failedCollectors.length ? failedCollectors.join(' | ') : 'none'}`,
    '',
    '💎 Key Metrics',
    `- Price: ${keyMetrics.price_fmt}`,
    `- Market Cap: ${keyMetrics.market_cap_fmt}`,
    `- TVL: ${keyMetrics.tvl_fmt}`,
    `- 24h Volume: ${keyMetrics.volume_24h_fmt}`,
    `- Overall Score: ${keyMetrics.overall_score_fmt}`,
    ...(keyMetrics.dex_pressure ? [`- DEX Pressure: ${keyMetrics.dex_pressure} (ratio: ${keyMetrics.dex_buy_sell_ratio ?? 'n/a'})`] : []),
    ...(keyMetrics.tvl_stickiness ? [`- TVL Stickiness: ${keyMetrics.tvl_stickiness}`] : []),
    // Round 13 (AutoResearch batch): protocol maturity + DEX liquidity depth
    ...(rawData?.onchain?.protocol_maturity ? [`- Protocol Maturity: ${rawData.onchain.protocol_maturity}`] : []),
    ...(rawData?.dex?.liquidity_category ? [`- DEX Liquidity: ${rawData.dex.liquidity_category} (${ rawData?.dex?.dex_liquidity_usd ? fmtNumber(rawData.dex.dex_liquidity_usd) : 'n/a' })`] : []),
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
    '🐦 X sentiment',
    llmAnalysis?.x_sentiment_summary || 'n/a',
    '',
    '🔎 Key findings',
    ...(llmAnalysis?.key_findings?.length ? llmAnalysis.key_findings.map((item) => `- ${item}`) : ['- n/a']),
    '',
    '🥊 Competitor comparison',
    llmAnalysis?.competitor_comparison || 'n/a',
    '',
    ...(llmAnalysis?.liquidity_assessment ? ['💧 Liquidity assessment', llmAnalysis.liquidity_assessment, ''] : []),
    '📝 Analysis',
    llmAnalysis?.analysis_text || 'n/a',
    '',
    // Round 28: Investment thesis section
    ...(rawData?.thesis
      ? [
          '📈 Investment Thesis',
          `🐂 Bull: ${rawData.thesis.bull_case || 'n/a'}`,
          `🐻 Bear: ${rawData.thesis.bear_case || 'n/a'}`,
          `🔄 Neutral: ${rawData.thesis.neutral_case || 'n/a'}`,
        ]
      : []),
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
          <div style="margin-top:10px;color:#ffd3b6;">Collector failures: ${escapeHtml(failedCollectors.length ? failedCollectors.join(' | ') : 'none')}</div>
        </div>
      </header>

      <section style="margin-bottom:20px;padding:16px;background:rgba(255,255,255,0.03);border:1px dashed rgba(181,199,211,0.28);border-radius:18px;">
        <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 12px;color:#ffd3b6;">💎 Key Metrics</h2>
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:10px 16px;min-width:120px;text-align:center;">
            <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Price</div>
            <div style="font-size:18px;font-weight:700;color:#e8e8e8;">${escapeHtml(keyMetrics.price_fmt)}</div>
          </div>
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
        </div>
      </section>

      <section style="margin-bottom:20px;">
        <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 10px;color:#b5c7d3;">📊 Scores</h2>
        <ul style="margin:0;padding-left:18px;line-height:1.8;">
          <li>${escapeHtml(renderScoreLine('Market strength', scores?.market_strength))}</li>
          <li>${escapeHtml(renderScoreLine('Onchain health', scores?.onchain_health))}</li>
          <li>${escapeHtml(renderScoreLine('Social momentum', scores?.social_momentum))}</li>
          <li>${escapeHtml(renderScoreLine('Development', scores?.development))}</li>
          <li>${escapeHtml(renderScoreLine('Tokenomics health', scores?.tokenomics_health))}</li>
          <li>${escapeHtml(renderScoreLine('Distribution', scores?.distribution))}</li>
          <li>${escapeHtml(renderScoreLine('Risk', scores?.risk))}</li>
          <li>${escapeHtml(renderScoreLine('Overall', scores?.overall))}</li>
        </ul>
      </section>

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

      <section style="margin-bottom:20px;">
        <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 8px;color:#b5c7d3;">🔎 Key findings</h2>
        <ul style="margin:0;padding-left:18px;line-height:1.8;">${renderList(llmAnalysis?.key_findings)}</ul>
      </section>

      <section>
        <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 8px;color:#b5c7d3;">📝 Analysis</h2>
        <p style="margin:0;line-height:1.9;white-space:pre-wrap;">${escapeHtml(llmAnalysis?.analysis_text || 'n/a')}</p>
      </section>
    </article>
  `;

  // Round 28: Attach thesis to json output if available
  if (rawData?.thesis && typeof rawData.thesis === 'object') {
    json.thesis = rawData.thesis;
  }

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

  const parts = [
    `🧠 ${projectName} — ${llmAnalysis?.verdict || 'HOLD'} (${keyMetrics.overall_score_fmt})`,
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

  return {
    project_name: projectName,
    generated_at: new Date().toISOString(),
    verdict: llmAnalysis?.verdict || 'HOLD',
    headline: llmAnalysis?.headline ?? null,
    overall_score: scores?.overall?.score ?? null,
    conviction: rawData?.conviction ?? null,
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
