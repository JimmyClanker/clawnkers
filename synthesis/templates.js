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
    <article>
      <h1>🧠 Alpha Scanner Report — ${escapeHtml(projectName)}</h1>
      <p><strong>Verdict:</strong> ${escapeHtml(json.verdict)}</p>
      <p><strong>Generated at:</strong> ${escapeHtml(json.generated_at)}</p>
      <p><strong>Data completeness:</strong> ${escapeHtml(scores?.overall?.completeness ?? 'n/a')}%</p>
      <h2>📊 Scores</h2>
      <ul>
        <li>${escapeHtml(renderScoreLine('Market strength', scores?.market_strength))}</li>
        <li>${escapeHtml(renderScoreLine('Onchain health', scores?.onchain_health))}</li>
        <li>${escapeHtml(renderScoreLine('Social momentum', scores?.social_momentum))}</li>
        <li>${escapeHtml(renderScoreLine('Development', scores?.development))}</li>
        <li>${escapeHtml(renderScoreLine('Tokenomics health', scores?.tokenomics_health))}</li>
        <li>${escapeHtml(renderScoreLine('Overall', scores?.overall))}</li>
      </ul>
      <h2>🛡️ Moat</h2>
      <p>${escapeHtml(llmAnalysis?.moat || 'n/a')}</p>
      <h2>⚠️ Risks</h2>
      <ul>${renderList(llmAnalysis?.risks)}</ul>
      <h2>🚀 Catalysts</h2>
      <ul>${renderList(llmAnalysis?.catalysts)}</ul>
      <h2>🐦 X sentiment</h2>
      <p>${escapeHtml(llmAnalysis?.x_sentiment_summary || 'n/a')}</p>
      <h2>🔎 Key findings</h2>
      <ul>${renderList(llmAnalysis?.key_findings)}</ul>
      <h2>🥊 Competitor comparison</h2>
      <p>${escapeHtml(llmAnalysis?.competitor_comparison || 'n/a')}</p>
      <h2>📝 Analysis</h2>
      <p>${escapeHtml(llmAnalysis?.analysis_text || 'n/a')}</p>
    </article>
  `;

  return { json, text, html };
}
