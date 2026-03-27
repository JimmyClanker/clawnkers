import { getCalibrationDb } from './db.js';

const BTC_CACHE = { price: null, ts: 0 };
const SCORE_WEIGHTS = {
  market: 0.19,
  onchain: 0.19,
  social: 0.12,
  development: 0.16,
  tokenomics: 0.14,
  distribution: 0.14,
  risk: 0.10,
};

const snapshotStoreHooks = {
  beforeInsert: null,
};

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toInteger(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : null;
}

function toJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function normalizeSentimentScore(social = {}) {
  const direct = toNumber(social.sentiment_score ?? social.normalized_sentiment_score);
  if (direct != null) return direct;

  const sentiment = typeof social.sentiment === 'string' ? social.sentiment.toLowerCase() : null;
  if (sentiment === 'bullish') return 1;
  if (sentiment === 'neutral') return 0;
  if (sentiment === 'bearish') return -1;
  return null;
}

function extractSymbol(projectName, rawData = {}) {
  return (
    rawData?.market?.symbol ||
    rawData?.tokenomics?.symbol ||
    rawData?.symbol ||
    String(projectName || '').trim().toUpperCase().slice(0, 20)
  );
}

function extractName(projectName, rawData = {}) {
  return (
    rawData?.market?.name ||
    rawData?.project_name ||
    rawData?.name ||
    projectName
  );
}

function extractUniverseRecord(projectName, rawData = {}) {
  return {
    symbol: extractSymbol(projectName, rawData),
    name: extractName(projectName, rawData),
    coingecko_id: rawData?.market?.coingecko_id || rawData?.coingecko_id || null,
    chain: rawData?.onchain?.chain || rawData?.market?.chain || null,
    category: rawData?.onchain?.category || rawData?.project_category || null,
    metadata_json: toJson({
      market: {
        market_cap_rank: rawData?.market?.market_cap_rank ?? null,
        genesis_date: rawData?.market?.genesis_date ?? null,
      },
      social: {
        key_narratives: rawData?.social?.key_narratives ?? [],
      },
      tokenomics: {
        pct_circulating: rawData?.tokenomics?.pct_circulating ?? null,
      },
    }),
  };
}

function extractSnapshotRecord(projectName, rawData = {}, btcPrice) {
  const market = rawData?.market ?? {};
  const onchain = rawData?.onchain ?? {};
  const social = rawData?.social ?? {};
  const github = rawData?.github ?? {};
  const holders = rawData?.holders ?? rawData?.holderData ?? {};
  const dex = rawData?.dex ?? rawData?.dexData ?? {};

  return {
    project_name: projectName,
    snapshot_level: 2,
    price: toNumber(market.current_price ?? market.price),
    market_cap: toNumber(market.market_cap),
    fdv: toNumber(market.fully_diluted_valuation ?? market.fdv),
    volume_24h: toNumber(market.total_volume ?? market.volume_24h),
    price_change_1h: toNumber(market.price_change_pct_1h),
    price_change_24h: toNumber(market.price_change_pct_24h),
    price_change_7d: toNumber(market.price_change_pct_7d),
    price_change_30d: toNumber(market.price_change_pct_30d),
    ath_distance_pct: toNumber(market.ath_distance_pct),
    tvl: toNumber(onchain.tvl),
    tvl_change_7d: toNumber(onchain.tvl_change_7d),
    fees_7d: toNumber(onchain.fees_7d ?? (onchain.fees_30d != null ? Number(onchain.fees_30d) / 4 : null)),
    revenue_7d: toNumber(onchain.revenue_7d ?? (onchain.revenue_30d != null ? Number(onchain.revenue_30d) / 4 : null)),
    social_mentions: toInteger(social.filtered_mentions ?? social.mentions),
    sentiment_score: normalizeSentimentScore(social),
    github_commits_30d: toInteger(github.commits_30d ?? github.commits_90d),
    github_commit_trend: github.commit_trend ?? github.activity_trend ?? null,
    holder_concentration: toNumber(holders.top10_pct ?? holders.holder_concentration ?? holders.concentration_top10),
    dex_liquidity: toNumber(dex.dex_liquidity_usd ?? dex.liquidity_usd),
    buy_sell_ratio: toNumber(dex.buy_sell_ratio),
    btc_price: toNumber(btcPrice),
    data_completeness: toNumber(rawData?.metadata?.data_completeness ?? rawData?.scores?.overall?.completeness),
  };
}

function scoreBucket(score) {
  const n = toNumber(score);
  if (n == null) return null;
  if (n < 3) return '0-3';
  if (n < 5) return '3-5';
  if (n < 7) return '5-7';
  return '7-10';
}

function extractScoreRecord(rawData = {}, scores = {}) {
  const overall = scores?.overall ?? {};
  const llmAnalysis = rawData?.llm_analysis ?? {};
  const overallScore = toNumber(overall.score);

  return {
    market_score: toNumber(scores?.market_strength?.score),
    onchain_score: toNumber(scores?.onchain_health?.score),
    social_score: toNumber(scores?.social_momentum?.score),
    dev_score: toNumber(scores?.development?.score),
    tokenomics_score: toNumber(scores?.tokenomics_health?.score),
    distribution_score: toNumber(scores?.distribution?.score),
    risk_score: toNumber(scores?.risk?.score),
    overall_score: overallScore,
    raw_score: toNumber(overall.raw_score ?? overall.score),
    score_bucket: scoreBucket(overallScore),
    verdict: llmAnalysis?.verdict ?? null,
    confidence: toNumber(overall.overall_confidence),
    category: scores?.overall?.category ?? rawData?.project_category ?? rawData?.onchain?.category ?? null,
    category_confidence: toNumber(scores?.overall?.category_confidence ?? rawData?.category_confidence),
    category_source: scores?.overall?.category_source ?? rawData?.category_source ?? (rawData?.project_category ? 'report' : rawData?.onchain?.category ? 'onchain' : null),
    weights_json: JSON.stringify(scores?.overall?.weights_used ?? SCORE_WEIGHTS),
    leading_signals_json: toJson(rawData?.alpha_signals ?? []),
    circuit_breakers_json: toJson(scores?.overall?.circuit_breakers?.breakers || rawData?.red_flags?.filter((flag) => flag?.severity === 'critical') || []),
    red_flags_count: Array.isArray(rawData?.red_flags) ? rawData.red_flags.length : 0,
    alpha_signals_count: Array.isArray(rawData?.alpha_signals) ? rawData.alpha_signals.length : 0,
    divergence_json: toJson(rawData?.momentum?.divergence ?? rawData?.divergence ?? null),
    regime: rawData?.volatility?.regime ?? null,
  };
}

function ensureTokenUniverse(db, universe) {
  if (!universe.symbol || !universe.name) return null;

  if (universe.coingecko_id) {
    const existing = db.prepare('SELECT id FROM token_universe WHERE coingecko_id = ?').get(universe.coingecko_id);
    if (existing?.id) {
      db.prepare(`
        UPDATE token_universe
        SET symbol = ?, name = ?, chain = ?, category = ?, metadata_json = ?, active = 1
        WHERE id = ?
      `).run(universe.symbol, universe.name, universe.chain, universe.category, universe.metadata_json, existing.id);
      return existing.id;
    }
  }

  const fallbackExisting = db.prepare(
    'SELECT id FROM token_universe WHERE LOWER(symbol) = LOWER(?) AND LOWER(name) = LOWER(?) LIMIT 1'
  ).get(universe.symbol, universe.name);

  if (fallbackExisting?.id) {
    db.prepare(`
      UPDATE token_universe
      SET coingecko_id = COALESCE(coingecko_id, ?), chain = ?, category = ?, metadata_json = ?, active = 1
      WHERE id = ?
    `).run(universe.coingecko_id, universe.chain, universe.category, universe.metadata_json, fallbackExisting.id);
    return fallbackExisting.id;
  }

  const result = db.prepare(`
    INSERT INTO token_universe (symbol, name, coingecko_id, chain, category, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(universe.symbol, universe.name, universe.coingecko_id, universe.chain, universe.category, universe.metadata_json);

  return Number(result.lastInsertRowid);
}

export async function getBtcPrice() {
  if (Date.now() - BTC_CACHE.ts < 5 * 60 * 1000 && BTC_CACHE.price) return BTC_CACHE.price;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    const data = await res.json();
    BTC_CACHE.price = data?.bitcoin?.usd ?? null;
    BTC_CACHE.ts = Date.now();
    return BTC_CACHE.price;
  } catch {
    return BTC_CACHE.price;
  }
}

export async function storeScanSnapshot(projectName, rawData = {}, scores = {}) {
  const db = getCalibrationDb();
  const btcPrice = await getBtcPrice();
  const universe = extractUniverseRecord(projectName, rawData);
  const snapshot = extractSnapshotRecord(projectName, rawData, btcPrice);
  snapshot.data_completeness = snapshot.data_completeness ?? toNumber(scores?.overall?.completeness);

  const scoreRecord = extractScoreRecord(rawData, scores);
  scoreRecord.verdict = scoreRecord.verdict ?? rawData?.verdict ?? null;

  const insertSnapshot = db.prepare(`
    INSERT INTO token_snapshots (
      token_id, project_name, snapshot_level, price, market_cap, fdv, volume_24h,
      price_change_1h, price_change_24h, price_change_7d, price_change_30d,
      ath_distance_pct, tvl, tvl_change_7d, fees_7d, revenue_7d,
      social_mentions, sentiment_score, github_commits_30d, github_commit_trend,
      holder_concentration, dex_liquidity, buy_sell_ratio, btc_price, data_completeness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertScore = db.prepare(`
    INSERT INTO token_scores (
      snapshot_id, market_score, onchain_score, social_score, dev_score,
      tokenomics_score, distribution_score, risk_score, overall_score, raw_score,
      score_bucket, verdict, confidence, category, category_confidence, category_source,
      weights_json, leading_signals_json, circuit_breakers_json, red_flags_count,
      alpha_signals_count, divergence_json, regime
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    snapshotStoreHooks.beforeInsert?.({ projectName, rawData, scores });
    const tokenId = ensureTokenUniverse(db, universe);
    const snapshotResult = insertSnapshot.run(
      tokenId,
      snapshot.project_name,
      snapshot.snapshot_level,
      snapshot.price,
      snapshot.market_cap,
      snapshot.fdv,
      snapshot.volume_24h,
      snapshot.price_change_1h,
      snapshot.price_change_24h,
      snapshot.price_change_7d,
      snapshot.price_change_30d,
      snapshot.ath_distance_pct,
      snapshot.tvl,
      snapshot.tvl_change_7d,
      snapshot.fees_7d,
      snapshot.revenue_7d,
      snapshot.social_mentions,
      snapshot.sentiment_score,
      snapshot.github_commits_30d,
      snapshot.github_commit_trend,
      snapshot.holder_concentration,
      snapshot.dex_liquidity,
      snapshot.buy_sell_ratio,
      snapshot.btc_price,
      snapshot.data_completeness,
    );

    const snapshotId = Number(snapshotResult.lastInsertRowid);
    insertScore.run(
      snapshotId,
      scoreRecord.market_score,
      scoreRecord.onchain_score,
      scoreRecord.social_score,
      scoreRecord.dev_score,
      scoreRecord.tokenomics_score,
      scoreRecord.distribution_score,
      scoreRecord.risk_score,
      scoreRecord.overall_score,
      scoreRecord.raw_score,
      scoreRecord.score_bucket,
      scoreRecord.verdict,
      scoreRecord.confidence,
      scoreRecord.category,
      scoreRecord.category_confidence,
      scoreRecord.category_source,
      scoreRecord.weights_json,
      scoreRecord.leading_signals_json,
      scoreRecord.circuit_breakers_json,
      scoreRecord.red_flags_count,
      scoreRecord.alpha_signals_count,
      scoreRecord.divergence_json,
      scoreRecord.regime,
    );

    return snapshotId;
  });

  const snapshotId = tx();
  console.log(`[snapshot-store] Saved snapshot #${snapshotId} for ${projectName} (score: ${scoreRecord.overall_score ?? 'n/a'}, btc: $${btcPrice ?? 'n/a'})`);
  return snapshotId;
}

export function __resetSnapshotStoreForTests() {
  BTC_CACHE.price = null;
  BTC_CACHE.ts = 0;
  snapshotStoreHooks.beforeInsert = null;
}

export function __setSnapshotStoreHooksForTests(hooks = {}) {
  snapshotStoreHooks.beforeInsert = hooks.beforeInsert ?? null;
}

export function __extractSnapshotRecordForTests(projectName, rawData = {}, btcPrice = null) {
  return extractSnapshotRecord(projectName, rawData, btcPrice);
}
