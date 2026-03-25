const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_TIMEOUT_MS = 60000;
const FAST_MODEL = 'grok-4-1-fast-non-reasoning';
const REASONING_MODEL = 'grok-4.20-multi-agent-0309';
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

function buildPrompt(projectName, rawData, scores) {
  const overallScore = scores?.overall?.score ?? 0;

  return [
    '## ROLE',
    'You are a senior crypto alpha analyst. Your job: produce actionable, evidence-based reports for sophisticated investors. No fluff, no generic disclaimers.',

    '## INSTRUCTIONS',
    '1. Use the attached RAW_DATA and SCORES as your quantitative foundation.',
    '2. Use X Search to find: recent whale wallet activity, KOL opinions, narrative trends, community sentiment in the last 7-30 days.',
    '3. Use Web Search to check: audits/security incidents, exchange listing news, protocol upgrades, funding rounds, regulatory developments, competitor moves.',
    '4. Synthesize ALL sources into a coherent thesis.',
    '5. If data is missing or cannot be verified, state the gap explicitly — do NOT fabricate.',

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
    '- analysis_text: 3-4 paragraphs. Para 1: summary thesis. Para 2: on-chain/fundamental evidence. Para 3: market/sentiment context. Para 4: near-term outlook.',
    '- moat: competitive advantage in 1-2 sentences. Be specific (e.g., "Only DEX with native cross-chain liquidity on Base+Arbitrum").',
    '- risks: array of 3-5 specific risk strings. Format: "Risk type: specific detail."',
    '- catalysts: array of 3-5 specific upcoming catalysts. Format: "Catalyst type: specific detail + expected timeline if known."',
    '- competitor_comparison: paragraph naming 2-3 direct competitors with tickers. Compare TVL, fees, growth rate, and market cap.',
    '- x_sentiment_summary: 2-3 sentences on current X/Twitter narrative, key accounts discussing it, and community tone.',
    '- key_findings: array of 4-6 key findings. Each finding should be a single, specific, data-backed insight.',

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

    `PROJECT: ${projectName}`,
    `ALGORITHMIC_SCORES: ${JSON.stringify(scores, null, 2)}`,
    `RAW_DATA: ${JSON.stringify(rawData, null, 2)}`,
  ].join('\n\n');
}

export function fallbackReport(projectName, rawData, scores, error = null) {
  const overallScore = Number(scores?.overall?.score || 0);
  const verdict = pickVerdict(overallScore);
  const risks = [];
  const catalysts = [];
  const keyFindings = [];

  if ((rawData?.tokenomics?.pct_circulating || 0) < 50) {
    risks.push('Circulating supply is still limited: unlock/dilution risk remains.');
  }
  if ((rawData?.onchain?.tvl_change_30d || 0) < 0) {
    risks.push('TVL is contracting on a monthly basis.');
  }
  if ((rawData?.social?.sentiment || 'neutral') === 'bullish') {
    catalysts.push('Social sentiment is constructive and the narrative is active.');
  }
  if ((rawData?.github?.commits_90d || 0) > 30) {
    catalysts.push('Visible software development over the last 90 days.');
  }
  if ((rawData?.market?.price_change_percentage_24h || rawData?.market?.change_24h || 0) > 5) {
    catalysts.push('Strong short-term price momentum (+5% in 24h).');
  }
  if ((rawData?.social?.mentions || 0) > 100) {
    catalysts.push('High social mention volume detected.');
  }
  if ((rawData?.onchain?.tvl_change_7d || 0) > 10) {
    catalysts.push('TVL growing rapidly on a weekly basis (+10%+).');
  }
  if ((rawData?.market?.total_volume || 0) > (rawData?.market?.market_cap || Infinity) * 0.15) {
    catalysts.push('Volume/market-cap ratio elevated — active trading interest.');
  }
  if ((rawData?.onchain?.fees_7d || 0) > 0 && (rawData?.onchain?.revenue_7d || 0) > 0) {
    catalysts.push('Protocol is generating fees and revenue.');
  }
  if ((rawData?.market?.price_change_percentage_24h || rawData?.market?.change_24h || 0) < -10) {
    risks.push('Sharp price decline in 24h — possible negative catalyst.');
  }
  if ((rawData?.social?.sentiment || 'neutral') === 'bearish') {
    risks.push('Social sentiment is bearish.');
  }
  if ((rawData?.market?.total_volume || 0) < 50000) {
    risks.push('Extremely low trading volume — liquidity risk.');
  }
  if ((rawData?.market?.market_cap || 0) > 0) {
    keyFindings.push(`Observed market cap: ${Number(rawData.market.market_cap).toLocaleString('en-US')}.`);
  }
  if ((rawData?.onchain?.tvl || 0) > 0) {
    keyFindings.push(`Observed TVL: ${Number(rawData.onchain.tvl).toLocaleString('en-US')}.`);
  }
  if ((rawData?.social?.mentions || 0) > 0) {
    keyFindings.push(`Social mentions: ${rawData.social.mentions}.`);
  }
  if (rawData?.github?.commits_90d > 0) {
    keyFindings.push(`GitHub activity: ${rawData.github.commits_90d} commits in 90 days, ${rawData.github.contributors || 'n/a'} contributors.`);
  }
  if (rawData?.tokenomics?.pct_circulating) {
    keyFindings.push(`Circulating supply: ${rawData.tokenomics.pct_circulating.toFixed(1)}%.`);
  }

  return {
    verdict,
    analysis_text: `${projectName}: overall score ${overallScore}/10. Market ${scores?.market_strength?.score}/10, onchain ${scores?.onchain_health?.score}/10, social ${scores?.social_momentum?.score}/10, dev ${scores?.development?.score}/10, tokenomics ${scores?.tokenomics_health?.score}/10.${error ? ` Fallback used: ${error}.` : ''}`,
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
  };
}

function normalizeReport(payload, projectName, rawData, scores) {
  const overallScore = Number(scores?.overall?.score || 0);
  return {
    verdict: normalizeVerdict(payload?.verdict, overallScore),
    analysis_text:
      String(payload?.analysis_text || '').trim() || fallbackReport(projectName, rawData, scores).analysis_text,
    moat: String(payload?.moat || '').trim() || 'n/a',
    risks: normalizeList(payload?.risks, ['n/a']),
    catalysts: normalizeList(payload?.catalysts, ['n/a']),
    competitor_comparison: String(payload?.competitor_comparison || '').trim() || 'n/a',
    x_sentiment_summary: String(payload?.x_sentiment_summary || '').trim() || 'n/a',
    key_findings: normalizeList(payload?.key_findings, ['n/a']),
  };
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
    'You are a senior crypto alpha analyst. Produce a concise but actionable quick-scan report. No tools available — rely entirely on attached data.',

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
    '- analysis_text: 2-3 paragraphs (thesis → evidence → outlook)',
    '- moat: specific competitive advantage (1-2 sentences, avoid generics like "first mover")',
    '- risks: array of 3-5 risks, format: "Risk type: specific detail"',
    '- catalysts: array of 3-5 catalysts, format: "Catalyst type: specific detail"',
    '- competitor_comparison: name 2-3 competitors with tickers, compare key metrics',
    '- x_sentiment_summary: infer likely sentiment from price action, social data, and narrative',
    '- key_findings: array of 4-6 data-backed insights, each self-contained',

    `PROJECT: ${projectName}`,
    `ALGORITHMIC_SCORES: ${JSON.stringify(scores, null, 2)}`,
    `RAW_DATA: ${JSON.stringify(rawData, null, 2)}`,
  ].join('\n\n');

  try {
    let payload;
    try {
      payload = await requestXai({ apiKey, model: FAST_MODEL, input: prompt, tools: [], timeoutMs: 25000 });
    } catch (firstErr) {
      console.error(`[quick-llm] First attempt failed: ${firstErr.message}`);
      // Retry once on timeout or 5xx
      payload = await requestXai({ apiKey, model: FAST_MODEL, input: prompt, tools: [], timeoutMs: 30000 });
    }
    const text = extractOutputText(payload);
    console.log(`[quick-llm] Grok response length: ${text?.length || 0}`);
    const parsed = JSON.parse(text);
    const report = normalizeReport(parsed, projectName, rawData, scores);
    console.log(`[quick-llm] x_sentiment: ${report.x_sentiment_summary?.substring(0, 60)}`);
    return report;
  } catch (error) {
    console.error(`[quick-llm] FALLBACK: ${error.name} — ${error.message}`);
    return fallbackReport(
      projectName,
      rawData,
      scores,
      error.name === 'AbortError' ? 'xAI quick timeout' : error.message
    );
  }
}

export async function generateReport(projectName, rawData, scores, { apiKey: explicitKey } = {}) {
  const apiKey = explicitKey || process.env.XAI_API_KEY;
  if (!apiKey) {
    return fallbackReport(projectName, rawData, scores, 'XAI_API_KEY missing');
  }

  const prompt = buildPrompt(projectName, rawData, scores);

  try {
    const payload = await requestXai({
      apiKey,
      model: REASONING_MODEL,
      input: prompt,
      tools: [{ type: 'web_search' }, { type: 'x_search' }],
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    const text = extractOutputText(payload);
    return normalizeReport(JSON.parse(text), projectName, rawData, scores);
  } catch (error) {
    return fallbackReport(
      projectName,
      rawData,
      scores,
      error.name === 'AbortError' ? 'xAI timeout' : error.message
    );
  }
}
