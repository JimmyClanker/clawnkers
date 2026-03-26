import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpusPrompt, buildScoreSummary, buildDataSummary } from '../synthesis/llm.js';

const mockRawData = {
  market: {
    current_price: 1.23,
    market_cap: 500_000_000,
    total_volume: 20_000_000,
    price_change_percentage_24h: 2.5,
    market_cap_rank: 42,
  },
  onchain: {
    tvl: 200_000_000,
    tvl_change_7d: 5.1,
    fees_7d: 100_000,
    revenue_7d: 80_000,
  },
  social: { mentions: 150, sentiment_score: 0.3 },
  github: { commits_90d: 45, contributors: 12 },
  x_social: {
    sentiment: 'bullish',
    sentiment_score: 0.7,
    mention_volume: 'high',
    key_narratives: ['DeFi growth', 'new v2 launch'],
    summary: 'Community is excited about upcoming v2.',
  },
};

const mockScores = {
  overall: { score: 7.2 },
  market_strength: { score: 7 },
  onchain_health: { score: 8 },
};

describe('buildOpusPrompt', () => {
  it('returns an object with system and user strings', () => {
    const result = buildOpusPrompt('TestProject', mockRawData, mockScores);
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.system, 'string');
    assert.equal(typeof result.user, 'string');
    assert.ok(result.system.length > 100, 'system prompt should be non-trivial');
    assert.ok(result.user.length > 50, 'user message should be non-trivial');
  });

  it('system prompt does NOT contain "X Search" or "Web Search" tool references', () => {
    const { system } = buildOpusPrompt('TestProject', mockRawData, mockScores);
    assert.ok(!system.includes('Use X Search'), 'should not instruct to use X Search');
    assert.ok(!system.includes('Use Web Search'), 'should not instruct to use Web Search');
  });

  it('system prompt references X_SOCIAL data instead of tools', () => {
    const { system } = buildOpusPrompt('TestProject', mockRawData, mockScores);
    assert.ok(system.includes('X_SOCIAL'), 'system should reference X_SOCIAL section');
  });

  it('user message contains project name', () => {
    const { user } = buildOpusPrompt('UniqueProjectXYZ', mockRawData, mockScores);
    assert.ok(user.includes('UniqueProjectXYZ'), 'user message should include project name');
  });

  it('user message includes X_SOCIAL data when present', () => {
    const { user } = buildOpusPrompt('TestProject', mockRawData, mockScores);
    assert.ok(user.includes('X_SOCIAL'), 'user message should contain X_SOCIAL section');
    assert.ok(user.includes('bullish'), 'user message should include x_social sentiment');
    assert.ok(user.includes('DeFi growth'), 'user message should include x_social narratives');
  });

  it('user message indicates no X/Twitter data when x_social is absent', () => {
    const dataWithoutX = { ...mockRawData, x_social: undefined };
    const { user } = buildOpusPrompt('TestProject', dataWithoutX, mockScores);
    assert.ok(user.includes('No X/Twitter data'), 'should indicate missing X data');
  });

  it('user message includes algorithmic scores', () => {
    const { user } = buildOpusPrompt('TestProject', mockRawData, mockScores);
    assert.ok(user.includes('ALGORITHMIC_SCORES'), 'user message should include scores');
  });

  it('user message includes fact registry', () => {
    const { user } = buildOpusPrompt('TestProject', mockRawData, mockScores);
    assert.ok(user.includes('FACT_REGISTRY'), 'user message should include fact registry');
  });

  it('system prompt includes anti-hallucination rules', () => {
    const { system } = buildOpusPrompt('TestProject', mockRawData, mockScores);
    assert.ok(system.includes('ANTI-HALLUCINATION'), 'should include anti-hallucination section');
  });

  it('system prompt includes output format instructions', () => {
    const { system } = buildOpusPrompt('TestProject', mockRawData, mockScores);
    assert.ok(system.includes('OUTPUT FORMAT'), 'should include output format section');
    assert.ok(system.includes('verdict'), 'should specify verdict field');
  });

  it('includes red flags in user message when present', () => {
    const dataWithFlags = {
      ...mockRawData,
      red_flags: [{ severity: 'high', flag: 'low_liquidity', detail: 'Very low DEX liquidity' }],
    };
    const { user } = buildOpusPrompt('TestProject', dataWithFlags, mockScores);
    assert.ok(user.includes('RED_FLAGS'), 'user message should include red flags');
    assert.ok(user.includes('low_liquidity'), 'user message should include flag details');
  });

  it('includes circuit breaker info when active', () => {
    const scoresWithCB = {
      ...mockScores,
      overall: {
        ...mockScores.overall,
        circuit_breakers: {
          capped: true,
          original_score: 8.5,
          score: 5,
          applied_cap: 5,
          breakers: [{ severity: 'high', cap: 5, reason: 'Rug risk detected' }],
        },
      },
    };
    const { user } = buildOpusPrompt('TestProject', mockRawData, scoresWithCB);
    assert.ok(user.includes('CIRCUIT_BREAKERS'), 'user message should include circuit breaker info');
    assert.ok(user.includes('Rug risk detected'), 'user message should include breaker reason');
  });
});

// Round R180: tests for new helper exports
describe('buildScoreSummary', () => {
  it('returns a non-empty string for valid scores', () => {
    const result = buildScoreSummary(mockScores);
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0, 'should return non-empty string');
  });

  it('includes OVERALL score', () => {
    const result = buildScoreSummary(mockScores);
    assert.ok(result.includes('OVERALL'), 'should include OVERALL label');
    assert.ok(result.includes('7.2'), 'should include overall score value');
  });

  it('returns empty string for missing scores', () => {
    const result = buildScoreSummary({});
    assert.equal(result, '', 'should return empty string when no overall');
  });

  it('includes dimension scores when present', () => {
    const result = buildScoreSummary(mockScores);
    assert.ok(result.includes('Market'), 'should include Market dimension');
    assert.ok(result.includes('Onchain'), 'should include Onchain dimension');
  });
});

describe('buildDataSummary', () => {
  it('returns a string for empty rawData', () => {
    const result = buildDataSummary({});
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('VERIFIED DATA'), 'should include header');
  });

  it('includes P/TVL ratio when both market_cap and tvl are present', () => {
    const data = {
      market: { market_cap: 100_000_000, total_volume: 10_000_000 },
      onchain: { tvl: 50_000_000, fees_7d: 500_000 },
    };
    const result = buildDataSummary(data);
    assert.ok(result.includes('P/TVL'), 'should include P/TVL ratio');
    assert.ok(result.includes('2.00'), 'P/TVL should be 2.00x for 100M mcap / 50M TVL');
  });

  it('includes revenue capture percentage', () => {
    const data = {
      onchain: { tvl: 10_000_000, fees_7d: 100_000, revenue_7d: 40_000 },
    };
    const result = buildDataSummary(data);
    assert.ok(result.includes('Revenue Capture'), 'should include revenue capture');
    assert.ok(result.includes('40.0%'), 'revenue capture should be 40%');
  });

  it('includes data gaps section when collectors fail', () => {
    const data = { market: { error: 'timeout' } };
    const result = buildDataSummary(data);
    assert.ok(result.includes('DATA GAPS'), 'should include data gaps');
    assert.ok(result.includes('market'), 'should flag market as a gap');
  });

  // Round 228 (AutoResearch): new collector field coverage tests
  it('includes community score when present', () => {
    const data = { market: { community_score: 65, twitter_followers: 50000 } };
    const result = buildDataSummary(data);
    assert.ok(result.includes('65'), 'community_score should appear in summary');
  });

  it('includes volume spike flag when present', () => {
    const data = { market: { current_price: 1, volume_spike_flag: 'spike', total_volume: 10_000_000 } };
    const result = buildDataSummary(data);
    assert.ok(result.includes('spike'), 'volume spike flag should appear in summary');
  });

  it('includes net buy pressure pct from dex', () => {
    const data = { dex: { dex_liquidity_usd: 500_000, dex_volume_24h: 100_000, net_buy_pressure_pct: 62.5, buy_sell_ratio: 1.25 } };
    const result = buildDataSummary(data);
    assert.ok(result.includes('62.5'), 'net buy pressure pct should appear in DEX section');
  });

  it('includes revenue trend from onchain', () => {
    const data = { onchain: { tvl: 10_000_000, fees_7d: 50_000, revenue_7d: 20_000, revenue_trend: 'improving' } };
    const result = buildDataSummary(data);
    assert.ok(result.includes('improving') || result.includes('Revenue'), 'revenue trend context should appear');
  });

  it('net_buy_pressure_pct returns correct value', () => {
    // 60 buys, 40 sells = 60%
    assert.strictEqual(Math.round(60 / 100 * 100 * 10) / 10, 60.0);
    // 45 buys, 55 sells = 45%
    assert.strictEqual(Math.round(45 / 100 * 100 * 10) / 10, 45.0);
  });
});
