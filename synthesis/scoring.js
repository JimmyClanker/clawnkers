function clampScore(value) {
  return Math.min(10, Math.max(1, Number(value.toFixed(1))));
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function scoreMarketStrength(market = {}) {
  const volume = safeNumber(market.total_volume);
  const marketCap = safeNumber(market.market_cap);
  const ratio = marketCap > 0 ? volume / marketCap : 0;
  const momentum = [
    safeNumber(market.price_change_pct_1h),
    safeNumber(market.price_change_pct_24h),
    safeNumber(market.price_change_pct_7d),
    safeNumber(market.price_change_pct_30d),
  ].reduce((sum, value) => sum + value, 0);

  let raw = 4;
  raw += Math.min(ratio * 20, 3);
  raw += Math.max(Math.min(momentum / 20, 3), -2);

  return {
    score: clampScore(raw),
    reasoning: `Volume/MC ratio ${ratio.toFixed(2)} with cumulative momentum ${momentum.toFixed(2)}%.`,
  };
}

function scoreOnchainHealth(onchain = {}) {
  const trend7d = safeNumber(onchain.tvl_change_7d);
  const trend30d = safeNumber(onchain.tvl_change_30d);
  const fees = safeNumber(onchain.fees_7d);
  const revenue = safeNumber(onchain.revenue_7d);

  let raw = 4;
  raw += Math.max(Math.min((trend7d + trend30d) / 25, 3), -2);
  raw += fees > 0 ? Math.min(Math.log10(fees + 1), 2) : 0;
  raw += revenue > 0 ? Math.min(Math.log10(revenue + 1), 1.5) : 0;

  return {
    score: clampScore(raw),
    reasoning: `TVL trend 7d ${trend7d.toFixed(2)}%, 30d ${trend30d.toFixed(2)}%, fees_7d ${fees.toFixed(0)}.`,
  };
}

function scoreSocialMomentum(social = {}) {
  const mentions = safeNumber(social.mentions);
  const bullish = safeNumber(social?.sentiment_counts?.bullish);
  const bearish = safeNumber(social?.sentiment_counts?.bearish);
  const neutral = safeNumber(social?.sentiment_counts?.neutral);
  const narratives = Array.isArray(social.key_narratives) ? social.key_narratives.length : 0;
  const totalSignals = bullish + bearish + neutral;
  const sentimentSpread = bullish - bearish;
  const confidence = totalSignals > 0 ? Math.min(totalSignals / 6, 1) : 0;

  let raw = 4;
  raw += Math.min(Math.log2(mentions + 1) * 0.9, 2.5);
  raw += Math.max(Math.min(sentimentSpread * 0.6 * confidence, 2), -2);
  raw += Math.min(narratives * 0.25, 1.5);

  return {
    score: clampScore(raw),
    reasoning: `Mentions ${mentions}, sentiment spread ${sentimentSpread}, confidence ${confidence.toFixed(2)}, narratives ${narratives}.`,
  };
}

function scoreDevelopment(github = {}) {
  const contributors = safeNumber(github.contributors);
  const commits90d = safeNumber(github.commits_90d);
  const stars = safeNumber(github.stars);

  let raw = 4;
  raw += Math.min(contributors / 5, 2.5);
  raw += Math.min(commits90d / 30, 2.5);
  raw += stars > 0 ? Math.min(Math.log10(stars + 1), 1) : 0;

  return {
    score: clampScore(raw),
    reasoning: `Contributors ${contributors}, commits_90d ${commits90d}, stars ${stars}.`,
  };
}

function scoreTokenomicsRisk(tokenomics = {}) {
  const pctCirculating = safeNumber(tokenomics.pct_circulating);
  const inflation = safeNumber(tokenomics.inflation_rate);
  const hasDistribution = tokenomics.token_distribution ? 1 : 0;

  let raw = 6;
  if (pctCirculating > 0) {
    raw += Math.min(pctCirculating / 25, 2.5);
  } else {
    raw -= 1;
  }

  raw -= Math.min(Math.max(inflation, 0) / 10, 3);
  raw += hasDistribution ? 0.5 : -0.5;

  return {
    score: clampScore(raw),
    reasoning: `Pct circulating ${pctCirculating.toFixed(2)}%, inflation ${inflation.toFixed(2)}%, distribution ${hasDistribution ? 'available' : 'missing'}.`,
  };
}

function collectorCompleteness(data = {}) {
  const sections = ['market', 'onchain', 'social', 'github', 'tokenomics'];
  const ok = sections.filter((key) => data?.[key] && !data[key].error).length;
  return ok / sections.length;
}

export function calculateScores(data) {
  const market_strength = scoreMarketStrength(data?.market || {});
  const onchain_health = scoreOnchainHealth(data?.onchain || {});
  const social_momentum = scoreSocialMomentum(data?.social || {});
  const development = scoreDevelopment(data?.github || {});
  const tokenomics_health = scoreTokenomicsRisk(data?.tokenomics || {});

  const completeness = collectorCompleteness(data);

  let overallValue =
    market_strength.score * 0.2 +
    onchain_health.score * 0.25 +
    social_momentum.score * 0.15 +
    development.score * 0.15 +
    tokenomics_health.score * 0.25;

  // Penalize when data is incomplete — max -2 points when all collectors fail
  if (completeness < 1) {
    const penalty = (1 - completeness) * 2;
    overallValue = Math.max(1, overallValue - penalty);
  }

  return {
    market_strength,
    onchain_health,
    social_momentum,
    development,
    tokenomics_health,
    overall: {
      score: clampScore(overallValue),
      completeness: Math.round(completeness * 100),
      reasoning: `Weighted blend: market 20%, onchain 25%, social 15%, dev 15%, tokenomics 25%. Data completeness: ${Math.round(completeness * 100)}%.`,
    },
  };
}
