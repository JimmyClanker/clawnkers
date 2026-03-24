const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_TIMEOUT_MS = 60000;
const FAST_MODEL = 'grok-4-1-fast-non-reasoning';
const REASONING_MODEL = 'grok-4.20-0309-reasoning';
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
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : fallback;
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
  return [
    'Sei un senior crypto analyst focalizzato su alpha discovery. Devi produrre un report utile a un investitore, non una recensione generica.',
    'Usa SEMPRE i dati raw allegati come base numerica primaria.',
    'Poi usa X Search per verificare sentiment su X/Twitter, whale mentions, KOL opinions, community tone e narrative in corso sul progetto.',
    'Usa Web Search per verificare notizie recenti, audit/security notes, exchange listing rumors, partnership, governance changes, funding, contesto competitivo.',
    'Se i dati esterni sono deboli o non verificabili, dillo chiaramente invece di inventare.',
    'Restituisci SOLO JSON valido.',
    'Campi obbligatori: verdict, analysis_text, moat, risks, catalysts, competitor_comparison, x_sentiment_summary, key_findings.',
    'verdict deve essere uno tra: STRONG BUY, BUY, HOLD, AVOID, STRONG AVOID.',
    'risks, catalysts, key_findings devono essere array di stringhe.',
    `PROJECT: ${projectName}`,
    `SCORES: ${JSON.stringify(scores, null, 2)}`,
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
    risks.push('Circulating supply ancora limitata: rischio unlock/diluizione.');
  }
  if ((rawData?.onchain?.tvl_change_30d || 0) < 0) {
    risks.push('TVL in contrazione sul mese.');
  }
  if ((rawData?.social?.sentiment || 'neutral') === 'bullish') {
    catalysts.push('Sentiment social positivo e narrativa attiva.');
  }
  if ((rawData?.github?.commits_90d || 0) > 30) {
    catalysts.push('Sviluppo software visibile negli ultimi 90 giorni.');
  }
  if ((rawData?.market?.market_cap || 0) > 0) {
    keyFindings.push(`Market cap rilevata: ${Number(rawData.market.market_cap).toLocaleString('en-US')}.`);
  }
  if ((rawData?.onchain?.tvl || 0) > 0) {
    keyFindings.push(`TVL osservata: ${Number(rawData.onchain.tvl).toLocaleString('en-US')}.`);
  }

  return {
    verdict,
    analysis_text: `${projectName}: overall score ${overallScore}/10. Market ${scores?.market_strength?.score}/10, onchain ${scores?.onchain_health?.score}/10, social ${scores?.social_momentum?.score}/10, dev ${scores?.development?.score}/10, tokenomics ${scores?.tokenomics_health?.score}/10.${error ? ` Fallback usato: ${error}.` : ''}`,
    moat:
      'Da validare con dati qualitativi esterni; il vantaggio competitivo dipende da rete, liquidità, brand e execution.',
    risks: risks.length ? risks : ['Copertura dati incompleta: servono ulteriori verifiche qualitative.'],
    catalysts: catalysts.length ? catalysts : ['Nessun catalizzatore forte emerso dai dati disponibili.'],
    competitor_comparison:
      'Confronto competitor non disponibile in fallback; usare category/chains/narrative per peer set manuale.',
    x_sentiment_summary:
      'X sentiment non disponibile in fallback locale; necessario X Search via Grok per validazione qualitativa.',
    key_findings: keyFindings.length
      ? keyFindings
      : ['Analisi basata solo su collector locali e scoring algoritmico.'],
  };
}

function normalizeReport(payload, projectName, rawData, scores) {
  return {
    verdict: String(payload?.verdict || pickVerdict(Number(scores?.overall?.score || 0))),
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

  const prompt = [
    'Genera una versione compatta e veloce del report.',
    'Non usare tool esterni. Basati solo sui dati allegati.',
    'Restituisci solo JSON valido con gli stessi campi richiesti.',
    `PROJECT: ${projectName}`,
    `SCORES: ${JSON.stringify(scores, null, 2)}`,
    `RAW_DATA: ${JSON.stringify(rawData, null, 2)}`,
  ].join('\n\n');

  try {
    const payload = await requestXai({ apiKey, model: FAST_MODEL, input: prompt, tools: [], timeoutMs: 15000 });
    const text = extractOutputText(payload);
    return normalizeReport(JSON.parse(text), projectName, rawData, scores);
  } catch (error) {
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
