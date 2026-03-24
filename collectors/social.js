const BULLISH_KEYWORDS = ['bullish', 'breakout', 'surge', 'growth', 'adoption', 'upside', 'momentum', 'accumulate', 'outperform'];
const BEARISH_KEYWORDS = ['bearish', 'selloff', 'dump', 'decline', 'risk', 'downside', 'lawsuit', 'exploit', 'headwinds'];
const NEUTRAL_KEYWORDS = ['neutral', 'mixed', 'sideways', 'watchlist', 'monitor', 'range', 'unclear', 'consolidation'];

function emptySocialResult(projectName) {
  return {
    project_name: projectName,
    mentions: 0,
    sentiment: 'neutral',
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
    const queries = [`${projectName} crypto news 2026`, `${projectName} sentiment analysis`];
    const settled = await Promise.allSettled(queries.map((query) => exaService.exaSearch(query)));
    const items = settled
      .filter((entry) => entry.status === 'fulfilled')
      .flatMap((entry) => entry.value?.results || []);

    const uniqueNews = [];
    const seen = new Set();

    for (const item of items) {
      const key = item?.url || `${item?.title}-${item?.publishedDate}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      uniqueNews.push({
        title: item?.title || 'Untitled',
        url: item?.url || null,
        date: item?.publishedDate || null,
        highlights: item?.highlights || [],
      });
    }

    const sentimentCounts = uniqueNews.reduce(
      (acc, item) => {
        const corpus = `${item.title} ${item.highlights.join(' ')}`;
        acc.bullish += countKeywords(corpus, BULLISH_KEYWORDS);
        acc.bearish += countKeywords(corpus, BEARISH_KEYWORDS);
        acc.neutral += countKeywords(corpus, NEUTRAL_KEYWORDS);
        return acc;
      },
      { bullish: 0, bearish: 0, neutral: 0 }
    );

    const recentNews = [...uniqueNews]
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 5)
      .map(({ title, url, date }) => ({ title, url, date }));

    return {
      ...fallback,
      mentions: uniqueNews.length,
      sentiment: decideSentiment(sentimentCounts),
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
