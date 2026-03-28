const BULLISH_KEYWORDS = [
  'bullish', 'breakout', 'surge', 'growth', 'adoption', 'upside', 'momentum',
  'accumulate', 'outperform', 'partnership', 'launch', 'integration', 'staking',
  'airdrop', 'undervalued', 'gem', 'opportunity', 'rally', 'ath',
  // Round 1: expanded bullish vocabulary
  'upgrade', 'mainnet', 'milestone', 'record', 'volume', 'inflow', 'tvl growth',
  'ecosystem', 'grant', 'v2', 'v3', 'institutional', 'demand', 'whale buy',
  // Round R9: 2025 narrative-driven bullish signals
  'etf approval', 'spot etf', 'restaking', 'real world asset', 'rwa', 'tokenization',
  'ai agent', 'depin', 'sovereign wealth', 'strategic reserve', 'nation state',
  'treasury allocation', 'buyback', 'revenue share', 'fee switch', 'hyperliquid',
  'superchain', 'layer 2 expansion', 'chain abstraction', 'intents', 'solvers',
  // Round R10 (AutoResearch nightly): 2026 emerging narratives
  'btc treasury', 'bitcoin reserve', 'stablecoin bill', 'tokenized equity', 'tokenized bonds',
  'ai inference', 'agent economy', 'on-chain ai', 'decentralized ai', 'zkml',
  'modular blockchain', 'based rollup', 'preconfirmation', 'sequencer auction',
  'parallel evm', 'appchain', 'gas abstraction', 'account abstraction',
  'liquid restaking', 'lrt', 'erc-4337', 'eip-7702', 'validator sets',
  'paymaster', 'bundler', 'social graph', 'farcaster', 'lens protocol',
  // Round 590 (AutoResearch batch): Q1-Q2 2026 alpha-driving narratives
  'token burn', 'deflationary', 'supply reduction', 'halving effect',
  'hyperscaler', 'sovereign ai', 'ai compute', 'gpu cluster', 'inference network',
  'protocol revenue', 'revenue milestone', 'profitable protocol',
  'onchain orderbook', 'fully onchain', 'permissionless',
  'cross-chain liquidity', 'unified liquidity', 'omnichain',
  'consumer crypto', 'mass adoption', 'mainstream',
  'institutional custody', 'prime brokerage', 'cleared derivatives',
  'autonomous agent', 'agent-to-agent', 'agentic', 'multi-agent',
];
const BEARISH_KEYWORDS = [
  'bearish', 'selloff', 'dump', 'decline', 'risk', 'downside', 'lawsuit',
  'exploit', 'headwinds', 'rug', 'scam', 'hack', 'depegged', 'insolvent',
  'bankruptcy', 'exit', 'dead', 'failed', 'abandoned', 'delisted',
  // Round 1: expanded bearish vocabulary
  'outflow', 'bridge hack', 'vulnerability', 'exploit', 'shutdown', 'delisting',
  'regulatory', 'ban', 'conviction', 'fraud', 'ponzi', 'exit liquidity',
  // Round R8: new threat patterns (2025 crypto threat landscape)
  'sec subpoena', 'doj investigation', 'emergency pause', 'oracle manipulation',
  'flash loan attack', 'governance attack', 'admin key', 'multisig compromise',
  'infinite mint', 'drain', 'stolen funds', 'protocol exploit', 'critical bug',
  'mass exodus', 'whale dump', 'token unlock', 'vesting cliff',
  // Round R10 (AutoResearch nightly): 2026 threat patterns
  'sandwich attack', 'mev exploit', 'maximal extractable value attack', 'front-run',
  'nonce manipulation', 'price manipulation', 'liquidity removal', 'liquidity drain',
  'emergency withdrawal', 'protocol pause', 'circuit breaker triggered', 'depeg risk',
  'contagion', 'counterparty risk', 'insolvency risk', 'treasury depleted',
  // Round 591 (AutoResearch batch): 2026 emerging threat signals
  'token unlock cliff', 'large unlock', 'massive unlock', 'insider selling',
  'team selloff', 'vc dump', 'investor vesting', 'cliff unlock',
  'smart contract bug', 'critical vulnerability', 'zero day exploit',
  'regulatory seizure', 'ofac sanctions', 'blacklisted', 'frozen funds',
  'governance takeover', 'governance exploit', 'vote manipulation',
  'sybil attack', 'bribery attack', 'validator bribe', 'centralized sequencer',
  'mass liquidation', 'cascade liquidation', 'undercollateralized',
];
const NEUTRAL_KEYWORDS = ['neutral', 'mixed', 'sideways', 'watchlist', 'monitor', 'range', 'unclear', 'consolidation'];

// Round 1: High-trust news domains (bonus signal quality)
const TRUSTED_DOMAINS = new Set([
  'coindesk.com', 'cointelegraph.com', 'theblock.co', 'decrypt.co',
  'blockworks.co', 'dlnews.com', 'cryptobriefing.com', 'messari.io',
  'defipulse.com', 'rekt.news', 'delphi.digital', 'galaxy.com',
  // Round R7: expanded high-trust crypto domains
  'unchainedcrypto.com', 'bankless.com', 'defiant.io', 'protos.com',
  'restofworld.org', 'ft.com', 'reuters.com', 'bloomberg.com', 'wsj.com',
  'wired.com', 'techcrunch.com', 'forbes.com', 'fortune.com',
  'a16zcrypto.com', 'paradigm.xyz', 'multicoin.capital',
  'coinmetrics.io', 'glassnode.com', 'dune.com', 'nansen.ai',
  // Round R10 (AutoResearch nightly): additional 2025-2026 high-signal domains
  'beincrypto.com', 'cryptoslate.com', 'crypto.news', 'ambcrypto.com',
  'zerion.io', 'tokenterminal.com', 'artemis.xyz', 'defillama.com',
  'ethresear.ch', 'research.lido.fi', 'forum.arbitrum.foundation', 'gov.uniswap.org',
  'mirror.xyz', 'substack.com',
  // Round 80 (AutoResearch): 2026 high-signal domain additions
  'unchained.com', 'thedefiant.io', 'research.binance.com', 'dragonfly.xyz',
  'panteracapital.com', 'chainalysis.com', 'kaito.ai', 'arkham.com',
  'dune.com', 'flipside.is', 'intotheblock.com', 'santiment.net',
  'coinbase.com', 'kraken.com', 'blog.uniswap.org', 'medium.com',
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
// Round 700 (AutoResearch batch): Enhanced bot/spam filter patterns
// Added patterns for 2026 common spam: fake airdrops, shill farms, bridge scams, impersonation
const BOT_SIGNAL_PATTERNS = [
  /\bprice prediction\b/i,
  /\b\d+\s*%\s*(gain|profit|return)\s+(guaranteed|sure|certain)\b/i,
  /\b(buy|sell)\s+(before|now|immediately)\b/i,
  /\bclick here\b/i,
  /\bdon't miss\b/i,
  /\bexclusive (offer|deal|bonus)\b/i,
  // R700 additions: modern spam patterns
  /\bfree\s+(token|airdrop|giveaway)\b/i,
  /\b(join|claim)\s+(now|today|immediately)\s+and\s+(get|earn|receive)\b/i,
  /\bwhatsapp\s+group\b/i,
  /\btelegram\s+(group|channel)\s+(link|join)\b/i,
  /\b(100x|1000x)\s+(guaranteed|confirmed|sure)\b/i,
  /\bpump\s+(incoming|confirmed|alert)\b/i,
  /\b(sent|send)\s+\d+\s+(eth|btc|sol|usdt)\s+to\s+get\b/i, // classic doubling scam
  /\bvisit\s+our\s+(website|channel|group)\b/i,
  /\bpromo\s*code\b/i,
  /\bsponsor(ed)?\s+(content|post|article)\b/i,
  /\baffiliate\s+(link|discount)\b/i,
  /\bnot\s+financial\s+advice.{0,30}buy\b/i, // "not financial advice" immediately followed by buy = shill
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
      // Round 154 (AutoResearch): governance and roadmap signals
      `${projectName} governance proposal OR roadmap OR upgrade OR mainnet 2026`,
      // Round 238 (AutoResearch): airdrop and listing signals — high-alpha catalyst queries
      `${projectName} airdrop OR listing OR coinbase OR binance 2026`,
    ];
    const settled = await Promise.allSettled(queries.map((query) => exaService.exaSearch(query)));
    const items = settled
      .filter((entry) => entry.status === 'fulfilled')
      .flatMap((entry) => entry.value?.results || []);

    const rawItems = [];
    const seen = new Set();
    // Round 553 (AutoResearch): also dedup by normalized title prefix (first 60 chars)
    // Syndicated content appears on multiple domains with identical or near-identical titles
    // Without title dedup, the same news story inflates mention counts and sentiment
    const seenTitles = new Set();

    for (const item of items) {
      const normalizedTitle = normalizeToken(item?.title || '');
      const urlKey = item?.url || `${normalizedTitle}-${item?.publishedDate || ''}`;
      if (!urlKey || seen.has(urlKey)) continue;
      // Title dedup: use first 50 chars of normalized title as fingerprint
      const titleKey = normalizedTitle.slice(0, 50);
      if (titleKey && titleKey.length > 10 && seenTitles.has(titleKey)) continue;
      seen.add(urlKey);
      if (titleKey && titleKey.length > 10) seenTitles.add(titleKey);
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

    // Round 237 (AutoResearch nightly): competitor_content_ratio — fraction of articles that are
    // primarily about competitors rather than this project. High ratio = project is mentioned in
    // competitor context (possibly bearish or irrelevant coverage).
    const COMPETITOR_FRAMING_PATTERNS = [
      /\b(better than|superior to|alternative to|instead of|replacing|beats|outperforms)\b/i,
      /\b(competitor|rival|vs\.|versus)\s+[\w]+/i,
    ];
    const competitorContentCount = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`;
      return COMPETITOR_FRAMING_PATTERNS.some((p) => p.test(text));
    }).length;
    const competitorContentRatio = uniqueNews.length > 0
      ? parseFloat((competitorContentCount / uniqueNews.length).toFixed(3))
      : null;

    // Round 41: detect regulatory mentions (risk signal)
    const regulatoryMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /regulatory|sec|cftc|ban|comply|compliance|lawsuit|fine|sanction|seizure/.test(text);
    }).length;

    // Round 9 (AutoResearch batch): partnership mentions (positive catalyst)
    const partnershipMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /partnership|integration|collaboration|joins|adopts|announced.*with|working.*with|listing|deployed.*on/.test(text);
    }).length;

    // Round 9 (AutoResearch batch): upgrade/mainnet/launch mentions (catalyst signal)
    const upgradeMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /\bv[2-9]\b|v\d+\.\d+|mainnet|launch|upgrade|update|migration|live on|goes live|deployed/.test(text);
    }).length;

    // Round 154 (AutoResearch): governance/proposal mentions — community activity signal
    const governanceMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /governance|proposal|vote|dao|snapshot|forum|improvement|onchain.*gov|protocol.*change/.test(text);
    }).length;

    // Round 236 (AutoResearch): competitor comparison mentions — how often does community compare this project?
    // High comparison mentions = project is considered a relevant player in its category
    const competitorComparisonMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /\bvs\b|\bversus\b|compared to|alternative to|better than|rival|competitor|challenge|compete/.test(text);
    }).length;

    // Round 236 (AutoResearch): listing_mentions — new exchange/protocol listing signals
    const listingMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /\blisting\b|\blisted\b|coinbase|binance|kraken|bybit|okx|kucoin|added to|now on/.test(text);
    }).length;

    // Round 238 (AutoResearch): airdrop_mentions — high airdrop coverage = potential demand driver
    const airdropMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /\bairdrop\b|airdropping|token distribution|claim\b|eligible holders/.test(text);
    }).length;

    // Round 238 (AutoResearch): hack_exploit_mentions — critical security signal
    const hackExploitMentions = uniqueNews.filter((item) => {
      const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
      return /\bhack\b|\bexploit\b|stolen|drained|compromised|bridge.*attack|attack.*bridge|rugpull/.test(text);
    }).length;

    // Round 9 (AutoResearch batch): sentiment dominance — are bulls clearly in control?
    const sentimentDominance = totalSentiment > 0
      ? Math.max(sentimentCounts.bullish, sentimentCounts.bearish, sentimentCounts.neutral) / totalSentiment
      : null;

    // Round 213 (AutoResearch): avg_article_quality_score — mean domain trust score of all articles
    const avgArticleQualityScore = (() => {
      if (uniqueNews.length === 0) return null;
      const total = uniqueNews.reduce((sum, item) => sum + getDomainTrustScore(item.url), 0);
      return parseFloat((total / uniqueNews.length).toFixed(3));
    })();

    // Round 574/575/576 (AutoResearch): source diversity metrics
    const uniqueDomains = new Set(
      uniqueNews
        .map((item) => {
          try { return item.url ? new URL(item.url).hostname.replace(/^www\./, '') : null; } catch { return null; }
        })
        .filter(Boolean)
    );
    const sourceDiversityCount = uniqueDomains.size;
    const sourceDiversityScore = uniqueNews.length > 0
      ? Math.min(100, Math.round((sourceDiversityCount / Math.min(uniqueNews.length, 8)) * 100))
      : 0;
    const recentTrustedSourceCount = uniqueNews.filter((item) => {
      const ts = new Date(item.date || 0).getTime();
      return ts > Date.now() - 3 * 24 * 60 * 60 * 1000 && getDomainTrustScore(item.url) >= 1.4;
    }).length;

    // Round 12 (AutoResearch nightly): recent news momentum — more news in last 3 days vs full window
    const now = Date.now();
    const recentCutoff3d = now - 3 * 24 * 60 * 60 * 1000;
    const veryRecentCount = uniqueNews.filter((item) => new Date(item.date || 0).getTime() > recentCutoff3d).length;
    const newsMomentum = uniqueNews.length > 0
      ? (veryRecentCount / uniqueNews.length > 0.5 ? 'accelerating' : veryRecentCount > 0 ? 'steady' : 'declining')
      : 'no_data';

    // Round 233 (AutoResearch nightly): sentiment_credibility_score (0-100)
    // Combines: article count, domain trust, recency, sentiment dominance, signal quality (no-bot ratio)
    const sentimentCredibility = (() => {
      if (uniqueNews.length === 0) return 0;
      const countScore = Math.min(30, uniqueNews.length * 3);          // 0-30: up to 10 articles max out
      const qualityScore = (avgArticleQualityScore ?? 1.0) >= 1.3 ? 25  // high-trust domains
        : (avgArticleQualityScore ?? 1.0) >= 1.1 ? 15 : 8;              // 0-25
      const recencyScore = veryRecentCount > 0 ? Math.min(25, veryRecentCount * 8) : 0; // 0-25
      const dominanceScore = sentimentDominance != null ? Math.round(sentimentDominance * 20) : 10; // 0-20
      const botPenalty = rawItems.length > 0 ? Math.round((botFilteredCount / rawItems.length) * 20) : 0;
      return Math.max(0, Math.min(100, countScore + qualityScore + recencyScore + dominanceScore - botPenalty));
    })();

    // Round 233 (AutoResearch nightly): bot_ratio — fraction of items flagged as spam
    const botRatio = rawItems.length > 0
      ? parseFloat((botFilteredCount / rawItems.length).toFixed(3))
      : 0;

    return {
      ...fallback,
      mentions: rawItems.length,
      filtered_mentions: uniqueNews.length,
      bot_filtered_count: botFilteredCount,
      sentiment: decideSentiment(sentimentCounts),
      sentiment_score: Math.round(sentimentScore * 100) / 100,
      sentiment_counts: sentimentCounts,
      sentiment_dominance: sentimentDominance != null ? Math.round(sentimentDominance * 100) / 100 : null,
      key_narratives: extractNarratives(uniqueNews, projectName),
      // FIX (28 Mar 2026): Store full news items for LLM news analyst (needs highlights for context)
      _raw_news: uniqueNews.slice(0, 15).map(({ title, url, date, highlights }) => ({
        title, url, date, highlights: (highlights || []).slice(0, 3),
      })),
      recent_news: recentNews,
      unlock_mentions: unlockMentions,
      exploit_mentions: exploitMentions,
      institutional_mentions: institutionalMentions,
      regulatory_mentions: regulatoryMentions,
      partnership_mentions: partnershipMentions,
      upgrade_mentions: upgradeMentions,
      governance_mentions: governanceMentions,
      competitor_comparison_mentions: competitorComparisonMentions,
      listing_mentions: listingMentions,
      airdrop_mentions: airdropMentions,
      hack_exploit_mentions: hackExploitMentions,
      avg_article_quality_score: avgArticleQualityScore,
      source_diversity_count: sourceDiversityCount,
      source_diversity_score: sourceDiversityScore,
      recent_trusted_source_count: recentTrustedSourceCount,
      // Round 12 (AutoResearch nightly): news recency signals
      very_recent_news_count: veryRecentCount,
      news_momentum: newsMomentum,
      // Round 233 (AutoResearch nightly): signal quality metrics
      sentiment_credibility_score: sentimentCredibility,
      bot_ratio: botRatio,
      competitor_content_ratio: competitorContentRatio,
      // Round 381 (AutoResearch): narrative_freshness_score — measures what fraction of narratives
      // are driven by very recent news (last 3 days). High freshness = active, fast-moving story.
      // Used by scoring to weight social momentum more heavily when narratives are fresh.
      narrative_freshness_score: (() => {
        if (uniqueNews.length === 0) return 0;
        // Articles from last 3 days that contain narrative tokens
        const narrativeTokens = extractNarratives(uniqueNews, projectName);
        if (narrativeTokens.length === 0) return 0;
        const freshWithNarrative = uniqueNews.filter((item) => {
          const ageMs = now - new Date(item.date || 0).getTime();
          if (ageMs > 3 * 24 * 60 * 60 * 1000) return false;
          const text = `${item.title} ${item.highlights.join(' ')}`.toLowerCase();
          return narrativeTokens.some((tok) => text.includes(tok));
        }).length;
        return Math.round((freshWithNarrative / Math.min(uniqueNews.length, 10)) * 100);
      })(),
      // Round 383 (AutoResearch): top_tier_source_count — count of articles from Tier-1 sources
      // Tier-1 = TRUSTED_DOMAINS set with score 1.4 (Bloomberg, CoinDesk, TheBlock, Blockworks, etc.)
      // Separates "many articles" from "many high-quality articles" — better signal-to-noise metric
      top_tier_source_count: (() => {
        if (uniqueNews.length === 0) return 0;
        return uniqueNews.filter((item) => getDomainTrustScore(item.url) >= 1.4).length;
      })(),
      // Round 383 (AutoResearch): subreddit_quality — qualitative tier for reddit signal if integrated
      // Reflects quality of subreddit discussion (main crypto subreddits vs niche/new ones)
      // Currently set to null here (computed by reddit collector) — placeholder for cross-collector integration
      subreddit_quality: null, // populated by reddit collector override in routes/alpha.js if available
      // Round 192 (AutoResearch): more informative error — report failure count and first error message
      error: (() => {
        const failed = settled.filter((e) => e.status === 'rejected');
        if (failed.length === 0) return null;
        if (failed.length === settled.length) {
          const firstMsg = failed[0]?.reason?.message || 'unknown';
          return `All ${failed.length} Exa queries failed (e.g. ${firstMsg})`;
        }
        return `${failed.length}/${settled.length} Exa queries failed (partial data)`;
      })(),
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.message,
    };
  }
}
