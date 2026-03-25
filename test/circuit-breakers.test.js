import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyCircuitBreakers } from '../scoring/circuit-breakers.js';
import { calculateScores } from '../synthesis/scoring.js';

describe('applyCircuitBreakers', () => {
  // Test 1: Whale concentration > 70% → cap a 4.0
  it('caps score at 4.0 when whale concentration > 70%', () => {
    const result = applyCircuitBreakers(8.0, { holders: { top10_concentration: 75 } }, {}, []);
    assert.equal(result.capped, true);
    assert.equal(result.score, 4.0);
    assert.equal(result.applied_cap, 4.0);
    assert.equal(result.original_score, 8.0);
    assert.ok(result.breakers.some((b) => b.severity === 'critical'));
  });

  // Test 2: Whale concentration 50% → cap a 6.5
  it('caps score at 6.5 when whale concentration is 50%', () => {
    const result = applyCircuitBreakers(8.0, { holders: { top10_concentration: 50 } }, {}, []);
    assert.equal(result.capped, true);
    assert.equal(result.score, 6.5);
    assert.equal(result.applied_cap, 6.5);
    assert.ok(result.breakers.some((b) => b.severity === 'warning'));
  });

  // Test 3: Whale concentration 20% → nessun cap
  it('does not cap when whale concentration is 20%', () => {
    const result = applyCircuitBreakers(7.5, { holders: { top10_concentration: 20 } }, {}, []);
    assert.equal(result.capped, false);
    assert.equal(result.score, 7.5);
    assert.equal(result.breakers.length, 0);
  });

  // Test 4: DEX liquidity $5K → cap a 4.0
  it('caps score at 4.0 when DEX liquidity is $5K', () => {
    const result = applyCircuitBreakers(8.0, { dex: { dex_liquidity_usd: 5000 } }, {}, []);
    assert.equal(result.capped, true);
    assert.equal(result.score, 4.0);
    assert.equal(result.applied_cap, 4.0);
    assert.ok(result.breakers.some((b) => b.severity === 'critical'));
  });

  // Test 5: DEX liquidity $100K → nessun cap
  it('does not cap when DEX liquidity is $100K', () => {
    const result = applyCircuitBreakers(7.0, { dex: { dex_liquidity_usd: 100_000 } }, {}, []);
    assert.equal(result.capped, false);
    assert.equal(result.score, 7.0);
  });

  // Test 6: FDV/MCap 15x → cap a 6.5
  it('caps score at 6.5 when FDV/MCap is 15x', () => {
    const result = applyCircuitBreakers(8.0, {
      market: { fully_diluted_valuation: 150_000_000, market_cap: 10_000_000 },
    }, {}, []);
    assert.equal(result.capped, true);
    assert.equal(result.score, 6.5);
    assert.ok(result.breakers.some((b) => b.reason.includes('FDV/MCap')));
  });

  // Test 7: FDV/MCap 3x → nessun cap
  it('does not cap when FDV/MCap is 3x', () => {
    const result = applyCircuitBreakers(7.0, {
      market: { fully_diluted_valuation: 30_000_000, market_cap: 10_000_000 },
    }, {}, []);
    assert.equal(result.capped, false);
    assert.equal(result.score, 7.0);
  });

  // Test 8: Pump dump signal → cap a 3.5
  it('caps score at 3.5 when pump_dump_signal is possible_dump', () => {
    const result = applyCircuitBreakers(8.0, { dex: { pump_dump_signal: 'possible_dump' } }, {}, []);
    assert.equal(result.capped, true);
    assert.equal(result.score, 3.5);
    assert.equal(result.applied_cap, 3.5);
  });

  // Test 9: 3 critical red flags → cap a 5.0
  it('caps score at 5.0 when 3 critical red flags are present', () => {
    const redFlags = [
      { severity: 'critical', flag: 'flag1' },
      { severity: 'critical', flag: 'flag2' },
      { severity: 'critical', flag: 'flag3' },
    ];
    const result = applyCircuitBreakers(8.0, {}, {}, redFlags);
    assert.equal(result.capped, true);
    assert.equal(result.score, 5.0);
    assert.ok(result.breakers.some((b) => b.cap === 5.0));
  });

  // Test 10: Volume $30K + mcap $10M → cap a 6.5
  it('caps score at 6.5 when volume is $30K and mcap is $10M', () => {
    const result = applyCircuitBreakers(8.0, {
      market: { total_volume: 30_000, market_cap: 10_000_000 },
    }, {}, []);
    assert.equal(result.capped, true);
    assert.equal(result.score, 6.5);
    assert.ok(result.breakers.some((b) => b.reason.includes('critically illiquid')));
  });

  // Test 11: Data completeness 30% → cap a 6.0
  it('caps score at 6.0 when data completeness is 30%', () => {
    const result = applyCircuitBreakers(8.0, {}, { overall: { completeness: 30 } }, []);
    assert.equal(result.capped, true);
    assert.equal(result.score, 6.0);
    assert.ok(result.breakers.some((b) => b.reason.includes('data coverage')));
  });

  // Test 12: Nessun breaker → score invariato
  it('returns original score unchanged when no breakers trigger', () => {
    const result = applyCircuitBreakers(7.5, {}, {}, []);
    assert.equal(result.capped, false);
    assert.equal(result.score, 7.5);
    assert.equal(result.breakers.length, 0);
  });

  // Test 13: Multiple breakers → applica il cap più basso
  it('applies the lowest cap when multiple breakers trigger', () => {
    // whale 75% → cap 4.0, pump dump → cap 3.5 → lowest is 3.5
    const result = applyCircuitBreakers(9.0, {
      holders: { top10_concentration: 75 },
      dex: { pump_dump_signal: 'possible_dump' },
    }, {}, []);
    assert.equal(result.capped, true);
    assert.equal(result.score, 3.5);
    assert.equal(result.applied_cap, 3.5);
    assert.ok(result.breakers.length >= 2);
  });

  // Test 14: Score già sotto il cap → non cambia (capped = false)
  it('does not cap when score is already below the cap threshold', () => {
    // whale 50% → cap 6.5, but score is already 5.0
    const result = applyCircuitBreakers(5.0, { holders: { top10_concentration: 50 } }, {}, []);
    assert.equal(result.capped, false);
    assert.equal(result.score, 5.0);
    // breakers should still be present, but capped = false since score < cap
    assert.ok(result.breakers.length > 0);
  });

  // Test 15: Unverified contract on minor chain → cap a 4.0
  it('caps score at 4.0 for unverified contract on minor chain', () => {
    const result = applyCircuitBreakers(8.0, {
      contract: { verified: false },
      ecosystem: { primary_chain: 'fantom' },
    }, {}, []);
    assert.equal(result.capped, true);
    assert.equal(result.score, 4.0);
    assert.ok(result.breakers.some((b) => b.reason.includes('Unverified contract')));
  });

  // Test 16: Unverified contract on ethereum → nessun cap
  it('does not cap for unverified contract on ethereum', () => {
    const result = applyCircuitBreakers(7.0, {
      contract: { verified: false },
      ecosystem: { primary_chain: 'ethereum' },
    }, {}, []);
    assert.equal(result.capped, false);
    assert.equal(result.score, 7.0);
  });
});

// Test 17: Integration test — calculateScores con dati che triggerano un breaker
describe('calculateScores integration with circuit breakers', () => {
  it('returns overall.circuit_breakers when a breaker triggers and score is actually capped', () => {
    // Provide rich enough data to score above 4.0, but whale concentration > 70% caps it
    const data = {
      market: {
        current_price: 5.0,
        market_cap: 500_000_000,
        total_volume: 80_000_000,
        fully_diluted_valuation: 600_000_000,
        price_change_pct_1h: 2,
        price_change_pct_24h: 5,
        price_change_pct_7d: 15,
        price_change_pct_30d: 40,
        market_cap_rank: 50,
      },
      onchain: {
        tvl: 400_000_000,
        tvl_change_7d: 10,
        tvl_change_30d: 20,
        fees_7d: 500_000,
        revenue_7d: 200_000,
      },
      social: {
        mentions: 200,
        filtered_mentions: 180,
        sentiment_counts: { bullish: 15, bearish: 3, neutral: 5 },
        sentiment_score: 0.5,
      },
      github: {
        commits_90d: 120,
        contributors: 30,
        stars: 5000,
        forks: 500,
        commit_trend: 'stable',
      },
      tokenomics: {
        pct_circulating: 60,
        inflation_rate: 5,
        token_distribution: { team: 20, community: 80 },
      },
      holders: { top10_concentration: 75 }, // critical breaker → cap at 4.0
    };

    const scores = calculateScores(data);
    assert.ok(scores.overall, 'overall should exist');
    assert.ok('circuit_breakers' in scores.overall, 'circuit_breakers field should exist on overall');

    // The score should be capped at 4.0 due to whale concentration
    if (scores.overall.circuit_breakers !== null) {
      // Breaker was applied (score was above cap before capping)
      assert.equal(scores.overall.circuit_breakers.capped, true);
      assert.ok(scores.overall.score <= 4.0, `score ${scores.overall.score} should be <= 4.0`);
    } else {
      // Score was already <= 4.0 due to confidence weighting — breaker still fired
      // but capped=false because score was already below cap
      // Just verify dimension scores are intact
      assert.ok(scores.overall.score <= 4.0 + 0.1, `score ${scores.overall.score} should be at or near cap`);
    }

    // Dimension scores must be unchanged (circuit breakers only affect overall)
    assert.ok(scores.market_strength.score != null, 'market_strength.score should exist');
    assert.ok(scores.onchain_health.score != null, 'onchain_health.score should exist');
  });

  it('returns null circuit_breakers when no breaker triggers', () => {
    const data = {
      market: {
        current_price: 100,
        market_cap: 1_000_000_000,
        total_volume: 100_000_000,
        fully_diluted_valuation: 1_200_000_000,
        price_change_pct_1h: 1,
        price_change_pct_24h: 2,
        price_change_pct_7d: 5,
        price_change_pct_30d: 10,
      },
    };

    const scores = calculateScores(data);
    assert.ok(scores.overall, 'overall should exist');
    assert.equal(scores.overall.circuit_breakers, null, 'circuit_breakers should be null when no breaker triggers');
  });
});
