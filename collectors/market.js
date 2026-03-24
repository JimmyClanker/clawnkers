import { fetchJson } from './fetch.js';

const COINGECKO_SEARCH_URL = 'https://api.coingecko.com/api/v3/search';
const COINGECKO_COIN_URL = 'https://api.coingecko.com/api/v3/coins';

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
    atl: null,
    atl_date: null,
    twitter_followers: null,
    telegram_channel_user_count: null,
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

    const coinUrl = `${COINGECKO_COIN_URL}/${encodeURIComponent(firstCoin.id)}?localization=false&tickers=false&community_data=true&developer_data=false`;
    const coinData = await fetchJson(coinUrl);
    const marketData = coinData?.market_data || {};
    const communityData = coinData?.community_data || {};

    return {
      ...fallback,
      coin_id: coinData?.id || firstCoin.id || null,
      symbol: coinData?.symbol || firstCoin.symbol || null,
      name: coinData?.name || firstCoin.name || projectName,
      price: marketData?.current_price?.usd ?? null,
      market_cap: marketData?.market_cap?.usd ?? null,
      fully_diluted_valuation: marketData?.fully_diluted_valuation?.usd ?? null,
      total_volume: marketData?.total_volume?.usd ?? null,
      circulating_supply: marketData?.circulating_supply ?? null,
      total_supply: marketData?.total_supply ?? null,
      max_supply: marketData?.max_supply ?? null,
      price_change_pct_1h: marketData?.price_change_percentage_1h_in_currency?.usd ?? null,
      price_change_pct_24h: marketData?.price_change_percentage_24h_in_currency?.usd ?? null,
      price_change_pct_7d: marketData?.price_change_percentage_7d_in_currency?.usd ?? null,
      price_change_pct_30d: marketData?.price_change_percentage_30d_in_currency?.usd ?? null,
      ath: marketData?.ath?.usd ?? null,
      ath_date: marketData?.ath_date?.usd ?? null,
      atl: marketData?.atl?.usd ?? null,
      atl_date: marketData?.atl_date?.usd ?? null,
      twitter_followers: communityData?.twitter_followers ?? null,
      telegram_channel_user_count: communityData?.telegram_channel_user_count ?? null,
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'CoinGecko timeout' : error.message,
    };
  }
}
