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
    // Round 237 (AutoResearch nightly): upvote-weighted sentiment
    // Posts with more upvotes represent stronger community signal
    const sentimentCounts = { bullish: 0, bearish: 0, neutral: 0 };
    const upvoteWeightedCounts = { bullish: 0, bearish: 0, neutral: 0 };
    const topPosts = [];
    let totalUpvotes = 0;
    let recencyScore = 0; // higher = more recent posts

    const now = Math.floor(Date.now() / 1000);

    for (const child of posts) {
      const post = child?.data;
      if (!post) continue;

      const title = post.title || '';
      const subreddit = post.subreddit || 'unknown';
      const postScore = Math.max(0, post.score ?? 0);
      const upvoteWeight = Math.log10(postScore + 2); // log scale so viral posts don't dominate

      subredditCounts.set(subreddit, (subredditCounts.get(subreddit) || 0) + 1);

      const sentiment = classifySentiment(title);
      sentimentCounts[sentiment] += 1;
      upvoteWeightedCounts[sentiment] += upvoteWeight;
      totalUpvotes += postScore;

      // Recency: posts from last 24h contribute more
      const ageHours = (now - (post.created_utc ?? now)) / 3600;
      if (ageHours < 24) recencyScore += 1;
      else if (ageHours < 72) recencyScore += 0.5;

      if (topPosts.length < 5) {
        topPosts.push({
          title,
          subreddit,
          score: postScore,
          url: post.url || null,
          created_utc: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
        });
      }
    }

    // Overall sentiment: blend raw counts (60%) with upvote-weighted (40%)
    const blendedBullish = sentimentCounts.bullish * 0.6 + upvoteWeightedCounts.bullish * 0.4;
    const blendedBearish = sentimentCounts.bearish * 0.6 + upvoteWeightedCounts.bearish * 0.4;
    const blendedNeutral = sentimentCounts.neutral * 0.6 + upvoteWeightedCounts.neutral * 0.4;
    let overallSentiment = 'neutral';
    if (blendedBullish > blendedBearish && blendedBullish >= blendedNeutral) overallSentiment = 'bullish';
    else if (blendedBearish > blendedBullish && blendedBearish >= blendedNeutral) overallSentiment = 'bearish';

    // Top subreddits by mention count
    const subreddits = [...subredditCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    // Round 237b: reddit_activity_score (0-100)
    const redditActivityScore = (() => {
      const postScore = Math.min(40, posts.length * 4);           // 0-40: up to 10 posts
      const upvoteScore = Math.min(30, Math.log10(totalUpvotes + 1) * 10); // 0-30
      const recencyBonus = Math.min(20, recencyScore * 5);        // 0-20
      const divScore = Math.min(10, subreddits.length * 3);       // 0-10: diversity
      return Math.round(postScore + upvoteScore + recencyBonus + divScore);
    })();

    return {
      ...fallback,
      post_count: posts.length,
      subreddits,
      sentiment: overallSentiment,
      sentiment_counts: sentimentCounts,
      upvote_weighted_sentiment: {
        bullish: parseFloat(upvoteWeightedCounts.bullish.toFixed(2)),
        bearish: parseFloat(upvoteWeightedCounts.bearish.toFixed(2)),
        neutral: parseFloat(upvoteWeightedCounts.neutral.toFixed(2)),
      },
      total_upvotes: totalUpvotes,
      reddit_activity_score: redditActivityScore,
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
