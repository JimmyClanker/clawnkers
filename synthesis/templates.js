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

export function formatReport(projectName, rawData, scores, llmAnalysis) {
  const collectors = rawData?.metadata?.collectors || {};
  const failedCollectors = Object.entries(collectors)
    .filter(([, payload]) => payload?.ok === false || payload?.error)
    .map(([name, payload]) => `${name}: ${payload?.error || 'unknown error'}`);

  const json = {
    project_name: projectName,
    generated_at: new Date().toISOString(),
    verdict: llmAnalysis?.verdict || 'HOLD',
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
    '📊 Scores',
    `- ${renderScoreLine('Market strength', scores?.market_strength)}`,
    `- ${renderScoreLine('Onchain health', scores?.onchain_health)}`,
    `- ${renderScoreLine('Social momentum', scores?.social_momentum)}`,
    `- ${renderScoreLine('Development', scores?.development)}`,
    `- ${renderScoreLine('Tokenomics health', scores?.tokenomics_health)}`,
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
    '📝 Analysis',
    llmAnalysis?.analysis_text || 'n/a',
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
          <div style="display:inline-block;padding:12px 20px;border-radius:999px;border:1px dashed rgba(232,232,232,0.28);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;background:rgba(255,255,255,0.04);">${escapeHtml(json.verdict)}</div>
          <div style="margin-top:10px;color:#ffd3b6;">Collector failures: ${escapeHtml(failedCollectors.length ? failedCollectors.join(' | ') : 'none')}</div>
        </div>
      </header>

      <section style="margin-bottom:20px;">
        <h2 style="font-family:'Caveat',cursive;font-size:32px;margin:0 0 10px;color:#b5c7d3;">📊 Scores</h2>
        <ul style="margin:0;padding-left:18px;line-height:1.8;">
          <li>${escapeHtml(renderScoreLine('Market strength', scores?.market_strength))}</li>
          <li>${escapeHtml(renderScoreLine('Onchain health', scores?.onchain_health))}</li>
          <li>${escapeHtml(renderScoreLine('Social momentum', scores?.social_momentum))}</li>
          <li>${escapeHtml(renderScoreLine('Development', scores?.development))}</li>
          <li>${escapeHtml(renderScoreLine('Tokenomics health', scores?.tokenomics_health))}</li>
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

  return { json, text, html };
}
