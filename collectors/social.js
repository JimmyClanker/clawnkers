const BULLISH_KEYWORDS = [
  'bullish', 'breakout', 'surge', 'growth', 'adoption', 'upside', 'momentum',
  'accumulate', 'outperform', 'partnership', 'launch', 'integration', 'staking',
  'airdrop', 'undervalued', 'gem', 'opportunity', 'rally', 'ath',
  // Round 1: expanded bullish vocabulary
  'upgrade', 'mainnet', 'milestone', 'record', 'volume', 'inflow', 'tvl growth',
  'ecosystem', 'grant', 'v2', 'v3', 'institutional', 'demand', 'whale buy',
];
const BEARISH_KEYWORDS = [
  'bearish', 'selloff', 'dump', 'decline', 'risk', 'downside', 'lawsuit',
  'exploit', 'headwinds', 'rug', 'scam', 'hack', 'depegged', 'insolvent',
  'bankruptcy', 'exit', 'dead', 'failed', 'abandoned', 'delisted',
  // Round 1: expanded bearish vocabulary
  'outflow', 'bridge hack', 'vulnerability', 'exploit', 'shutdown', 'delisting',
  'regulatory', 'ban', 'conviction', 'fraud', 'ponzi', 'exit liquidity',
];
const NEUTRAL_KEYWORDS = ['neutral', 'mixed', 'sideways', 'watchlist', 'monitor', 'range', 'unclear', 'consolidation'];

// Round 1: High-trust news domains (bonus signal quality)
const TRUSTED_DOMAINS = new Set([
  'coindesk.com', 'cointelegraph.com', 'theblock.co', 'decrypt.co',
  'blockworks.co', 'dlnews.com', 'cryptobriefing.com', 'messari.io',
  'defipulse.com', 'rekt.news', 'delphi.digital', 'galaxy.com',
]);

function getDomainTrustScore(url) {
  if (!url) return 1.0;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return TRUSTED_DOMAINS.has(host) ? 1.4 : 1.0;
  } catch {
    return 1.0;
  }
}

// Heuristic bot indicators in article titles/content
const BOT_SIGNAL_PATTERNS = [
  /\bprice prediction\b/i,
  /\b\d+\s*%\s*(gain|profit|return)\s+(guaranteed|sure|certain)\b/i,
  /\b(buy|sell)\s+(before|now|immediately)\b/i,
  /\bclick here\b/i,
  /\bdon't miss\b/i,
  /\bexclusive (offer|deal|bonus)\b/i,
];

function isBotLikeContent(text) {
  const haystack = String(text || '');
  return BOT_SIGNAL_PATTERNS.some((pattern) => pattern.test(haystack));
}

function emptySocialResult(projectName) {
  return {
    project_name: projectName,
    mentions: 0,
    filtered_mentions: 0,
    bot_filtered_count: 0,
    sentiment: 'neutral',
    sentiment_score: 0, // -1 to +1 normalized
    sentiment_counts: {
      bullish: 0,
      bearish: 0,
      neutral: 0,
    },
    key_narratives: [],
    recent_news: [],
    error: null,
  };
}

function countKeywords(text, keywords) {
  const haystack = String(text || '').toLowerCase();
  return keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
}

function classifySentiment(text) {
  const bullish = countKeywords(text, BULLISH_KEYWORDS);
  const bearish = countKeywords(text, BEARISH_KEYWORDS);
  const neutral = countKeywords(text, NEUTRAL_KEYWORDS);

  if (bullish > bearish && bullish >= neutral) return 'bullish';
  if (bearish > bullish && bearish >= neutral) return 'bearish';
  return 'neutral';
}

// ─── Round 1: Weighted recency in narrative extraction ────────────────────────
// Items are passed in reverse-chron order; weight tokens from newer items higher.
function extractNarratives(items, projectName) {
  const projectTokens = String(projectName || '')
    .split(/\s+/)
    .map((token) => normalizeToken(token))
    .filter(Boolean);

  const stopwords = new Set([
    'the',
    'and',
    'with',
    'from',
    'that',
    'this',
    'crypto',
    'token',
    'coin',
    'will',
    'has',
    'was',
    'are',
    'for',
    'its',
    'not',
    normalizeToken(projectName),
    ...projectTokens,
  ]);

  const counts = new Map();
  // Weight newer items higher (decay from oldest to newest)
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const recencyWeight = 1 + (idx / Math.max(1, items.length - 1)) * 0.5; // 1.0 → 1.5
    const corpus = `${item.title || ''} ${(item.highlights || []).join(' ')}`;
    const tokens = corpus.match(/[A-Za-z][A-Za-z0-9-]{3,}/g) || [];
    for (const rawToken of tokens) {
      const token = normalizeToken(rawToken);
      if (!token || stopwords.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + recencyWeight);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token]) => token);
}

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

function decideSentiment(counts) {
  const { bullish, bearish, neutral } = counts;
  if (bullish > bearish && bullish >= neutral) return 'bullish';
  if (bearish > bullish && bearish >= neutral) return 'bearish';
  return 'neutral';
}

export async function collectSocial(projectName, exaService) {
  const fallback = emptySocialResult(projectName);

  if (!exaService?.exaSearch) {
    return {
      ...fallback,
      error: 'Missing exaService dependency',
    };
  }

  try {
    const queries = [
      `${projectName} crypto news 2026`,
      `${projectName} token catalyst OR partnership OR integration`,
      `${projectName} protocol adoption OR ecosystem growth`,
      `${projectName} sentiment analysis`,
      // Round 23: unlock/vesting/security-specific queries for risk signals
      `${projectName} token unlock OR vesting OR hack OR exploit OR security`,
      // Round 41: institutional and on-chain whale activity
      `${projectName} whale wallet OR institutional OR fund OR investment 2026`,
    ];
    const settled = await Promise.allSettled(queries.map((query) => exaService.exaSearch(query)));
    const items = settled
      .filter((entry) => entry.status === 'fulfilled')
      .flatMap((entry) => entry.value?.results || []);

    const rawItems = [];
    const seen = new Set();

    for (const item of items) {
      const normalizedTitle = normalizeToken(item?.title || '');
      const key = item?.url || `${normalizedTitle}-${item?.publishedDate || ''}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rawItems.push({
        title: item?.title || 'Untitled',
        url: item?.url || null,
        date: item?.publishedDate || null,
        highlights: item?.highlights || [],
      });
    }

    // Bot/spam filtering
    let botFilteredCount = 0;
    const uniqueNews = rawItems.filter((item) => {
      const corpus = `${item.title} ${item.highlights.join(' ')}`;
      if (isBotLikeContent(corpus)) {
        botFilteredCount++;
        return false;
      }
      return true;
    });

    // Round 1: weight sentiment by domain trustworthiness
    const sentimentCounts = uniqueNews.reduce(
      (acc, item) => {
        const corpus = `${item.title} ${item.highlights.join(' ')}`;
        const label = classifySentiment(corpus);
        const weight = getDomainTrustScore(item.url);
        acc[label] += weight;
        return acc;
      },
      { bullish: 0, bearish: 0, neutral: 0 }
    );
    // Round 1: round weighted counts for cleaner output
    sentimentCounts.bullish = Math.round(sentimentCounts.bullish * 10) / 10;
    sentimentCounts.bearish = Math.round(sentimentCounts.bearish * 10) / 10;
    sentimentCounts.neutral = Math.round(sentimentCounts.neutral * 10) / 10;

    // Normalized sentiment score: -1 (fully bearish) to +1 (fully bullish)
    const totalSentiment = sentimentCounts.bullish + sentimentCounts.bearish + sentimentCounts.neutral;
    const sentimentScore = totalSentiment > 0
      ? (sentimentCounts.bullish - sentimentCounts.bearish) / totalSentiment
      : 0;

    const recentNews = [...uniqueNews]
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 5)
      .map(({ title, url, date }) => ({ title, url, date }));

    // Round 23: detect unlock/exploit mentions as specific risk signals
    const unlockMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /unlock|vesting|cliff|token release/.test(text);
    }).length;
    const exploitMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /exploit|hack|breach|vulnerability|attack/.test(text);
    }).length;

    // Round 41: detect institutional/whale mentions (positive signal)
    const institutionalMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /whale|institutional|fund|investment|billion|million dollar|vc|venture|acquisition|partnership/.test(text);
    }).length;

    // Round 41: detect regulatory mentions (risk signal)
    const regulatoryMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /regulatory|sec|cftc|ban|comply|compliance|lawsuit|fine|sanction|seizure/.test(text);
    }).length;

    return {
      ...fallback,
      mentions: rawItems.length,
      filtered_mentions: uniqueNews.length,
      bot_filtered_count: botFilteredCount,
      sentiment: decideSentiment(sentimentCounts),
      sentiment_score: Math.round(sentimentScore * 100) / 100,
      sentiment_counts: sentimentCounts,
      key_narratives: extractNarratives(uniqueNews, projectName),
      recent_news: recentNews,
      unlock_mentions: unlockMentions,
      exploit_mentions: exploitMentions,
      institutional_mentions: institutionalMentions,
      regulatory_mentions: regulatoryMentions,
      error: settled.every((entry) => entry.status === 'rejected') ? 'All Exa queries failed' : null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.message,
    };
  }
}
