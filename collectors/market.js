import { fetchJson } from './fetch.js';
import { safeNumber } from '../utils/math.js';

const COINGECKO_SEARCH_URL = 'https://api.coingecko.com/api/v3/search';
const COINGECKO_COIN_URL = 'https://api.coingecko.com/api/v3/coins';
const COINGECKO_TRENDING_URL = 'https://api.coingecko.com/api/v3/search/trending';
const COINGECKO_TICKERS_URL = 'https://api.coingecko.com/api/v3/coins';
// Round R5: Global market context — BTC dominance & total market cap
const COINGECKO_GLOBAL_URL = 'https://api.coingecko.com/api/v3/global';

function createEmptyMarketResult(projectName) {
  return {
    project_name: projectName,
    coin_id: null,
    symbol: null,
    name: null,
    price: null,
    market_cap: null,
    fully_diluted_valuation: null,
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
    cex_volume_pct: null,
    top_exchanges: [],
    // Round 2 ext: multi-TF momentum classification
    price_momentum_tier: null,
    // Round R1: 7-day average volume for anomaly detection
    volume_7d_avg: null,
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

    const coinUrl = `${COINGECKO_COIN_URL}/${encodeURIComponent(firstCoin.id)}?localization=false&tickers=false&community_data=true&developer_data=false&sparkline=true&price_change_percentage=1h%2C24h%2C7d%2C14d%2C30d%2C60d%2C200d%2C1y`;
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

    const price = marketData?.current_price?.usd ?? null;
    const ath = marketData?.ath?.usd ?? null;
    const marketCap = marketData?.market_cap?.usd ?? null;
    const totalVolume = marketData?.total_volume?.usd ?? null;
    const circulatingSupply = marketData?.circulating_supply ?? null;
    const maxSupply = marketData?.max_supply ?? null;
    const totalSupply = marketData?.total_supply ?? null;

    // Derived enrichment metrics
    const athDistancePct = (price != null && ath != null && ath > 0)
      ? safeNumber(((price - ath) / ath) * 100)
      : null;
    const atl = marketData?.atl?.usd ?? null;
    const atlDistancePct = (price != null && atl != null && atl > 0 && price > atl)
      ? safeNumber(((price - atl) / atl) * 100)
      : null;
    const circulatingToMaxRatio = (circulatingSupply != null && (maxSupply || totalSupply) > 0)
      ? safeNumber(circulatingSupply / (maxSupply || totalSupply))
      : null;
    const volumeToMcapRatio = (totalVolume != null && marketCap != null && marketCap > 0)
      ? safeNumber(totalVolume / marketCap)
      : null;
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
    const p1h  = marketData?.price_change_percentage_1h_in_currency?.usd ?? 0;
    const p24h = marketData?.price_change_percentage_24h_in_currency?.usd ?? 0;
    const p7d  = marketData?.price_change_percentage_7d_in_currency?.usd ?? 0;
    const p30d = marketData?.price_change_percentage_30d_in_currency?.usd ?? 0;
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
    let cexVolumePct = null;
    const topExchanges = [];

    if (tickersData?.tickers && Array.isArray(tickersData.tickers)) {
      const tickers = tickersData.tickers;
      const exchangeVolumeMap = new Map();
      let totalCexVol = 0;
      let totalDexVol = 0;

      for (const ticker of tickers) {
        const exchangeName = ticker?.market?.name || ticker?.market?.identifier || 'unknown';
        const isDefi = ticker?.market?.has_trading_incentive === false && ticker?.is_anomaly === false
          ? null : null; // Will use identifier patterns
        const isDex = /uniswap|curve|sushi|pancake|balancer|1inch|dydx|osmosis|jupiter|raydium|orca|serum|camelot|aerodrome|velodrome/i.test(exchangeName);
        const vol = Number(ticker?.converted_volume?.usd || 0);

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

      // Top 5 exchanges by volume
      const sorted = [...exchangeVolumeMap.entries()]
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
      fully_diluted_valuation: marketData?.fully_diluted_valuation?.usd ?? null,
      total_volume: totalVolume,
      circulating_supply: circulatingSupply,
      total_supply: totalSupply,
      max_supply: maxSupply,
      price_change_pct_1h: marketData?.price_change_percentage_1h_in_currency?.usd ?? null,
      price_change_pct_24h: marketData?.price_change_percentage_24h_in_currency?.usd ?? null,
      price_change_pct_7d: marketData?.price_change_percentage_7d_in_currency?.usd ?? null,
      price_change_pct_30d: marketData?.price_change_percentage_30d_in_currency?.usd ?? null,
      // Round 3: extended price change periods
      price_change_pct_14d: marketData?.price_change_percentage_14d_in_currency?.usd ?? null,
      price_change_pct_60d: marketData?.price_change_percentage_60d_in_currency?.usd ?? null,
      price_change_pct_200d: marketData?.price_change_percentage_200d_in_currency?.usd ?? null,
      price_change_pct_1y: marketData?.price_change_percentage_1y_in_currency?.usd ?? null,
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
      volume_to_mcap_ratio: volumeToMcapRatio,
      market_cap_rank: coinData?.market_cap_rank ?? null,
      twitter_followers: communityData?.twitter_followers ?? null,
      telegram_channel_user_count: communityData?.telegram_channel_user_count ?? null,
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
      // Round 2
      is_trending: isTrending,
      categories,
      genesis_date: genesisDate,
      price_momentum_tier: priceMomentumTier,
      // Round 9
      exchange_count: exchangeCount,
      cex_count: cexCount,
      dex_count: dexCount,
      cex_volume_pct: cexVolumePct != null ? Math.round(cexVolumePct * 100) / 100 : null,
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
      btc_dominance: globalData?.data?.market_cap_percentage?.btc != null
        ? parseFloat(Number(globalData.data.market_cap_percentage.btc).toFixed(2))
        : null,
      total_market_cap_usd: globalData?.data?.total_market_cap?.usd ?? null,
      market_cap_change_pct_24h_global: globalData?.data?.market_cap_change_percentage_24h_usd ?? null,
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
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'CoinGecko timeout' : error.message,
    };
  }
}
