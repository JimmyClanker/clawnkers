import { fetchJson } from './fetch.js';
import { safeNumber } from '../utils/math.js';

const COINGECKO_SEARCH_URL = 'https://api.coingecko.com/api/v3/search';
const COINGECKO_COIN_URL = 'https://api.coingecko.com/api/v3/coins';
const COINGECKO_TRENDING_URL = 'https://api.coingecko.com/api/v3/search/trending';
const COINGECKO_TICKERS_URL = 'https://api.coingecko.com/api/v3/coins';
// Round R5: Global market context — BTC dominance & total market cap
const COINGECKO_GLOBAL_URL = 'https://api.coingecko.com/api/v3/global';

function sanitizeFinite(value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, decimals = null } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  if (typeof decimals === 'number') return parseFloat(num.toFixed(decimals));
  return num;
}

function sanitizePositive(value, decimals = null) {
  return sanitizeFinite(value, { min: Number.MIN_VALUE, decimals });
}

function sanitizeNonNegative(value, decimals = null) {
  return sanitizeFinite(value, { min: 0, decimals });
}

function sanitizePct(value, { min = -100, max = 1000000, decimals = 2 } = {}) {
  return sanitizeFinite(value, { min, max, decimals });
}

function createEmptyMarketResult(projectName) {
  return {
    project_name: projectName,
    coin_id: null,
    symbol: null,
    name: null,
    price: null,
    market_cap: null,
    fully_diluted_valuation: null,
    fully_diluted_to_market_cap_ratio: null,
    market_cap_fdv_gap_usd: null,
    total_volume: null,
    circulating_supply: null,
    total_supply: null,
    max_supply: null,
    price_change_pct_1h: null,
    price_change_pct_24h: null,
    price_change_pct_7d: null,
    price_change_pct_30d: null,
    ath: null,
    ath_date: null,
    ath_distance_pct: null,
    atl: null,
    atl_date: null,
    atl_distance_pct: null,
    price_range_position: null, // 0 = at ATL, 1 = at ATH
    // Supply metrics
    circulating_to_max_ratio: null,
    // Volume metrics
    volume_to_mcap_ratio: null,
    // Market rank
    market_cap_rank: null,
    twitter_followers: null,
    telegram_channel_user_count: null,
    reddit_subscribers: null,
    facebook_likes: null,
    // Round 2: trending + categories
    is_trending: false,
    categories: [],
    genesis_date: null,
    // Round 3: extended price change periods
    price_change_pct_14d: null,
    price_change_pct_60d: null,
    price_change_pct_200d: null,
    price_change_pct_1y: null,
    // Round 9: exchange listing counts
    exchange_count: null,
    cex_count: null,
    dex_count: null,
    market_pair_count: null,
    cex_pair_count: null,
    dex_pair_count: null,
    cex_volume_pct: null,
    anomalous_ticker_count: null,
    stale_ticker_count: null,
    trust_score_avg: null,
    top_exchanges: [],
    // Round 2 ext: multi-TF momentum classification
    price_momentum_tier: null,
    // Round R1: 7-day average volume for anomaly detection
    volume_7d_avg: null,
    platforms: null,
    last_updated: null,
    last_updated_age_minutes: null,
    // Round R4: stablecoin flag propagated from scoring for downstream checks
    is_stablecoin: false,
    error: null,
  };
}

export async function collectMarket(projectName) {
  const fallback = createEmptyMarketResult(projectName);

  try {
    const searchUrl = `${COINGECKO_SEARCH_URL}?query=${encodeURIComponent(projectName)}`;
    const searchData = await fetchJson(searchUrl);
    const firstCoin = searchData?.coins?.[0];

    if (!firstCoin?.id) {
      return {
        ...fallback,
        error: 'CoinGecko coin not found',
      };
    }

    // Round 541 (AutoResearch): enable developer_data to extract GitHub commit activity and repo count
    // CoinGecko provides this for free; useful to cross-check our GitHub collector
    const coinUrl = `${COINGECKO_COIN_URL}/${encodeURIComponent(firstCoin.id)}?localization=false&tickers=false&community_data=true&developer_data=true&sparkline=true&price_change_percentage=1h%2C24h%2C7d%2C14d%2C30d%2C60d%2C200d%2C1y`;
    const chartUrl = `${COINGECKO_COIN_URL}/${encodeURIComponent(firstCoin.id)}/market_chart?vs_currency=usd&days=90&interval=daily`;
    const [coinData, trendingData, tickersData, chartData, globalData] = await Promise.allSettled([
      fetchJson(coinUrl),
      fetchJson(COINGECKO_TRENDING_URL),
      fetchJson(`${COINGECKO_TICKERS_URL}/${encodeURIComponent(firstCoin.id)}/tickers?per_page=100`),
      fetchJson(chartUrl),
      fetchJson(COINGECKO_GLOBAL_URL),
    ]).then((results) => results.map((r) => (r.status === 'fulfilled' ? r.value : null)));
    const marketData = coinData?.market_data || {};
    const communityData = coinData?.community_data || {};
    // Round 541 (AutoResearch): developer_data from CoinGecko — free cross-check of GitHub activity
    const developerData = coinData?.developer_data || {};

    if (!coinData?.id || !coinData?.market_data) {
      return {
        ...fallback,
        coin_id: firstCoin.id,
        symbol: firstCoin.symbol || null,
        name: firstCoin.name || projectName,
        error: `CoinGecko coin payload incomplete for ${firstCoin.id}`,
      };
    }

    // Round 551 (AutoResearch): sanitize raw CoinGecko values — guard against impossible/negative values
    // CoinGecko occasionally returns negative or zero prices for newly listed tokens or data errors
    const price = sanitizePositive(marketData?.current_price?.usd, 12);
    const ath = sanitizePositive(marketData?.ath?.usd, 12);
    const atl = sanitizePositive(marketData?.atl?.usd, 12);
    const marketCap = sanitizeNonNegative(marketData?.market_cap?.usd);
    const fullyDilutedValuation = sanitizeNonNegative(marketData?.fully_diluted_valuation?.usd);
    const totalVolume = sanitizeNonNegative(marketData?.total_volume?.usd);
    const circulatingSupply = sanitizePositive(marketData?.circulating_supply);
    const maxSupply = sanitizePositive(marketData?.max_supply);
    const totalSupply = sanitizePositive(marketData?.total_supply);

    // Derived enrichment metrics
    // Round 533 (AutoResearch): wrap all derived metrics in isFinite guards to prevent NaN propagation
    const athDistancePct = (() => {
      if (price == null || ath == null || ath <= 0) return null;
      const pct = ((price - ath) / ath) * 100;
      return Number.isFinite(pct) ? parseFloat(pct.toFixed(2)) : null;
    })();
    const atlDistancePct = (() => {
      if (price == null || atl == null || atl <= 0 || price <= atl) return null;
      const pct = ((price - atl) / atl) * 100;
      return Number.isFinite(pct) ? parseFloat(pct.toFixed(2)) : null;
    })();
    const circulatingToMaxRatio = (() => {
      const denom = Number(maxSupply || totalSupply || 0);
      if (circulatingSupply == null || denom <= 0) return null;
      const ratio = circulatingSupply / denom;
      return Number.isFinite(ratio) ? parseFloat(Math.min(ratio, 1).toFixed(4)) : null;
    })();
    const volumeToMcapRatio = (() => {
      if (totalVolume == null || marketCap == null || marketCap <= 0) return null;
      const ratio = totalVolume / marketCap;
      return Number.isFinite(ratio) ? parseFloat(ratio.toFixed(6)) : null;
    })();
    // Round 9: price range position (0 = at ATL, 1 = at ATH)
    const priceRangePosition = (price != null && ath != null && atl != null && ath > atl)
      ? Math.max(0, Math.min(1, (price - atl) / (ath - atl)))
      : null;

    // Round 2: trending check
    const trendingCoins = trendingData?.coins || [];
    const isTrending = trendingCoins.some(
      (entry) => entry?.item?.id === (coinData?.id || firstCoin.id)
    );
    const categories = Array.isArray(coinData?.categories) ? coinData.categories : [];
    const genesisDate = coinData?.genesis_date ?? null;

    // Round 2 (extended): price momentum tier — classify multi-timeframe trend
    // Round 535 (AutoResearch): guard NaN/null in raw API values before comparison
    const p1h  = (() => { const v = Number(marketData?.price_change_percentage_1h_in_currency?.usd); return Number.isFinite(v) ? v : 0; })();
    const p24h = (() => { const v = Number(marketData?.price_change_percentage_24h_in_currency?.usd); return Number.isFinite(v) ? v : 0; })();
    const p7d  = (() => { const v = Number(marketData?.price_change_percentage_7d_in_currency?.usd); return Number.isFinite(v) ? v : 0; })();
    const p30d = (() => { const v = Number(marketData?.price_change_percentage_30d_in_currency?.usd); return Number.isFinite(v) ? v : 0; })();
    const positiveTfs = [p1h, p24h, p7d, p30d].filter((c) => c > 0).length;
    let priceMomentumTier;
    if (positiveTfs === 4) priceMomentumTier = 'strong_uptrend';
    else if (positiveTfs === 3) priceMomentumTier = 'uptrend';
    else if (positiveTfs === 2) priceMomentumTier = 'mixed';
    else if (positiveTfs === 1) priceMomentumTier = 'downtrend';
    else priceMomentumTier = 'strong_downtrend';

    // Round 9: exchange listing counts from tickers
    let exchangeCount = null;
    let cexCount = null;
    let dexCount = null;
    let marketPairCount = null;
    let cexPairCount = null;
    let dexPairCount = null;
    let cexVolumePct = null;
    let anomalousTickerCount = null;
    let staleTickerCount = null;
    let trustScoreAvg = null;
    const topExchanges = [];

    if (tickersData?.tickers && Array.isArray(tickersData.tickers)) {
      const tickers = tickersData.tickers;
      const exchangeVolumeMap = new Map();
      let totalCexVol = 0;
      let totalDexVol = 0;
      let trustScorePoints = 0;
      let trustScoreSamples = 0;
      anomalousTickerCount = 0;
      staleTickerCount = 0;
      marketPairCount = tickers.length;
      cexPairCount = 0;
      dexPairCount = 0;

      for (const ticker of tickers) {
        const rawExchangeName = ticker?.market?.name || ticker?.market?.identifier || 'unknown';
        const exchangeName = String(rawExchangeName).trim().replace(/\s+/g, ' ');
        const isDex = /uniswap|curve|sushi|pancake|balancer|1inch|dydx|osmosis|jupiter|raydium|orca|serum|camelot|aerodrome|velodrome/i.test(exchangeName);
        const vol = sanitizeNonNegative(ticker?.converted_volume?.usd) ?? 0;
        const trustLabel = String(ticker?.trust_score || '').toLowerCase();
        if (trustLabel === 'green') { trustScorePoints += 3; trustScoreSamples += 1; }
        else if (trustLabel === 'yellow') { trustScorePoints += 2; trustScoreSamples += 1; }
        else if (trustLabel === 'red') { trustScorePoints += 1; trustScoreSamples += 1; }

        if (ticker?.is_anomaly) anomalousTickerCount += 1;
        if (ticker?.is_stale) staleTickerCount += 1;
        if (isDex) dexPairCount += 1;
        else cexPairCount += 1;

        if (!exchangeVolumeMap.has(exchangeName)) {
          exchangeVolumeMap.set(exchangeName, { vol: 0, isDex });
        }
        exchangeVolumeMap.get(exchangeName).vol += vol;

        if (isDex) totalDexVol += vol;
        else totalCexVol += vol;
      }

      // Unique exchange names
      exchangeCount = exchangeVolumeMap.size;
      cexCount = [...exchangeVolumeMap.values()].filter((e) => !e.isDex).length;
      dexCount = [...exchangeVolumeMap.values()].filter((e) => e.isDex).length;

      const totalVol = totalCexVol + totalDexVol;
      cexVolumePct = totalVol > 0 ? (totalCexVol / totalVol) * 100 : null;
      trustScoreAvg = trustScoreSamples > 0 ? parseFloat((trustScorePoints / trustScoreSamples).toFixed(2)) : null;

      // Top 5 exchanges by volume
      const sorted = [...exchangeVolumeMap.entries()]
        .filter(([name]) => name && name !== 'unknown')
        .sort((a, b) => b[1].vol - a[1].vol)
        .slice(0, 5)
        .map(([name]) => name);
      topExchanges.push(...sorted);
    }

    return {
      ...fallback,
      coin_id: coinData?.id || firstCoin.id || null,
      symbol: coinData?.symbol || firstCoin.symbol || null,
      name: coinData?.name || firstCoin.name || projectName,
      price,
      current_price: price, // Round 8 (AutoResearch batch): alias for cross-collector consistency
      market_cap: marketCap,
      fully_diluted_valuation: fullyDilutedValuation,
      fully_diluted_to_market_cap_ratio: (() => {
        if (fullyDilutedValuation == null || marketCap == null || marketCap <= 0) return null;
        return parseFloat((fullyDilutedValuation / marketCap).toFixed(3));
      })(),
      market_cap_fdv_gap_usd: (() => {
        if (fullyDilutedValuation == null || marketCap == null) return null;
        return sanitizeNonNegative(fullyDilutedValuation - marketCap);
      })(),
      total_volume: totalVolume,
      circulating_supply: circulatingSupply,
      total_supply: totalSupply,
      max_supply: maxSupply,
      price_change_pct_1h: sanitizePct(marketData?.price_change_percentage_1h_in_currency?.usd, { min: -100, max: 100000, decimals: 2 }),
      price_change_pct_24h: sanitizePct(marketData?.price_change_percentage_24h_in_currency?.usd, { min: -100, max: 100000, decimals: 2 }),
      price_change_pct_7d: sanitizePct(marketData?.price_change_percentage_7d_in_currency?.usd, { min: -100, max: 100000, decimals: 2 }),
      price_change_pct_30d: sanitizePct(marketData?.price_change_percentage_30d_in_currency?.usd, { min: -100, max: 100000, decimals: 2 }),
      // Round 3: extended price change periods
      price_change_pct_14d: sanitizePct(marketData?.price_change_percentage_14d_in_currency?.usd, { min: -100, max: 250000, decimals: 2 }),
      price_change_pct_60d: sanitizePct(marketData?.price_change_percentage_60d_in_currency?.usd, { min: -100, max: 500000, decimals: 2 }),
      price_change_pct_200d: sanitizePct(marketData?.price_change_percentage_200d_in_currency?.usd, { min: -100, max: 1000000, decimals: 2 }),
      price_change_pct_1y: sanitizePct(marketData?.price_change_percentage_1y_in_currency?.usd, { min: -100, max: 1000000, decimals: 2 }),
      // Round 236 (AutoResearch): 52-week high/low from 90-day + 1y price change
      // Derived: 52w_high = price / (1 + price_change_pct_1y/100), 52w_low from ATL heuristic
      // Enables "price vs 52-week range" which is a key institutional signal
      price_vs_52w: (() => {
        const p = price;
        const p1y = marketData?.price_change_percentage_1y_in_currency?.usd;
        if (p == null || p1y == null) return null;
        const high52w = p / (1 + Number(p1y) / 100);
        if (!Number.isFinite(high52w) || high52w <= 0) return null;
        const pct_from_high = ((p - high52w) / high52w) * 100;
        const tier = pct_from_high > -10 ? 'near_high' : pct_from_high > -30 ? 'mid_range' : pct_from_high > -60 ? 'below_mid' : 'near_low';
        return {
          high_52w: parseFloat(high52w.toFixed(6)),
          pct_from_52w_high: parseFloat(pct_from_high.toFixed(2)),
          tier,
        };
      })(),
      // Round 197 (AutoResearch): 90-day price change from 90-day chart history (first vs last price)
      // More accurate than a weighted average heuristic — uses actual chart data when available
      price_change_pct_90d: (() => {
        const prices = (chartData?.prices || []).map(([, p]) => Number(p)).filter(Number.isFinite);
        if (prices.length >= 2) {
          const first = prices[0];
          const last = prices[prices.length - 1];
          if (first > 0) {
            const change = ((last - first) / first) * 100;
            return Number.isFinite(change) ? parseFloat(change.toFixed(2)) : null;
          }
        }
        // Fallback: weighted blend of 60d and 200d if chart not available
        const c60 = marketData?.price_change_percentage_60d_in_currency?.usd;
        const c200 = marketData?.price_change_percentage_200d_in_currency?.usd;
        if (c60 != null && c200 != null) return parseFloat(((Number(c60) * 0.6 + Number(c200) * 0.4)).toFixed(2));
        return null;
      })(),
      ath,
      ath_date: marketData?.ath_date?.usd ?? null,
      ath_distance_pct: athDistancePct,
      atl,
      atl_date: marketData?.atl_date?.usd ?? null,
      atl_distance_pct: atlDistancePct != null ? Math.round(atlDistancePct * 100) / 100 : null,
      price_range_position: priceRangePosition != null ? Math.round(priceRangePosition * 1000) / 1000 : null,
      circulating_to_max_ratio: circulatingToMaxRatio,
      // Round 569 (AutoResearch): float_ratio_pct alias — same signal, easier for templates/LLMs to read
      float_ratio_pct: circulatingToMaxRatio,
      volume_to_mcap_ratio: volumeToMcapRatio,
      // Round 568 (AutoResearch): FDV/market-cap ratio — dilution overhang signal
      fdv_to_market_cap_ratio: (() => {
        const fdv = Number(marketData?.fully_diluted_valuation?.usd ?? 0);
        if (!Number.isFinite(fdv) || fdv <= 0 || marketCap == null || marketCap <= 0) return null;
        const ratio = fdv / marketCap;
        return Number.isFinite(ratio) ? parseFloat(ratio.toFixed(3)) : null;
      })(),
      market_cap_rank: coinData?.market_cap_rank ?? null,
      twitter_followers: sanitizeNonNegative(communityData?.twitter_followers),
      telegram_channel_user_count: sanitizeNonNegative(communityData?.telegram_channel_user_count),
      reddit_subscribers: sanitizeNonNegative(communityData?.reddit_subscribers),
      facebook_likes: sanitizeNonNegative(communityData?.facebook_likes),
      // Round 201 (AutoResearch): Reddit subscribers from CoinGecko community data
      reddit_subscribers: communityData?.reddit_subscribers ?? null,
      // Round 227 (AutoResearch): price_momentum_score (0-100) — composite of all timeframes
      // High score = consistently positive momentum across 1h/24h/7d/30d
      price_momentum_score: (() => {
        const changes = [
          { val: marketData?.price_change_percentage_1h_in_currency?.usd, weight: 15 },
          { val: marketData?.price_change_percentage_24h_in_currency?.usd, weight: 25 },
          { val: marketData?.price_change_percentage_7d_in_currency?.usd, weight: 30 },
          { val: marketData?.price_change_percentage_30d_in_currency?.usd, weight: 30 },
        ].filter((c) => c.val != null && Number.isFinite(Number(c.val)));
        if (changes.length === 0) return null;
        const totalWeight = changes.reduce((s, c) => s + c.weight, 0);
        let score = 0;
        for (const { val, weight } of changes) {
          const pct = Number(val);
          // Sigmoid-like: map pct change to 0-1 contribution
          // +20% → 0.9, 0% → 0.5, -20% → 0.1
          const normalized = 1 / (1 + Math.exp(-pct / 15));
          score += normalized * (weight / totalWeight);
        }
        return Math.round(score * 100);
      })(),
      // Round 224 (AutoResearch): coin_age_days — how old is this token/coin?
      coin_age_days: (() => {
        const gDate = coinData?.genesis_date;
        if (!gDate) return null;
        const days = Math.floor((Date.now() - new Date(gDate).getTime()) / 86400000);
        return days >= 0 ? days : null;
      })(),
      // Round 222 (AutoResearch): ATH recency flag — was the ATH set recently?
      // Recent ATH = strong momentum; ATH years ago = long-term underperformance
      ath_recency: (() => {
        const athDate = marketData?.ath_date?.usd;
        if (!athDate) return null;
        const daysSinceAth = (Date.now() - new Date(athDate).getTime()) / 86400000;
        if (daysSinceAth <= 30) return 'recent_ath';      // within 30 days
        if (daysSinceAth <= 90) return 'near_ath';        // within 90 days
        if (daysSinceAth <= 365) return 'moderate_ath';   // within 1 year
        return 'old_ath';                                  // over 1 year ago
      })(),
      // Round 214 (AutoResearch): contract addresses per chain from CoinGecko platforms field
      // Provides direct contract lookup without requiring a separate API call
      contract_addresses: (() => {
        const platforms = coinData?.platforms;
        if (!platforms || typeof platforms !== 'object') return null;
        const result = {};
        for (const [chain, addr] of Object.entries(platforms)) {
          if (chain && addr && typeof addr === 'string' && addr.length > 5) {
            result[chain] = addr;
          }
        }
        return Object.keys(result).length > 0 ? result : null;
      })(),
      // Round 209 (AutoResearch): normalized community score (0-100) from social following signals
      // Combines twitter followers, telegram users, reddit subscribers into one metric
      community_score: (() => {
        const twitter = Number(communityData?.twitter_followers ?? 0);
        const telegram = Number(communityData?.telegram_channel_user_count ?? 0);
        const reddit = Number(communityData?.reddit_subscribers ?? 0);
        // Log scale: 1M followers → ~40 pts, 100K → ~27 pts, 10K → ~13 pts
        const twitterScore = twitter > 0 ? Math.min(40, (Math.log10(twitter) / 7) * 40) : 0;
        const telegramScore = telegram > 0 ? Math.min(30, (Math.log10(telegram) / 6.5) * 30) : 0;
        const redditScore = reddit > 0 ? Math.min(30, (Math.log10(reddit) / 6) * 30) : 0;
        const total = twitterScore + telegramScore + redditScore;
        return total > 0 ? Math.round(total) : null;
      })(),
      // Round 237 (AutoResearch nightly): holder_engagement_score (0-100)
      // Measures how actively holders are engaging vs holding. High velocity + large community = active.
      // Combines: volume/mcap velocity, community size, and trending status.
      holder_engagement_score: (() => {
        const volMcapRatio = (totalVolume != null && marketCap != null && marketCap > 0)
          ? totalVolume / marketCap : null;
        if (volMcapRatio == null) return null;
        // Volume velocity component (0-50): log scale
        const velScore = Math.min(50, Math.log10(volMcapRatio * 100 + 1) * 25);
        // Community component (0-30): log scale of followers
        const twitterF = Number(communityData?.twitter_followers ?? 0);
        const telegramU = Number(communityData?.telegram_channel_user_count ?? 0);
        const communityTotal = twitterF + telegramU;
        const commScore = communityTotal > 0 ? Math.min(30, (Math.log10(communityTotal + 1) / 7) * 30) : 0;
        // Trending bonus (0-20)
        const trendingBonus = isTrending ? 20 : 0;
        return Math.round(velScore + commScore + trendingBonus);
      })(),
      // Round 381 (AutoResearch): days_since_ath — simple integer for LLM/scoring context
      // More legible than ath_recency string alone, useful for decay calculations
      days_since_ath: (() => {
        const athDate = marketData?.ath_date?.usd;
        if (!athDate) return null;
        const days = Math.floor((Date.now() - new Date(athDate).getTime()) / 86400000);
        return days >= 0 ? days : null;
      })(),
      // Round 381 (AutoResearch): price_change_90d computed from chart history (more accurate than
      // the existing price_change_pct_90d field which uses a heuristic weighted blend as fallback)
      // Already present as price_change_pct_90d — alias for cross-collector consistency
      // Round 381 (AutoResearch): market_cap_to_volume_ratio — a "valuation efficiency" signal
      // Low ratio (<5) = highly liquid, efficiently valued; high ratio (>200) = illiquid or speculative
      market_cap_to_volume_ratio: (() => {
        if (marketCap == null || totalVolume == null || totalVolume === 0) return null;
        const ratio = marketCap / totalVolume;
        return Number.isFinite(ratio) ? parseFloat(ratio.toFixed(1)) : null;
      })(),
      // Round 2
      is_trending: isTrending,
      categories,
      genesis_date: genesisDate,
      price_momentum_tier: priceMomentumTier,
      // Round 9
      exchange_count: exchangeCount,
      cex_count: cexCount,
      dex_count: dexCount,
      market_pair_count: marketPairCount,
      cex_pair_count: cexPairCount,
      dex_pair_count: dexPairCount,
      cex_volume_pct: cexVolumePct != null ? Math.round(cexVolumePct * 100) / 100 : null,
      anomalous_ticker_count: anomalousTickerCount,
      stale_ticker_count: staleTickerCount,
      trust_score_avg: trustScoreAvg,
      top_exchanges: topExchanges,
      sparkline_7d: coinData?.market_data?.sparkline_7d?.price || [],
      price_history_90d: (chartData?.prices || []).map(([ts, price]) => ({ t: ts, p: price })),
      // Round 156 (AutoResearch): 7-day sparkline realized volatility (daily return std dev)
      sparkline_7d_volatility: (() => {
        const prices = (coinData?.market_data?.sparkline_7d?.price || []).map(Number).filter(Number.isFinite);
        if (prices.length < 3) return null;
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
          if (prices[i - 1] > 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }
        if (returns.length < 2) return null;
        const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
        const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
        return parseFloat((Math.sqrt(variance) * 100).toFixed(3)); // % daily vol
      })(),
      // Round 156 (AutoResearch): 90-day realized volatility from chart history
      realized_vol_90d: (() => {
        const pxHistory = (chartData?.prices || []).map(([, p]) => Number(p)).filter(Number.isFinite);
        if (pxHistory.length < 10) return null;
        const returns = [];
        for (let i = 1; i < pxHistory.length; i++) {
          if (pxHistory[i - 1] > 0) returns.push((pxHistory[i] - pxHistory[i - 1]) / pxHistory[i - 1]);
        }
        const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
        const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
        return parseFloat((Math.sqrt(variance) * Math.sqrt(365) * 100).toFixed(1)); // annualized %
      })(),
      // Round R1 (AutoResearch batch): 7-day average volume from chart data — enables suspicious spike detection
      volume_7d_avg: (() => {
        const vols = (chartData?.total_volumes || []).slice(-7).map(([, v]) => Number(v)).filter(Number.isFinite);
        return vols.length >= 3 ? Math.round(vols.reduce((s, v) => s + v, 0) / vols.length) : null;
      })(),
      platforms: coinData?.platforms && typeof coinData.platforms === 'object' ? coinData.platforms : null,
      last_updated: coinData?.last_updated ?? null,
      last_updated_age_minutes: (() => {
        if (!coinData?.last_updated) return null;
        const minutes = Math.floor((Date.now() - new Date(coinData.last_updated).getTime()) / 60000);
        return minutes >= 0 ? minutes : null;
      })(),
      // Round 205 (AutoResearch): volume spike flag — when 24h vol is anomalously high vs 7d avg
      // Useful for catching pump-and-dump, news-driven spikes, or exchange listing events
      volume_spike_flag: (() => {
        const vol24h = totalVolume;
        const vol7dAvg = (() => {
          const vols = (chartData?.total_volumes || []).slice(-7).map(([, v]) => Number(v)).filter(Number.isFinite);
          return vols.length >= 3 ? vols.reduce((s, v) => s + v, 0) / vols.length : null;
        })();
        if (vol24h == null || vol7dAvg == null || vol7dAvg === 0) return null;
        const ratio = vol24h / vol7dAvg;
        if (ratio >= 5) return 'extreme_spike';
        if (ratio >= 3) return 'spike';
        if (ratio >= 1.5) return 'elevated';
        return null;
      })(),
      // Round R5: Global market context — BTC dominance, total mcap, macro trend
      btc_dominance: sanitizeFinite(globalData?.data?.market_cap_percentage?.btc, { min: 0, max: 100, decimals: 2 }),
      total_market_cap_usd: sanitizeNonNegative(globalData?.data?.total_market_cap?.usd),
      market_cap_change_pct_24h_global: sanitizePct(globalData?.data?.market_cap_change_percentage_24h_usd, { min: -100, max: 1000, decimals: 2 }),
      // Round 561 (AutoResearch): CoinGecko confidence/completeness scores
      // coingecko_score = overall reliability signal for this coin's data quality
      // liquidity_score = how liquid the coin is according to CoinGecko's internal model
      coingecko_score: (() => {
        const v = Number(coinData?.coingecko_score);
        return Number.isFinite(v) ? parseFloat(v.toFixed(1)) : null;
      })(),
      developer_score: (() => {
        const v = Number(coinData?.developer_score);
        return Number.isFinite(v) ? parseFloat(v.toFixed(1)) : null;
      })(),
      liquidity_score: (() => {
        const v = Number(coinData?.liquidity_score);
        return Number.isFinite(v) ? parseFloat(v.toFixed(1)) : null;
      })(),
      public_interest_score: (() => {
        const v = Number(coinData?.public_interest_score);
        return Number.isFinite(v) ? parseFloat(v.toFixed(1)) : null;
      })(),
      // Round 559 (AutoResearch): CoinGecko community sentiment votes (bullish/bearish vote percentages)
      // This is a direct community sentiment signal — different from social media analysis
      sentiment_votes_up_pct: (() => {
        const v = Number(coinData?.sentiment_votes_up_percentage);
        return Number.isFinite(v) && v >= 0 && v <= 100 ? parseFloat(v.toFixed(1)) : null;
      })(),
      sentiment_votes_down_pct: (() => {
        const v = Number(coinData?.sentiment_votes_down_percentage);
        return Number.isFinite(v) && v >= 0 && v <= 100 ? parseFloat(v.toFixed(1)) : null;
      })(),
      // Round 570 (AutoResearch): vote spread = bullish votes minus bearish votes
      sentiment_vote_spread_pct: (() => {
        const up = Number(coinData?.sentiment_votes_up_percentage);
        const down = Number(coinData?.sentiment_votes_down_percentage);
        if (!Number.isFinite(up) || !Number.isFinite(down)) return null;
        return parseFloat((up - down).toFixed(1));
      })(),
      // Derived: community consensus label from sentiment votes
      community_sentiment_label: (() => {
        const up = Number(coinData?.sentiment_votes_up_percentage ?? 0);
        const down = Number(coinData?.sentiment_votes_down_percentage ?? 0);
        if (!Number.isFinite(up) || !Number.isFinite(down)) return null;
        if (up === 0 && down === 0) return null;
        if (up >= 70) return 'strong_bullish';
        if (up >= 55) return 'bullish';
        if (down >= 70) return 'strong_bearish';
        if (down >= 55) return 'bearish';
        return 'neutral';
      })(),
      // Round 556 (AutoResearch): stablecoin detection from CoinGecko categories + symbol + price
      // More reliable than the fallback's hardcoded false — uses actual coin data
      is_stablecoin: (() => {
        const cats = Array.isArray(coinData?.categories) ? coinData.categories : [];
        if (cats.some(c => /stablecoin/i.test(String(c || '')))) return true;
        const sym = String(coinData?.symbol || '').toUpperCase();
        if (/^(USD[CTBMNP]?|DAI|FRAX|LUSD|GUSD|TUSD|USDP|FDUSD|USDD|CRVUSD|PYUSD)$/.test(sym)) return true;
        // Price close to $1 AND market data confirms stable asset class
        const px = Number(marketData?.current_price?.usd);
        const isNearDollar = Number.isFinite(px) && px > 0.98 && px < 1.02;
        // Require both near-dollar AND some other stablecoin signal to avoid false positives
        const hasStablecoinHint = cats.some(c => /stable|peg|usd/i.test(String(c || '')));
        return isNearDollar && hasStablecoinHint;
      })(),
      // Round 541 (AutoResearch): developer_data from CoinGecko (commit activity, repo count)
      // Cross-reference with GitHub collector; if GitHub fails, these provide a fallback signal
      cg_forks: developerData?.forks ?? null,
      cg_stars: developerData?.stars ?? null,
      cg_subscribers: developerData?.subscribers ?? null,
      cg_total_issues: developerData?.total_issues ?? null,
      cg_closed_issues: developerData?.closed_issues ?? null,
      cg_pr_merged: developerData?.pull_requests_merged ?? null,
      cg_pr_contributors: developerData?.pull_request_contributors ?? null,
      // Commit activity from CoinGecko — last 4 weeks
      cg_commits_4w: developerData?.commit_count_4_weeks ?? null,
      // Issue resolution rate derived from CoinGecko developer data
      cg_issue_resolution_rate: (() => {
        const closed = developerData?.closed_issues;
        const total = developerData?.total_issues;
        if (closed == null || total == null || total === 0) return null;
        const rate = (closed / total) * 100;
        return Number.isFinite(rate) ? parseFloat(rate.toFixed(1)) : null;
      })(),
      // Round 190 (AutoResearch): project description + homepage from CoinGecko
      description: coinData?.description?.en
        ? String(coinData.description.en).replace(/<[^>]+>/g, '').trim().slice(0, 500) || null
        : null,
      homepage: Array.isArray(coinData?.links?.homepage)
        ? (coinData.links.homepage.find(Boolean) || null)
        : null,
      // Round 233 (AutoResearch nightly): short_term_vs_longterm_momentum_divergence
      // Positive = recent momentum stronger than long-term (accelerating)
      // Negative = recent momentum weaker (fading)
      momentum_divergence: (() => {
        const p24h = marketData?.price_change_percentage_24h_in_currency?.usd;
        const p30d = marketData?.price_change_percentage_30d_in_currency?.usd;
        if (p24h == null || p30d == null) return null;
        // Normalize: annualized daily 24h vs monthly 30d
        const daily24hAnnualized = Number(p24h) * 365;
        const monthly30dAnnualized = Number(p30d) * 12;
        const divergence = daily24hAnnualized - monthly30dAnnualized;
        return Number.isFinite(divergence) ? parseFloat(divergence.toFixed(1)) : null;
      })(),
      // Round 234 (AutoResearch): volume_trend_7d — is volume increasing or decreasing over the last 7 days?
      // Computed from chart data daily volumes (first 3 days avg vs last 3 days avg)
      volume_trend_7d: (() => {
        const vols = (chartData?.total_volumes || []).slice(-7).map(([, v]) => Number(v)).filter(Number.isFinite);
        if (vols.length < 6) return null;
        const earlyAvg = (vols[0] + vols[1] + vols[2]) / 3;
        const recentAvg = (vols[vols.length - 3] + vols[vols.length - 2] + vols[vols.length - 1]) / 3;
        if (earlyAvg === 0) return null;
        const changePct = ((recentAvg - earlyAvg) / earlyAvg) * 100;
        if (!Number.isFinite(changePct)) return null;
        return changePct > 20 ? 'increasing' : changePct < -20 ? 'decreasing' : 'stable';
      })(),
      // Round 235 (AutoResearch): price_vs_ma7 — is current price above or below the 7-day moving average?
      // Simple momentum indicator: above = bullish bias, below = bearish bias
      price_vs_ma7: (() => {
        const prices = (chartData?.prices || []).slice(-7).map(([, p]) => Number(p)).filter(Number.isFinite);
        if (prices.length < 5) return null;
        const ma7 = prices.reduce((s, v) => s + v, 0) / prices.length;
        const lastPrice = prices[prices.length - 1];
        if (ma7 === 0) return null;
        const pctAbove = ((lastPrice - ma7) / ma7) * 100;
        return {
          above_ma7: lastPrice > ma7,
          pct_vs_ma7: parseFloat(pctAbove.toFixed(2)),
        };
      })(),
      // Round 383 (AutoResearch): weekly_price_return — clean 7-day return from chart data
      // More accurate than price_change_pct_7d (which is CoinGecko's rolling 7d, not aligned to chart)
      // Useful for trend-following context and comparison with weekly fee efficiency signals
      weekly_price_return: (() => {
        const prices = (chartData?.prices || []).slice(-8).map(([, p]) => Number(p)).filter(Number.isFinite);
        if (prices.length < 2) return null;
        const first = prices[0];
        const last = prices[prices.length - 1];
        if (first <= 0) return null;
        const ret = ((last - first) / first) * 100;
        return Number.isFinite(ret) ? parseFloat(ret.toFixed(2)) : null;
      })(),
      // Round 383 (AutoResearch): price_range_pct_7d — range (high-low)/low over last 7 days
      // Measures intraday volatility range — high range = volatile asset, low range = stable/consolidating
      price_range_pct_7d: (() => {
        const prices = (chartData?.prices || []).slice(-7).map(([, p]) => Number(p)).filter(Number.isFinite);
        if (prices.length < 3) return null;
        const high = Math.max(...prices);
        const low = Math.min(...prices);
        if (low <= 0) return null;
        const rangePct = ((high - low) / low) * 100;
        return Number.isFinite(rangePct) ? parseFloat(rangePct.toFixed(2)) : null;
      })(),
      // Round 383 (AutoResearch): ath_recovery_potential — how far could price go just to recover ATH?
      // Simple metric that helps frame the "recovery trade" vs "price discovery" narrative:
      // <50% to ATH = near territory | 50-200% = medium recovery | >200% = long way back
      ath_recovery_potential: (() => {
        if (athDistancePct == null || !Number.isFinite(athDistancePct) || athDistancePct >= 0) return null;
        // If price is X% below ATH, the required move UP = 100 / (1 + X/100) - 1
        // e.g. -50% below ATH → needs +100% to recover
        const requiredPctMove = (100 / (1 + athDistancePct / 100) - 1) * 100;
        if (!Number.isFinite(requiredPctMove)) return null;
        const tier = requiredPctMove < 50 ? 'near_recovery' : requiredPctMove < 200 ? 'medium_recovery' : requiredPctMove < 500 ? 'long_recovery' : 'very_distant_recovery';
        return {
          required_pct: parseFloat(requiredPctMove.toFixed(1)),
          tier,
        };
      })(),
      // Round 384 (AutoResearch batch): 90-day price high and low from chart data
      // Provides medium-term range context beyond the 7d range already computed.
      // Useful for: support/resistance zones, trend directionality over a quarter.
      price_range_90d: (() => {
        const prices = (chartData?.prices || []).map(([, p]) => Number(p)).filter(Number.isFinite);
        if (prices.length < 30) return null;
        const high90d = Math.max(...prices);
        const low90d = Math.min(...prices);
        const lastPrice = prices[prices.length - 1];
        if (low90d <= 0 || high90d <= 0) return null;
        const rangeWidth = ((high90d - low90d) / low90d) * 100;
        const positionInRange = (lastPrice - low90d) / (high90d - low90d); // 0=at low, 1=at high
        return {
          high: parseFloat(high90d.toFixed(8)),
          low: parseFloat(low90d.toFixed(8)),
          range_width_pct: parseFloat(rangeWidth.toFixed(2)),
          position_in_range: parseFloat(positionInRange.toFixed(3)),
          // Tier based on position in 90d range
          tier: positionInRange >= 0.75 ? 'upper_quartile' : positionInRange >= 0.5 ? 'upper_half' : positionInRange >= 0.25 ? 'lower_half' : 'lower_quartile',
        };
      })(),
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'CoinGecko timeout' : error.message,
    };
  }
}
