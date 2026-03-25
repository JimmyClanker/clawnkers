/**
 * red-flags.js — Round 14
 * Detects qualitative red flags from raw scanner data and scores.
 */

function safeN(v, fb = 0) {
  return Number.isFinite(Number(v)) ? Number(v) : fb;
}

/**
 * Detect red flags in a project scan.
 * @param {object} rawData - raw collector data keyed by section (market, onchain, social, github, tokenomics, dex, holders)
 * @param {object} scores  - calculateScores() result
 * @returns {Array<{flag: string, severity: 'critical'|'warning'|'info', detail: string}>}
 */
export function detectRedFlags(rawData = {}, scores = {}) {
  const flags = [];
  const market     = rawData.market     ?? {};
  const onchain    = rawData.onchain    ?? {};
  const social     = rawData.social     ?? {};
  const github     = rawData.github     ?? {};
  const tokenomics = rawData.tokenomics ?? {};

  // 1. Project age < 6 months
  const genesisDate = market.genesis_date ?? tokenomics.genesis_date;
  if (genesisDate) {
    const ageMs = Date.now() - new Date(genesisDate).getTime();
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonths < 6) {
      flags.push({
        flag: 'young_project',
        severity: ageMonths < 2 ? 'critical' : 'warning',
        detail: `Project is only ${ageMonths.toFixed(1)} months old — track record limited.`,
      });
    }
  }

  // 2. Market cap < $1M
  const mcap = safeN(market.market_cap);
  if (mcap > 0 && mcap < 1_000_000) {
    flags.push({
      flag: 'low_market_cap',
      severity: 'critical',
      detail: `Market cap $${(mcap / 1000).toFixed(0)}K is below $1M — extremely illiquid and volatile.`,
    });
  }

  // 3. No GitHub repo
  if (github.error || (!github.stars && !github.commits_90d && !github.contributors)) {
    flags.push({
      flag: 'no_github',
      severity: 'warning',
      detail: 'No GitHub repository data found — development activity unverifiable.',
    });
  }

  // 4. Whale concentration > 30%
  const holders = rawData.holders ?? rawData.holderData ?? {};
  const whaleConcentration = safeN(holders.top10_concentration ?? holders.concentration_pct);
  if (whaleConcentration > 30) {
    flags.push({
      flag: 'whale_concentration',
      severity: whaleConcentration > 60 ? 'critical' : 'warning',
      detail: `Top-10 wallets hold ${whaleConcentration.toFixed(1)}% of supply — concentration risk.`,
    });
  }

  // 5. No onchain data
  if (onchain.error || (!onchain.tvl && !onchain.tvl_change_7d && !onchain.fees_7d)) {
    flags.push({
      flag: 'no_onchain_data',
      severity: 'info',
      detail: 'No onchain (DeFiLlama/similar) data available — protocol health unverifiable.',
    });
  }

  // 6. Declining TVL > 30%
  const tvlChange7d = safeN(onchain.tvl_change_7d);
  const tvlChange30d = safeN(onchain.tvl_change_30d);
  if (tvlChange7d < -30 || tvlChange30d < -30) {
    const worst = Math.min(tvlChange7d, tvlChange30d);
    flags.push({
      flag: 'declining_tvl',
      severity: worst < -50 ? 'critical' : 'warning',
      detail: `TVL has declined ${Math.abs(worst).toFixed(1)}% recently — protocol losing traction.`,
    });
  }

  // 7. Volume < $50K
  const volume = safeN(market.total_volume);
  if (volume > 0 && volume < 50_000) {
    flags.push({
      flag: 'low_volume',
      severity: 'warning',
      detail: `24h trading volume $${(volume / 1000).toFixed(1)}K is very low — liquidity risk.`,
    });
  }

  // 8. All social sentiment bearish
  const bullish = safeN(social.sentiment_counts?.bullish);
  const bearish  = safeN(social.sentiment_counts?.bearish);
  const sentScore = safeN(social.sentiment_score, NaN);
  const allBearish = (bullish === 0 && bearish > 0) ||
    (Number.isFinite(sentScore) && sentScore < -0.5);
  if (allBearish) {
    flags.push({
      flag: 'bearish_sentiment',
      severity: 'warning',
      detail: `Social sentiment is overwhelmingly bearish (score: ${Number.isFinite(sentScore) ? sentScore.toFixed(2) : 'n/a'}, bullish: ${bullish}, bearish: ${bearish}).`,
    });
  }

  // 9. No license on GitHub
  if (!github.error && github.stars != null && !github.license) {
    flags.push({
      flag: 'no_license',
      severity: 'info',
      detail: 'GitHub repository has no detected license — legal use unclear.',
    });
  }

  // 10. FDV/MCap > 10x
  const fdv = safeN(market.fully_diluted_valuation ?? market.fdv);
  if (fdv > 0 && mcap > 0) {
    const fdvRatio = fdv / mcap;
    if (fdvRatio > 10) {
      flags.push({
        flag: 'extreme_fdv_ratio',
        severity: 'critical',
        detail: `FDV/MCap ratio is ${fdvRatio.toFixed(1)}x — massive token unlock overhang, severe dilution risk.`,
      });
    }
  }

  return flags;
}
