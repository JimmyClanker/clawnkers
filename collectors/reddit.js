import { fetchJson } from './fetch.js';

const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';

// Reuse keyword lists mirroring social.js for consistent sentiment scoring
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

function countKeywords(text, keywords) {
  const haystack = String(text || '').toLowerCase();
  return keywords.reduce((sum, kw) => sum + (haystack.includes(kw) ? 1 : 0), 0);
}

function classifySentiment(text) {
  const bullish = countKeywords(text, BULLISH_KEYWORDS);
  const bearish = countKeywords(text, BEARISH_KEYWORDS);
  if (bullish > bearish) return 'bullish';
  if (bearish > bullish) return 'bearish';
  return 'neutral';
}

function createEmptyRedditResult(projectName) {
  return {
    project_name: projectName,
    post_count: 0,
    subreddits: [],
    sentiment: 'neutral',
    sentiment_counts: { bullish: 0, bearish: 0, neutral: 0 },
    top_posts: [],
    error: null,
  };
}

/**
 * Collect Reddit mentions for a project.
 * Uses Reddit's public JSON API (no auth required, but rate-limited).
 * Gracefully handles 429 / unavailability.
 */
export async function collectReddit(projectName) {
  const fallback = createEmptyRedditResult(projectName);

  try {
    const url = `${REDDIT_SEARCH_URL}?q=${encodeURIComponent(projectName + ' crypto')}&sort=new&limit=25&t=week`;
    // Reddit JSON endpoint — use a browser-like UA to reduce 429 probability
    const data = await fetchJson(url, {
      timeoutMs: 10000,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; AlphaScanner/1.0; research bot)',
      },
    });

    const posts = data?.data?.children;
    if (!Array.isArray(posts) || posts.length === 0) {
      return { ...fallback, post_count: 0, error: null };
    }

    const subredditCounts = new Map();
    const sentimentCounts = { bullish: 0, bearish: 0, neutral: 0 };
    const topPosts = [];

    for (const child of posts) {
      const post = child?.data;
      if (!post) continue;

      const title = post.title || '';
      const subreddit = post.subreddit || 'unknown';

      subredditCounts.set(subreddit, (subredditCounts.get(subreddit) || 0) + 1);

      const sentiment = classifySentiment(title);
      sentimentCounts[sentiment] += 1;

      if (topPosts.length < 5) {
        topPosts.push({
          title,
          subreddit,
          score: post.score ?? 0,
          url: post.url || null,
          created_utc: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
        });
      }
    }

    // Overall sentiment by majority
    const { bullish, bearish, neutral } = sentimentCounts;
    let overallSentiment = 'neutral';
    if (bullish > bearish && bullish >= neutral) overallSentiment = 'bullish';
    else if (bearish > bullish && bearish >= neutral) overallSentiment = 'bearish';

    // Top subreddits by mention count
    const subreddits = [...subredditCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    return {
      ...fallback,
      post_count: posts.length,
      subreddits,
      sentiment: overallSentiment,
      sentiment_counts: sentimentCounts,
      top_posts: topPosts,
      error: null,
    };
  } catch (error) {
    // Reddit 429s are common — treat gracefully
    const isRateLimit = error.message?.includes('429');
    return {
      ...fallback,
      error: isRateLimit
        ? 'Reddit rate limited (429) — skipped'
        : error.name === 'AbortError'
          ? 'Reddit timeout'
          : error.message,
    };
  }
}
