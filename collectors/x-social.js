/**
 * x-social.js — Grok Fast X/Twitter collector
 *
 * Uses xAI Responses API with x_search tool to fetch real X/Twitter discussions
 * about a crypto project.
 *
 * Requires XAI_API_KEY environment variable (optional — returns graceful error if missing).
 */

const GROK_FAST_MODEL = 'grok-4-1-fast-non-reasoning';
const XAI_API_URL = 'https://api.x.ai/v1/responses';

/**
 * Collect X/Twitter social data for a project using Grok Fast.
 *
 * @param {string} projectName - project/token name (e.g. "Bitcoin", "Ethereum")
 * @param {object} [opts]
 * @param {string} [opts.apiKey] - xAI API key (falls back to XAI_API_KEY env)
 * @returns {Promise<object>} social data or error object
 */
export async function collectXSocial(projectName, { apiKey } = {}) {
  const key = apiKey || process.env.XAI_API_KEY;
  if (!key) return { error: 'XAI_API_KEY not set', source: 'grok_fast' };

  const prompt = `Give me the latest discussions on X/Twitter about the crypto project "${projectName}" from the last 7 days. Return JSON with:
- sentiment: "bullish" | "bearish" | "neutral" | "mixed"
- sentiment_score: number from -1 (very bearish) to +1 (very bullish)
- mention_volume: "high" | "medium" | "low" | "none"
- key_narratives: array of 2-4 dominant narratives/themes
- notable_accounts: array of notable accounts discussing this (max 5, only real ones you found)
- kol_sentiment: "bullish" | "bearish" | "neutral" | "mixed" (sentiment of notable accounts specifically)
- summary: 2-3 sentence summary of what people are saying

CRITICAL: Only report what you actually find via X Search. If there is little to no discussion, say so honestly. Do NOT invent accounts, narratives, or sentiment.`;

  try {
    const response = await fetch(XAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROK_FAST_MODEL,
        input: prompt,
        tools: [{ type: 'x_search' }],
        text: { format: { type: 'json_object' } },
        max_output_tokens: 1000,
        temperature: 0,
      }),
    });

    if (!response.ok) throw new Error(`xAI returned ${response.status}`);

    const payload = await response.json();

    // Extract text from payload (same pattern as llm.js extractOutputText)
    let text = payload?.output_text;
    if (!text) {
      for (const item of payload?.output || []) {
        if (!Array.isArray(item?.content)) continue;
        for (const content of item.content) {
          if (typeof content?.text === 'string') {
            text = content.text;
            break;
          }
        }
        if (text) break;
      }
    }

    if (!text) return { error: 'Empty response from Grok fast', source: 'grok_fast' };

    const parsed = JSON.parse(text);
    // Round 107 (AutoResearch): guard against NaN/null in numeric fields from Grok response
    if (typeof parsed.sentiment_score === 'number' && !Number.isFinite(parsed.sentiment_score)) {
      parsed.sentiment_score = 0; // default neutral
    }
    // Round 114 (AutoResearch): dedup key_narratives and notable_accounts arrays (case-insensitive)
    const dedupNarratives = Array.isArray(parsed.key_narratives)
      ? [...new Map(parsed.key_narratives.map(n => [String(n).trim().toLowerCase(), String(n).trim()])).values()].slice(0, 10)
      : [];
    const dedupAccounts = Array.isArray(parsed.notable_accounts)
      ? [...new Map(parsed.notable_accounts.map(a => [String(a).trim().toLowerCase(), String(a).trim()])).values()].slice(0, 5)
      : [];
    // Ensure required fields have defaults if missing
    return {
      sentiment: parsed.sentiment ?? 'neutral',
      sentiment_score: parsed.sentiment_score ?? 0,
      mention_volume: parsed.mention_volume ?? 'none',
      key_narratives: dedupNarratives,
      notable_accounts: dedupAccounts,
      kol_sentiment: parsed.kol_sentiment ?? null,
      summary: parsed.summary ?? null,
      source: 'grok_fast',
      model: GROK_FAST_MODEL,
      collected_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[x-social] Error for ${projectName}:`, err.message);
    return { error: err.message, source: 'grok_fast' };
  }
}
