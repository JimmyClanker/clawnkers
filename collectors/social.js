const BULLISH_KEYWORDS = [
  'bullish', 'breakout', 'surge', 'growth', 'adoption', 'upside', 'momentum',
  'accumulate', 'outperform', 'partnership', 'launch', 'integration', 'staking',
  'airdrop', 'undervalued', 'gem', 'opportunity', 'rally', 'ath',
];
const BEARISH_KEYWORDS = [
  'bearish', 'selloff', 'dump', 'decline', 'risk', 'downside', 'lawsuit',
  'exploit', 'headwinds', 'rug', 'scam', 'hack', 'depegged', 'insolvent',
  'bankruptcy', 'exit', 'dead', 'failed', 'abandoned', 'delisted',
];
const NEUTRAL_KEYWORDS = ['neutral', 'mixed', 'sideways', 'watchlist', 'monitor', 'range', 'unclear', 'consolidation'];

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
    normalizeToken(projectName),
    ...projectTokens,
  ]);

  const counts = new Map();
  for (const item of items) {
    const corpus = `${item.title || ''} ${(item.highlights || []).join(' ')}`;
    const tokens = corpus.match(/[A-Za-z][A-Za-z0-9-]{3,}/g) || [];
    for (const rawToken of tokens) {
      const token = normalizeToken(rawToken);
      if (!token || stopwords.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
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

    const sentimentCounts = uniqueNews.reduce(
      (acc, item) => {
        const corpus = `${item.title} ${item.highlights.join(' ')}`;
        const label = classifySentiment(corpus);
        acc[label] += 1;
        return acc;
      },
      { bullish: 0, bearish: 0, neutral: 0 }
    );

    // Normalized sentiment score: -1 (fully bearish) to +1 (fully bullish)
    const totalSentiment = sentimentCounts.bullish + sentimentCounts.bearish + sentimentCounts.neutral;
    const sentimentScore = totalSentiment > 0
      ? (sentimentCounts.bullish - sentimentCounts.bearish) / totalSentiment
      : 0;

    const recentNews = [...uniqueNews]
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 5)
      .map(({ title, url, date }) => ({ title, url, date }));

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
      error: settled.every((entry) => entry.status === 'rejected') ? 'All Exa queries failed' : null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.message,
    };
  }
}
