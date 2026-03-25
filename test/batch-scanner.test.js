/**
 * batch-scanner.test.js — Tests for Phase 4 periodic scanning infrastructure
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { seedUniverse, buildTokenList } from '../calibration/seed-universe.js';
import { runBatchScan } from '../calibration/batch-scanner.js';
import { trackOutcomes, matchingCheckpoints, __resetBtcCacheForTests } from '../calibration/outcome-tracker.js';
import { collectXSocial } from '../collectors/x-social.js';
import { getCalibrationDb, __resetCalibrationDbForTests } from '../calibration/db.js';
import { __resetSnapshotStoreForTests } from '../calibration/snapshot-store.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTestDb() {
  // Use in-memory DB for tests
  const origEnv = process.env.CALIBRATION_DB_PATH;
  process.env.CALIBRATION_DB_PATH = ':memory:';
  __resetCalibrationDbForTests();
  __resetSnapshotStoreForTests();
  const db = getCalibrationDb();
  return {
    db,
    cleanup() {
      __resetCalibrationDbForTests();
      if (origEnv === undefined) {
        delete process.env.CALIBRATION_DB_PATH;
      } else {
        process.env.CALIBRATION_DB_PATH = origEnv;
      }
    },
  };
}

// ─── seed-universe tests ───────────────────────────────────────────────────────

test('buildTokenList: deduplicates correctly across groups', () => {
  const topTokens = [
    { coingecko_id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', group: 'top' },
    { coingecko_id: 'ethereum', symbol: 'ETH', name: 'Ethereum', group: 'top' },
    { coingecko_id: 'solana', symbol: 'SOL', name: 'Solana', group: 'top' },
  ];

  const list = buildTokenList(topTokens);

  // No duplicates
  const ids = list.map((t) => t.coingecko_id);
  const unique = new Set(ids);
  assert.equal(ids.length, unique.size, 'Should have no duplicate coingecko_ids');

  // ethereum is in both top and l1l2 — should appear once
  const ethEntries = list.filter((t) => t.coingecko_id === 'ethereum');
  assert.equal(ethEntries.length, 1, 'ethereum should appear exactly once');
});

test('buildTokenList: includes all expected categories', () => {
  const list = buildTokenList([]);
  const categories = new Set(list.map((t) => t.category).filter(Boolean));
  assert.ok(categories.has('defi'), 'Should include defi category');
  assert.ok(categories.has('ai_infrastructure'), 'Should include ai_infrastructure category');
  assert.ok(categories.has('meme'), 'Should include meme category');
  assert.ok(categories.has('l1l2'), 'Should include l1l2 category');
  assert.ok(categories.has('emerging'), 'Should include emerging category');
});

test('buildTokenList: tier A assigned to defi, ai, l1l2', () => {
  const list = buildTokenList([]);
  const aave = list.find((t) => t.coingecko_id === 'aave');
  assert.ok(aave, 'aave should be in the list');
  assert.equal(aave.tier, 'A', 'aave should have tier A');

  const ethereum = list.find((t) => t.coingecko_id === 'ethereum');
  assert.ok(ethereum, 'ethereum should be in the list');
  assert.equal(ethereum.tier, 'A', 'ethereum should have tier A');
});

test('buildTokenList: tier B assigned to meme and emerging', () => {
  const list = buildTokenList([]);
  const doge = list.find((t) => t.coingecko_id === 'dogecoin');
  assert.ok(doge, 'dogecoin should be in the list');
  assert.equal(doge.tier, 'B', 'dogecoin should have tier B');

  const ethena = list.find((t) => t.coingecko_id === 'ethena');
  assert.ok(ethena, 'ethena should be in the list');
  assert.equal(ethena.tier, 'B', 'ethena should have tier B');
});

test('seedUniverse: inserts tokens idempotently', async () => {
  const { db, cleanup } = createTestDb();

  try {
    // First seed
    const result1 = await seedUniverse({
      db,
      skipFetch: true,
    });
    assert.ok(result1.inserted > 0, 'First seed should insert tokens');
    assert.equal(result1.skipped, 0, 'First seed should skip nothing');

    // Second seed (idempotent)
    const result2 = await seedUniverse({
      db,
      skipFetch: true,
    });
    assert.equal(result2.inserted, 0, 'Second seed should insert nothing');
    assert.ok(result2.skipped > 0, 'Second seed should skip all');

    // Verify total in DB
    const count = db.prepare('SELECT COUNT(*) as c FROM token_universe').get().c;
    assert.equal(count, result1.total, 'DB should have exactly as many tokens as first seed inserted');
  } finally {
    cleanup();
  }
});

test('seedUniverse: uses injected top tokens', async () => {
  const { db, cleanup } = createTestDb();

  try {
    const topTokens = [
      { coingecko_id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
      { coingecko_id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
    ];

    const result = await seedUniverse({ db, topTokens });
    assert.ok(result.total > 0, 'Should have tokens after seed');

    const btc = db.prepare("SELECT * FROM token_universe WHERE coingecko_id = 'bitcoin'").get();
    assert.ok(btc, 'bitcoin should be in universe');
    assert.equal(btc.symbol, 'BTC');
  } finally {
    cleanup();
  }
});

// ─── batch-scanner tests ───────────────────────────────────────────────────────

test('runBatchScan: returns empty summary when no tokens in universe', async () => {
  const { db, cleanup } = createTestDb();

  try {
    const summary = await runBatchScan({ db, tier: 'A', level: 0, limit: 10, rateLimitMs: 0 });
    assert.equal(summary.scanned, 0, 'Should scan 0 tokens');
    assert.equal(summary.succeeded, 0);
    assert.equal(summary.failed, 0);
  } finally {
    cleanup();
  }
});

test('runBatchScan: scans tokens from universe with mock collector', async () => {
  const { db, cleanup } = createTestDb();

  try {
    // Seed a couple of tokens
    db.prepare("INSERT INTO token_universe (symbol, name, coingecko_id, tier, category) VALUES ('BTC', 'Bitcoin', 'bitcoin', 'A', 'store-of-value')").run();
    db.prepare("INSERT INTO token_universe (symbol, name, coingecko_id, tier, category) VALUES ('ETH', 'Ethereum', 'ethereum', 'A', 'l1l2')").run();

    const mockCollect = async (projectName, level) => ({
      project_name: projectName,
      market: { current_price: 50000, market_cap: 1e12, symbol: projectName.toUpperCase() },
      metadata: { scan_level: level },
    });

    const mockScore = (rawData) => ({
      overall: { score: 7.5, completeness: 0.8 },
    });

    const snapshots = [];
    const mockSnapshot = async (projectName, rawData, scores) => {
      const id = snapshots.length + 1;
      snapshots.push({ id, projectName });
      return id;
    };

    const summary = await runBatchScan({
      db,
      tier: 'A',
      level: 1,
      limit: 10,
      collectFn: mockCollect,
      scoreFn: mockScore,
      snapshotFn: mockSnapshot,
      rateLimitMs: 0,
    });

    assert.equal(summary.scanned, 2, 'Should scan 2 tokens');
    assert.equal(summary.succeeded, 2, 'Both should succeed');
    assert.equal(summary.failed, 0);
    assert.equal(snapshots.length, 2, 'Should save 2 snapshots');
  } finally {
    cleanup();
  }
});

test('runBatchScan: handles collector errors gracefully', async () => {
  const { db, cleanup } = createTestDb();

  try {
    db.prepare("INSERT INTO token_universe (symbol, name, coingecko_id, tier) VALUES ('FAIL', 'FailToken', 'fail-token', 'A')").run();

    const mockCollect = async () => {
      throw new Error('Simulated collector failure');
    };

    const mockScore = () => ({});
    const mockSnapshot = async () => 1;

    const summary = await runBatchScan({
      db,
      tier: 'A',
      level: 1,
      limit: 5,
      collectFn: mockCollect,
      scoreFn: mockScore,
      snapshotFn: mockSnapshot,
      rateLimitMs: 0,
    });

    assert.equal(summary.scanned, 1);
    assert.equal(summary.failed, 1, 'Should record failure');
    assert.equal(summary.succeeded, 0);
    assert.equal(summary.tokens[0].ok, false);
    assert.ok(summary.tokens[0].error, 'Should have error message');
  } finally {
    cleanup();
  }
});

test('runBatchScan: respects tier filter', async () => {
  const { db, cleanup } = createTestDb();

  try {
    db.prepare("INSERT INTO token_universe (symbol, name, coingecko_id, tier) VALUES ('BTC', 'Bitcoin', 'bitcoin', 'A')").run();
    db.prepare("INSERT INTO token_universe (symbol, name, coingecko_id, tier) VALUES ('DOGE', 'Dogecoin', 'dogecoin', 'B')").run();

    const scanned = [];
    const mockCollect = async (projectName, level) => {
      scanned.push(projectName);
      return { project_name: projectName, market: {} };
    };

    await runBatchScan({
      db,
      tier: 'A',
      level: 0,
      limit: 10,
      collectFn: mockCollect,
      scoreFn: () => ({}),
      snapshotFn: async () => 1,
      rateLimitMs: 0,
    });

    assert.ok(scanned.includes('bitcoin'), 'BTC (tier A) should be scanned');
    assert.ok(!scanned.includes('dogecoin'), 'DOGE (tier B) should NOT be scanned when tier=A');
  } finally {
    cleanup();
  }
});

// ─── outcome-tracker tests ───────────────────────────────────────────────────

test('matchingCheckpoints: returns correct checkpoints within tolerance', () => {
  // Exactly 7 days
  assert.deepEqual(matchingCheckpoints(7), [7]);
  // 7 + tolerance
  assert.deepEqual(matchingCheckpoints(8), [7]);
  assert.deepEqual(matchingCheckpoints(6), [7]);
  // 14 days
  assert.deepEqual(matchingCheckpoints(14), [14]);
  // 30 days
  assert.deepEqual(matchingCheckpoints(30), [30]);
  // Between checkpoints — no match
  assert.deepEqual(matchingCheckpoints(10), []);
  // Too old
  assert.deepEqual(matchingCheckpoints(100), []);
  // Very fresh
  assert.deepEqual(matchingCheckpoints(1), []);
});

test('matchingCheckpoints: handles boundary cases', () => {
  // 13d = 14-1 tolerance → matches 14
  assert.deepEqual(matchingCheckpoints(13), [14]);
  // 15d = 14+1 tolerance → matches 14
  assert.deepEqual(matchingCheckpoints(15), [14]);
  // 91d = 90+1 → matches 90
  assert.deepEqual(matchingCheckpoints(91), [90]);
  // 89d = 90-1 → matches 90
  assert.deepEqual(matchingCheckpoints(89), [90]);
});

test('trackOutcomes: updates outcomes for snapshots at checkpoints', async () => {
  const { db, cleanup } = createTestDb();
  __resetBtcCacheForTests();

  try {
    // Insert a token
    const tokenResult = db.prepare(
      "INSERT INTO token_universe (symbol, name, coingecko_id, tier) VALUES ('BTC', 'Bitcoin', 'bitcoin', 'A')"
    ).run();
    const tokenId = tokenResult.lastInsertRowid;

    // Insert a snapshot that is exactly 7 days old
    const snapshotDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const snapResult = db.prepare(`
      INSERT INTO token_snapshots (token_id, project_name, snapshot_at, price, btc_price)
      VALUES (?, 'bitcoin', ?, 50000.0, 45000.0)
    `).run(tokenId, snapshotDate);
    const snapshotId = snapResult.lastInsertRowid;

    // Mock fetch functions
    let priceCallCount = 0;
    const mockFetchPrice = async (coingeckoId) => {
      priceCallCount++;
      return coingeckoId === 'bitcoin' ? 55000 : 50000;
    };
    const mockFetchBtc = async () => 48000;

    const result = await trackOutcomes({
      db,
      fetchPriceFn: mockFetchPrice,
      fetchBtcFn: mockFetchBtc,
      maxAgeDays: 14,
    });

    assert.equal(result.updated, 1, 'Should update 1 outcome');
    assert.equal(result.errors, 0, 'Should have no errors');

    // Verify the outcome was saved
    const outcome = db.prepare('SELECT * FROM token_outcomes WHERE snapshot_id = ? AND days_forward = ?').get(snapshotId, 7);
    assert.ok(outcome, 'Should have outcome record');
    assert.equal(outcome.price_then, 50000);
    assert.equal(outcome.price_now, 55000);
    assert.equal(outcome.btc_price_now, 48000);

    // return_pct = (55000-50000)/50000 * 100 = 10
    assert.ok(Math.abs(outcome.return_pct - 10) < 0.01, `return_pct should be ~10, got ${outcome.return_pct}`);
  } finally {
    cleanup();
  }
});

test('trackOutcomes: skips already-recorded outcomes (idempotent)', async () => {
  const { db, cleanup } = createTestDb();
  __resetBtcCacheForTests();

  try {
    const tokenResult = db.prepare(
      "INSERT INTO token_universe (symbol, name, coingecko_id, tier) VALUES ('ETH', 'Ethereum', 'ethereum', 'A')"
    ).run();
    const tokenId = tokenResult.lastInsertRowid;

    const snapshotDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const snapResult = db.prepare(`
      INSERT INTO token_snapshots (token_id, project_name, snapshot_at, price, btc_price)
      VALUES (?, 'ethereum', ?, 3000.0, 50000.0)
    `).run(tokenId, snapshotDate);
    const snapshotId = snapResult.lastInsertRowid;

    // Pre-insert the outcome
    db.prepare(`
      INSERT INTO token_outcomes (snapshot_id, days_forward, checked_at, price_then, price_now, btc_price_then, btc_price_now, return_pct, btc_return_pct, relative_return_pct)
      VALUES (?, 14, datetime('now'), 3000, 3200, 50000, 52000, 6.67, 4.0, 2.67)
    `).run(snapshotId);

    const mockFetchPrice = async () => 3300;
    const mockFetchBtc = async () => 53000;

    const result = await trackOutcomes({
      db,
      fetchPriceFn: mockFetchPrice,
      fetchBtcFn: mockFetchBtc,
      maxAgeDays: 20,
    });

    assert.equal(result.updated, 0, 'Should update 0 (already recorded)');
    assert.equal(result.skipped, 1, 'Should skip 1 (already exists)');
  } finally {
    cleanup();
  }
});

test('trackOutcomes: handles fetch errors gracefully', async () => {
  const { db, cleanup } = createTestDb();
  __resetBtcCacheForTests();

  try {
    const tokenResult = db.prepare(
      "INSERT INTO token_universe (symbol, name, coingecko_id, tier) VALUES ('UNKNOWN', 'Unknown', 'unknown-token', 'B')"
    ).run();
    const tokenId = tokenResult.lastInsertRowid;

    const snapshotDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO token_snapshots (token_id, project_name, snapshot_at, price, btc_price)
      VALUES (?, 'unknown-token', ?, 0.001, 50000.0)
    `).run(tokenId, snapshotDate);

    // fetchPrice returns null (simulating 404)
    const mockFetchPrice = async () => null;
    const mockFetchBtc = async () => 50000;

    const result = await trackOutcomes({
      db,
      fetchPriceFn: mockFetchPrice,
      fetchBtcFn: mockFetchBtc,
      maxAgeDays: 14,
    });

    assert.equal(result.updated, 0, 'Should update 0 when price unavailable');
    assert.equal(result.errors, 1, 'Should record 1 error');
  } finally {
    cleanup();
  }
});

// ─── x-social collector tests ─────────────────────────────────────────────────

test('collectXSocial: returns error gracefully when API key missing', async () => {
  const origKey = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;

  try {
    const result = await collectXSocial('Bitcoin');
    assert.equal(result.error, 'XAI_API_KEY not set');
    assert.equal(result.source, 'grok_fast');
  } finally {
    if (origKey !== undefined) {
      process.env.XAI_API_KEY = origKey;
    }
  }
});

test('collectXSocial: returns error gracefully on fetch failure', async () => {
  // Mock fetch to simulate network error
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network error'); };

  try {
    const result = await collectXSocial('Ethereum', { apiKey: 'test-key' });
    assert.equal(result.source, 'grok_fast');
    assert.ok(result.error, 'Should have error field');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('collectXSocial: returns error on non-ok HTTP response', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  });

  try {
    const result = await collectXSocial('Solana', { apiKey: 'bad-key' });
    assert.equal(result.source, 'grok_fast');
    assert.ok(result.error, 'Should have error field');
    assert.ok(result.error.includes('401'), 'Error should mention status code');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('collectXSocial: parses successful response correctly', async () => {
  const mockPayload = {
    output: [
      {
        content: [
          {
            text: JSON.stringify({
              sentiment: 'bullish',
              sentiment_score: 0.75,
              mention_volume: 'high',
              key_narratives: ['ETF approval', 'institutional adoption'],
              notable_accounts: ['@whale1', '@analyst2'],
              kol_sentiment: 'bullish',
              summary: 'Bitcoin is trending positively.',
            }),
          },
        ],
      },
    ],
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => mockPayload,
  });

  try {
    const result = await collectXSocial('Bitcoin', { apiKey: 'test-key' });
    assert.equal(result.sentiment, 'bullish');
    assert.equal(result.sentiment_score, 0.75);
    assert.equal(result.mention_volume, 'high');
    assert.deepEqual(result.key_narratives, ['ETF approval', 'institutional adoption']);
    assert.equal(result.source, 'grok_fast');
    assert.equal(result.model, 'grok-4-1-fast-non-reasoning');
    assert.ok(result.collected_at, 'Should have collected_at timestamp');
    assert.equal(result.error, undefined, 'Should not have error field on success');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('collectXSocial: handles output_text field in response', async () => {
  const mockPayload = {
    output_text: JSON.stringify({
      sentiment: 'neutral',
      sentiment_score: 0.1,
      mention_volume: 'medium',
      key_narratives: ['price consolidation'],
      notable_accounts: [],
      kol_sentiment: 'neutral',
      summary: 'Ethereum discussion is subdued.',
    }),
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => mockPayload,
  });

  try {
    const result = await collectXSocial('Ethereum', { apiKey: 'test-key' });
    assert.equal(result.sentiment, 'neutral');
    assert.equal(result.source, 'grok_fast');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('collectXSocial: returns error when response has no extractable text', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ output: [] }),
  });

  try {
    const result = await collectXSocial('Solana', { apiKey: 'test-key' });
    assert.equal(result.source, 'grok_fast');
    assert.ok(result.error, 'Should have error when no text extracted');
    assert.equal(result.error, 'Empty response from Grok fast');
  } finally {
    globalThis.fetch = origFetch;
  }
});
