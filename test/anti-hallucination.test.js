import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReport, buildDataSummary, fallbackReport } from '../synthesis/llm.js';

// ── Helper: create a base report object ──────────────────────────
function makeReport(overrides = {}) {
  return {
    verdict: 'HOLD',
    analysis_text: overrides.analysis_text ?? 'Test analysis text.',
    moat: 'Test moat.',
    risks: overrides.risks ?? ['Risk one [source: RAW_DATA.market.market_cap]'],
    catalysts: overrides.catalysts ?? ['Catalyst one [source: web:https://example.com]'],
    competitor_comparison: 'n/a',
    x_sentiment_summary: overrides.x_sentiment_summary ?? 'Limited X/Twitter data available.',
    key_findings: overrides.key_findings ?? ['Finding one [source: RAW_DATA.market.price]'],
    data_gaps: overrides.data_gaps ?? [],
    facts_verified: overrides.facts_verified ?? ['Price is $100 [source: RAW_DATA.market.current_price]'],
    opinions: overrides.opinions ?? ['[Opinion] Looks promising.'],
    section_confidence: overrides.section_confidence ?? {
      fundamentals: 70,
      market_sentiment: 60,
      outlook: 50,
      overall: 60,
    },
    ...overrides,
  };
}

// ── Helper: create raw data ──────────────────────────────────────
function makeRawData(overrides = {}) {
  return {
    market: {
      current_price: 142.5,
      market_cap: 68_200_000_000,
      total_volume: 2_100_000_000,
      price_change_percentage_24h: -2.3,
      price_change_percentage_7d_in_currency: 5.1,
      ath_distance_pct: -45.2,
      fully_diluted_valuation: 72_100_000_000,
      market_cap_rank: 5,
      ...overrides.market,
    },
    onchain: {
      tvl: 12_500_000_000,
      tvl_change_7d: 3.2,
      fees_7d: 4_200_000,
      revenue_7d: 1_800_000,
      ...overrides.onchain,
    },
    social: {
      mentions: 85,
      filtered_mentions: 72,
      sentiment_score: 0.3,
      ...overrides.social,
    },
    github: {
      commits_90d: 450,
      contributors: 120,
      stars: 15234,
      commit_trend: 'accelerating',
      ...overrides.github,
    },
    dex: {
      dex_price_usd: 142.48,
      dex_liquidity_usd: 45_000_000,
      dex_pair_count: 23,
      buy_sell_ratio: 1.2,
      ...overrides.dex,
    },
    tokenomics: {
      pct_circulating: 78,
      ...overrides.tokenomics,
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// validateReport tests
// ═══════════════════════════════════════════════════════════════════

test('validateReport catches fabricated market cap numbers', () => {
  const rawData = makeRawData(); // market_cap = 68.2B
  const report = makeReport({
    analysis_text: 'The project has a market cap of $120 Billion, making it a top contender.',
  });

  const validated = validateReport(report, rawData);
  const warnings = validated._validation.warnings;

  assert.ok(
    warnings.some((w) => w.includes('Market cap') && w.includes('deviates')),
    `Expected market cap deviation warning, got: ${JSON.stringify(warnings)}`
  );
});

test('validateReport does NOT flag accurate market cap numbers', () => {
  const rawData = makeRawData(); // market_cap = 68.2B
  const report = makeReport({
    analysis_text: 'The project has a market cap of $68.2 Billion.',
  });

  const validated = validateReport(report, rawData);
  const warnings = validated._validation.warnings;

  const mcapWarnings = warnings.filter((w) => w.includes('Market cap') && w.includes('deviates'));
  assert.equal(mcapWarnings.length, 0, `Did not expect market cap warning, got: ${JSON.stringify(mcapWarnings)}`);
});

test('validateReport catches fabricated TVL numbers', () => {
  const rawData = makeRawData(); // tvl = 12.5B
  const report = makeReport({
    analysis_text: 'TVL stands at $50 Billion, showing massive capital inflow.',
  });

  const validated = validateReport(report, rawData);
  const warnings = validated._validation.warnings;

  assert.ok(
    warnings.some((w) => w.includes('TVL') && w.includes('deviates')),
    `Expected TVL deviation warning, got: ${JSON.stringify(warnings)}`
  );
});

test('validateReport does NOT flag accurate TVL numbers', () => {
  const rawData = makeRawData(); // tvl = 12.5B
  const report = makeReport({
    analysis_text: 'TVL is $12.5 Billion, representing strong capital lock.',
  });

  const validated = validateReport(report, rawData);
  const warnings = validated._validation.warnings;

  const tvlWarnings = warnings.filter((w) => w.includes('TVL') && w.includes('deviates'));
  assert.equal(tvlWarnings.length, 0, `Did not expect TVL warning, got: ${JSON.stringify(tvlWarnings)}`);
});

test('validateReport flags catalysts with unverified timelines', () => {
  const rawData = makeRawData();
  const report = makeReport({
    catalysts: [
      'Major upgrade expected Q2 2026',
      'Token burn event in January 2027',
      'Active development continues [source: RAW_DATA.github.commits_90d]',
    ],
  });

  const validated = validateReport(report, rawData);

  // First two catalysts should get [Unverified timeline] prefix
  const timelineCatalysts = validated.catalysts.filter((c) => c.includes('[Unverified timeline]'));
  assert.ok(
    timelineCatalysts.length >= 2,
    `Expected at least 2 unverified timeline catalysts, got ${timelineCatalysts.length}: ${JSON.stringify(validated.catalysts)}`
  );

  // Third catalyst with source tag should NOT get unverified prefix
  const verifiedCatalyst = validated.catalysts.find((c) => c.includes('Active development'));
  assert.ok(verifiedCatalyst, 'Verified catalyst should still exist');
  assert.ok(!verifiedCatalyst.includes('[Unverified timeline]'), 'Verified catalyst should not have unverified prefix');
});

test('validateReport sanitizes x_sentiment when no social data exists', () => {
  // No social data at all
  const rawData = makeRawData({
    social: { error: 'No social data', mentions: 0, filtered_mentions: 0 },
  });

  const report = makeReport({
    x_sentiment_summary:
      'The community is extremely bullish with @CryptoKing and @WhaleAlert discussing massive accumulation patterns. ' +
      'Multiple influencers have endorsed the project, including @DefiGuru who called it the next 100x gem.',
  });

  const validated = validateReport(report, rawData);

  assert.ok(
    validated.x_sentiment_summary.includes('Limited'),
    `Expected sanitized sentiment, got: "${validated.x_sentiment_summary}"`
  );
  assert.ok(
    validated._validation.warnings.some((w) => w.includes('x_sentiment_summary')),
    'Expected warning about unverified sentiment claims'
  );
});

test('validateReport preserves x_sentiment when social data exists', () => {
  const rawData = makeRawData(); // has mentions: 85
  const sentimentText = 'Community is actively discussing the protocol with bullish sentiment.';
  const report = makeReport({
    x_sentiment_summary: sentimentText,
  });

  const validated = validateReport(report, rawData);
  assert.equal(validated.x_sentiment_summary, sentimentText);
});

test('validateReport detects hallucination patterns (fake partnerships, funding)', () => {
  const rawData = makeRawData();
  const report = makeReport({
    analysis_text: 'The project recently announced a partnership with Google Cloud and raised $50M in a Series B funding round.',
  });

  const validated = validateReport(report, rawData);
  const warnings = validated._validation.warnings;

  assert.ok(
    warnings.some((w) => w.includes('partnership with Google')),
    `Expected partnership hallucination warning, got: ${JSON.stringify(warnings)}`
  );
  assert.ok(
    warnings.some((w) => w.includes('$50M') || w.includes('Series B') || w.includes('funding')),
    `Expected funding hallucination warning, got: ${JSON.stringify(warnings)}`
  );
});

test('validateReport: source tags only on facts_verified, NOT on user-facing fields', () => {
  const rawData = makeRawData();
  const report = makeReport({
    key_findings: ['Market cap is growing fast', 'TVL up 10% [source: RAW_DATA.onchain.tvl_change_7d]'],
    risks: ['Smart contract risk: unaudited code'],
    facts_verified: ['Price went up yesterday'],
  });

  const validated = validateReport(report, rawData);

  // key_findings is user-facing — should NOT get [source: missing]
  assert.ok(
    !validated.key_findings[0].includes('[source: missing]'),
    `User-facing key_findings should NOT get source tags: "${validated.key_findings[0]}"`
  );

  // risks is user-facing — should NOT get [source: missing]
  assert.ok(
    !validated.risks[0].includes('[source: missing]'),
    `User-facing risks should NOT get source tags: "${validated.risks[0]}"`
  );

  // facts_verified is the ONLY field that should get [source: missing]
  assert.ok(
    validated.facts_verified[0].includes('[source: missing]'),
    `facts_verified should get source tag: "${validated.facts_verified[0]}"`
  );
});

// ═══════════════════════════════════════════════════════════════════
// buildDataSummary tests
// ═══════════════════════════════════════════════════════════════════

test('buildDataSummary produces output under 3000 chars', () => {
  const rawData = makeRawData();
  const summary = buildDataSummary(rawData);

  assert.ok(typeof summary === 'string', 'Summary should be a string');
  assert.ok(summary.length > 0, 'Summary should not be empty');
  assert.ok(
    summary.length <= 3000,
    `Summary should be ≤3000 chars, got ${summary.length}`
  );
});

test('buildDataSummary correctly labels missing data', () => {
  const rawData = makeRawData({
    holders: null,
    contract: null,
    reddit: null,
    ecosystem: null,
  });

  const summary = buildDataSummary(rawData);

  // Should mention data gaps
  assert.ok(
    summary.includes('DATA GAPS') || summary.includes('no data') || summary.includes('missing'),
    `Summary should indicate missing data sections, got:\n${summary}`
  );
});

test('buildDataSummary includes available data sections', () => {
  const rawData = makeRawData();
  const summary = buildDataSummary(rawData);

  // Should have MARKET section
  assert.ok(summary.includes('MARKET'), `Summary should include MARKET section`);
  // Should have ONCHAIN section
  assert.ok(summary.includes('ONCHAIN'), `Summary should include ONCHAIN section`);
  // Should have price data
  assert.ok(summary.includes('142'), `Summary should include price data`);
});

test('buildDataSummary handles completely empty rawData', () => {
  const summary = buildDataSummary({});

  assert.ok(typeof summary === 'string', 'Should return string for empty data');
  assert.ok(summary.length > 0, 'Should not be empty even with no data');
  assert.ok(summary.length <= 3000, 'Should still be under 3000 chars');
});

test('buildDataSummary formats numbers readably', () => {
  const rawData = makeRawData({
    market: {
      current_price: 142.5,
      market_cap: 68_200_000_000,
      total_volume: 2_100_000_000,
    },
  });

  const summary = buildDataSummary(rawData);

  // Should use B/M/K format, not raw numbers
  assert.ok(
    !summary.includes('68200000000'),
    `Should not contain raw number 68200000000, got:\n${summary}`
  );
});

test('buildDataSummary omits null/undefined values', () => {
  const rawData = makeRawData({
    market: {
      current_price: 100,
      market_cap: null,
      total_volume: undefined,
    },
    onchain: {
      tvl: null,
    },
  });

  const summary = buildDataSummary(rawData);

  // Should include price but not "null" or "undefined" literals
  assert.ok(!summary.includes(': null'), `Should not contain literal null values`);
  assert.ok(!summary.includes(': undefined'), `Should not contain literal undefined values`);
});

test('fallbackReport fails gracefully without inventing analysis fields', () => {
  const rawData = makeRawData({
    market: {
      current_price: 92.48,
      market_cap: 68_200_000_000,
      total_volume: 2_100_000_000,
      price_change_percentage_24h: -2.3,
      price_change_percentage_7d_in_currency: 5.1,
    },
    onchain: {
      tvl: 12_500_000_000,
      tvl_change_7d: 3.2,
    },
  });

  const report = fallbackReport('SOL', rawData, { overall: { score: 5.8 } }, 'XAI_API_KEY missing');

  assert.equal(report.headline, null);
  assert.equal(report.analysis_text, null);
  assert.equal(report.project_summary, null);
  assert.equal(report.project_category, null);
});
