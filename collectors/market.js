import { fetchJson } from './fetch.js';

const COINGECKO_SEARCH_URL = 'https://api.coingecko.com/api/v3/search';
const COINGECKO_COIN_URL = 'https://api.coingecko.com/api/v3/coins';
const COINGECKO_TRENDING_URL = 'https://api.coingecko.com/api/v3/search/trending';
const COINGECKO_TICKERS_URL = 'https://api.coingecko.com/api/v3/coins';

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

    const coinUrl = `${COINGECKO_COIN_URL}/${encodeURIComponent(firstCoin.id)}?localization=false&tickers=false&community_data=true&developer_data=false&sparkline=false&price_change_percentage=1h%2C24h%2C7d%2C14d%2C30d%2C60d%2C200d%2C1y`;
    const [coinData, trendingData, tickersData] = await Promise.allSettled([
      fetchJson(coinUrl),
      fetchJson(COINGECKO_TRENDING_URL),
      fetchJson(`${COINGECKO_TICKERS_URL}/${encodeURIComponent(firstCoin.id)}/tickers?per_page=100`),
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
      ? ((price - ath) / ath) * 100
      : null;
    const atl = marketData?.atl?.usd ?? null;
    const atlDistancePct = (price != null && atl != null && atl > 0 && price > atl)
      ? ((price - atl) / atl) * 100
      : null;
    const circulatingToMaxRatio = (circulatingSupply != null && (maxSupply || totalSupply) > 0)
      ? circulatingSupply / (maxSupply || totalSupply)
      : null;
    const volumeToMcapRatio = (totalVolume != null && marketCap != null && marketCap > 0)
      ? totalVolume / marketCap
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
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'CoinGecko timeout' : error.message,
    };
  }
}
