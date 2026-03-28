/**
 * News Analyst — LLM-powered contextual analysis of news mentions.
 *
 * Instead of counting keywords ("exploit" = red flag), this service reads
 * the actual news content and determines if threats are active or historical,
 * if unlocks are imminent or distant, and provides nuanced risk assessment.
 *
 * Cost: 1 LLM call per scan (Haiku/Grok — cheap)
 * Added: 28 Mar 2026
 */

const ANALYSIS_TIMEOUT_MS = 15_000;

/**
 * Analyze news items for a project and return structured risk assessment.
 * 
 * @param {string} projectName
 * @param {Array} newsItems - Array of {title, highlights, url, date}
 * @param {object} options - { xaiApiKey, model }
 * @returns {object} Structured analysis with corrected risk levels
 */
export async function analyzeNews(projectName, newsItems, options = {}) {
  if (!newsItems?.length || newsItems.length === 0) {
    return createEmptyAnalysis();
  }

  const { xaiApiKey, model = 'grok-3-mini' } = options;

  // Filter to only relevant items (exploit, hack, unlock, regulatory mentions)
  // Check title + highlights, but also check URL slugs (many CoinMarketCap/CoinGecko
  // articles have generic titles but the content discusses exploits/unlocks)
  const relevantItems = newsItems.filter(item => {
    const text = `${item.title || ''} ${(item.highlights || []).join(' ')} ${item.url || ''}`.toLowerCase();
    return /hack|exploit|stolen|drained|compromised|attack|rugpull|unlock|vesting|cliff|regulatory|sec |cftc|lawsuit|sued|security|breach|vulnerab/.test(text);
  });

  if (relevantItems.length === 0) {
    return createEmptyAnalysis();
  }

  // Build concise news digest for LLM
  const newsDigest = relevantItems.slice(0, 12).map((item, i) => {
    const date = item.date ? new Date(item.date).toISOString().split('T')[0] : 'unknown';
    const highlights = (item.highlights || []).join(' ').slice(0, 200);
    return `[${i + 1}] ${date} | ${item.title}\n    ${highlights}`;
  }).join('\n');

  const prompt = `Analyze these news items about "${projectName}" and classify each risk mention.

NEWS ITEMS:
${newsDigest}

For each category, determine:
1. EXPLOITS/HACKS: Are these about an ACTIVE/RECENT security incident (last 7 days) affecting the protocol directly? Or are they HISTORICAL references, ecosystem-wide coverage, or mentions of other protocols?
2. UNLOCKS/VESTING: Is there a token unlock happening within 30 days? Or is it about a distant future event or already-completed unlock?
3. REGULATORY: Is the project directly targeted by regulators? Or is it general industry coverage?

Respond in JSON only:
{
  "exploit_risk": "active" | "historical" | "ecosystem" | "none",
  "exploit_summary": "one line explanation",
  "unlock_risk": "imminent" | "upcoming" | "distant" | "none",
  "unlock_summary": "one line explanation",
  "regulatory_risk": "direct" | "industry" | "none",
  "regulatory_summary": "one line explanation",
  "overall_sentiment_shift": "positive" | "neutral" | "negative",
  "key_insight": "one line — the most important thing an investor should know right now"
}`;

  try {
    // Try Grok first (cheapest), fall back to XAI key if available
    const apiKey = xaiApiKey || process.env.XAI_API_KEY;
    if (!apiKey) {
      // Fall back to keyword-only analysis (no LLM available)
      return keywordFallbackAnalysis(projectName, relevantItems);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a crypto risk analyst. Respond with valid JSON only, no markdown.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 400,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return keywordFallbackAnalysis(projectName, relevantItems);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    
    // Parse JSON from response (handle markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return keywordFallbackAnalysis(projectName, relevantItems);
    }

    const analysis = JSON.parse(jsonMatch[0]);
    return {
      ...createEmptyAnalysis(),
      ...analysis,
      analyzed: true,
      items_analyzed: relevantItems.length,
      model_used: model,
    };
  } catch (err) {
    // On any error, fall back to keyword analysis
    return keywordFallbackAnalysis(projectName, relevantItems);
  }
}

/**
 * When no LLM is available, apply smarter heuristics than pure keyword counting.
 */
function keywordFallbackAnalysis(projectName, items) {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  // Check recency of exploit mentions
  const exploitItems = items.filter(i => {
    const text = `${i.title} ${(i.highlights || []).join(' ')}`.toLowerCase();
    return /hack|exploit|stolen|drained|compromised|attack|rugpull/.test(text);
  });
  const recentExploits = exploitItems.filter(i => {
    const ts = new Date(i.date || 0).getTime();
    return ts > sevenDaysAgo;
  });
  const oldExploits = exploitItems.filter(i => {
    const ts = new Date(i.date || 0).getTime();
    return ts <= sevenDaysAgo;
  });

  // Check if exploit mentions are about the project itself or ecosystem
  const directExploits = exploitItems.filter(i => {
    const text = `${i.title}`.toLowerCase();
    const projLower = projectName.toLowerCase();
    return text.includes(projLower) && /hack|exploit|stolen|drained/.test(text);
  });

  let exploitRisk = 'none';
  if (recentExploits.length >= 2 && directExploits.length >= 1) exploitRisk = 'active';
  else if (directExploits.length > 0 && oldExploits.length > recentExploits.length) exploitRisk = 'historical';
  else if (exploitItems.length > 0) exploitRisk = 'ecosystem';

  // Check unlock timing
  const unlockItems = items.filter(i => {
    const text = `${i.title} ${(i.highlights || []).join(' ')}`.toLowerCase();
    return /unlock|vesting|cliff/.test(text);
  });
  const recentUnlockNews = unlockItems.filter(i => {
    const ts = new Date(i.date || 0).getTime();
    return ts > thirtyDaysAgo;
  });

  let unlockRisk = 'none';
  if (recentUnlockNews.length >= 2) unlockRisk = 'upcoming';
  else if (unlockItems.length > 0) unlockRisk = 'distant';

  return {
    exploit_risk: exploitRisk,
    exploit_summary: exploitRisk === 'active'
      ? `${recentExploits.length} recent articles report active security issues`
      : exploitRisk === 'historical'
        ? `Exploit mentions appear to reference past incidents, not active threats`
        : exploitRisk === 'ecosystem'
          ? `Exploit mentions are about the broader ecosystem, not ${projectName} directly`
          : 'No exploit mentions found',
    unlock_risk: unlockRisk,
    unlock_summary: unlockRisk === 'upcoming'
      ? `${recentUnlockNews.length} recent articles discuss upcoming token unlocks`
      : unlockRisk === 'distant'
        ? 'Unlock mentions reference distant or completed events'
        : 'No unlock concerns',
    regulatory_risk: 'none',
    regulatory_summary: 'No regulatory assessment available (LLM unavailable)',
    overall_sentiment_shift: 'neutral',
    key_insight: '',
    analyzed: false,
    items_analyzed: items.length,
    model_used: 'keyword_heuristic',
  };
}

function createEmptyAnalysis() {
  return {
    exploit_risk: 'none',
    exploit_summary: 'No relevant news to analyze',
    unlock_risk: 'none',
    unlock_summary: 'No relevant news to analyze',
    regulatory_risk: 'none',
    regulatory_summary: 'No relevant news to analyze',
    overall_sentiment_shift: 'neutral',
    key_insight: '',
    analyzed: false,
    items_analyzed: 0,
    model_used: null,
  };
}
