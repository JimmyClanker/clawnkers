/**
 * alpha-signals.js — Round 15
 * Detects positive alpha signals from raw scanner data and scores.
 */

function safeN(v, fb = 0) {
  return Number.isFinite(Number(v)) ? Number(v) : fb;
}

/**
 * Detect alpha signals in a project scan.
 * @param {object} rawData - raw collector data
 * @param {object} scores  - calculateScores() result
 * @returns {Array<{signal: string, strength: 'strong'|'moderate'|'weak', detail: string}>}
 */
export function detectAlphaSignals(rawData = {}, scores = {}) {
  const signals = [];
  const market     = rawData.market     ?? {};
  const onchain    = rawData.onchain    ?? {};
  const social     = rawData.social     ?? {};
  const github     = rawData.github     ?? {};
  const dex        = rawData.dex        ?? rawData.dexData ?? {};
  const sector     = rawData.sector     ?? {};

  // 1. Volume spike without price move
  const mcap   = safeN(market.market_cap);
  const volume = safeN(market.total_volume);
  const change24h = safeN(market.price_change_pct_24h);
  if (mcap > 0 && volume > 0) {
    const volRatio = volume / mcap;
    if (volRatio > 0.3 && Math.abs(change24h) < 5) {
      signals.push({
        signal: 'volume_spike_no_price_move',
        strength: volRatio > 0.6 ? 'strong' : 'moderate',
        detail: `Vol/MCap ratio ${volRatio.toFixed(2)} (>${0.3}) with only ${change24h.toFixed(1)}% 24h price move — potential accumulation.`,
      });
    }
  }

  // 2. Dev acceleration
  const commitTrend = github.commit_trend;
  if (commitTrend === 'accelerating') {
    const commits30d = safeN(github.commits_30d);
    const commits30dPrev = safeN(github.commits_30d_prev);
    const accelPct = commits30dPrev > 0
      ? ((commits30d - commits30dPrev) / commits30dPrev) * 100
      : 0;
    signals.push({
      signal: 'dev_acceleration',
      strength: accelPct > 50 ? 'strong' : 'moderate',
      detail: `Commit trend is accelerating — commits_30d: ${commits30d} vs prev_30d: ${commits30dPrev} (+${accelPct.toFixed(0)}%).`,
    });
  }

  // 3. New exchange listings (exchange_count > 5)
  const exchangeCount = safeN(market.exchange_count ?? dex.exchange_count);
  if (exchangeCount > 5) {
    signals.push({
      signal: 'multi_exchange_listing',
      strength: exchangeCount > 15 ? 'strong' : exchangeCount > 8 ? 'moderate' : 'weak',
      detail: `Listed on ${exchangeCount} exchanges — broad distribution reduces single-venue liquidity risk.`,
    });
  }

  // 4. TVL growth > 20% in 7d
  const tvlChange7d = safeN(onchain.tvl_change_7d);
  if (tvlChange7d > 20) {
    signals.push({
      signal: 'tvl_growth_spike',
      strength: tvlChange7d > 50 ? 'strong' : tvlChange7d > 30 ? 'moderate' : 'weak',
      detail: `TVL grew ${tvlChange7d.toFixed(1)}% in 7d — strong capital inflow into the protocol.`,
    });
  }

  // 5. High sentiment score with significant mentions
  const sentimentScore = safeN(social.sentiment_score, NaN);
  const mentions = safeN(social.filtered_mentions ?? social.mentions);
  if (Number.isFinite(sentimentScore) && sentimentScore > 0.5 && mentions >= 5) {
    signals.push({
      signal: 'strong_positive_sentiment',
      strength: sentimentScore > 0.75 ? 'strong' : 'moderate',
      detail: `Sentiment score ${sentimentScore.toFixed(2)} with ${mentions} (filtered) mentions — strong community conviction.`,
    });
  }

  // 6. Improving sector position
  const sectorRank = safeN(sector.rank ?? sector.sector_rank, NaN);
  const sectorPrevRank = safeN(sector.prev_rank ?? sector.sector_prev_rank, NaN);
  if (Number.isFinite(sectorRank) && Number.isFinite(sectorPrevRank) && sectorRank < sectorPrevRank) {
    const improvement = sectorPrevRank - sectorRank;
    signals.push({
      signal: 'improving_sector_position',
      strength: improvement > 10 ? 'strong' : improvement > 3 ? 'moderate' : 'weak',
      detail: `Sector rank improved from #${sectorPrevRank} to #${sectorRank} (+${improvement} positions).`,
    });
  }

  return signals;
}
