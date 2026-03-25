/**
 * metrics.test.js — Tests for calibration/metrics.js
 *
 * Uses in-memory SQLite databases to avoid polluting real data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { calculateMetrics, spearmanRank, toRanks } from '../calibration/metrics.js';

// ── Schema helper — mirrors db.js CREATE_SCHEMA_SQL ──────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS token_universe (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    coingecko_id TEXT UNIQUE,
    chain TEXT,
    category TEXT,
    tier TEXT DEFAULT 'B',
    active BOOLEAN DEFAULT 1,
    added_at TEXT DEFAULT (datetime('now')),
    metadata_json TEXT
  );
  CREATE TABLE IF NOT EXISTS token_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER,
    project_name TEXT NOT NULL,
    snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
    snapshot_level INTEGER DEFAULT 2,
    price REAL,
    market_cap REAL,
    fdv REAL,
    volume_24h REAL,
    price_change_1h REAL,
    price_change_24h REAL,
    price_change_7d REAL,
    price_change_30d REAL,
    ath_distance_pct REAL,
    tvl REAL,
    tvl_change_7d REAL,
    fees_7d REAL,
    revenue_7d REAL,
    social_mentions INTEGER,
    sentiment_score REAL,
    github_commits_30d INTEGER,
    github_commit_trend TEXT,
    holder_concentration REAL,
    dex_liquidity REAL,
    buy_sell_ratio REAL,
    btc_price REAL,
    data_completeness REAL,
    FOREIGN KEY (token_id) REFERENCES token_universe(id)
  );
  CREATE TABLE IF NOT EXISTS token_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    market_score REAL,
    onchain_score REAL,
    social_score REAL,
    dev_score REAL,
    tokenomics_score REAL,
    distribution_score REAL,
    risk_score REAL,
    overall_score REAL,
    raw_score REAL,
    verdict TEXT,
    confidence REAL,
    category TEXT,
    category_confidence REAL,
    category_source TEXT,
    weights_json TEXT,
    leading_signals_json TEXT,
    circuit_breakers_json TEXT,
    red_flags_count INTEGER,
    alpha_signals_count INTEGER,
    divergence_json TEXT,
    regime TEXT,
    FOREIGN KEY (snapshot_id) REFERENCES token_snapshots(id)
  );
  CREATE TABLE IF NOT EXISTS token_outcomes (
    snapshot_id INTEGER NOT NULL,
    days_forward INTEGER NOT NULL,
    checked_at TEXT NOT NULL,
    price_then REAL,
    price_now REAL,
    btc_price_then REAL,
    btc_price_now REAL,
    return_pct REAL,
    btc_return_pct REAL,
    relative_return_pct REAL,
    PRIMARY KEY (snapshot_id, days_forward)
  );
`;

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

/**
 * Insert a snapshot + score + optional outcome into an in-memory DB.
 * Returns snapshot_id.
 */
function insertSnapshot(db, {
  projectName = 'testcoin',
  price = 1.0,
  price_change_24h = 0,
  snapshotAt = new Date().toISOString(),
  overall_score = 60,
  verdict = 'HOLD',
  category = 'defi',
  circuit_breakers_json = null,
  outcome = null, // { return_pct, btc_return_pct, relative_return_pct }
} = {}) {
  const snapshotRes = db.prepare(`
    INSERT INTO token_snapshots (project_name, snapshot_at, price, price_change_24h)
    VALUES (?, ?, ?, ?)
  `).run(projectName, snapshotAt, price, price_change_24h);
  const snapshotId = snapshotRes.lastInsertRowid;

  db.prepare(`
    INSERT INTO token_scores
      (snapshot_id, overall_score, verdict, category, circuit_breakers_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(snapshotId, overall_score, verdict, category, circuit_breakers_json);

  if (outcome) {
    db.prepare(`
      INSERT INTO token_outcomes
        (snapshot_id, days_forward, checked_at, return_pct, btc_return_pct, relative_return_pct)
      VALUES (?, 30, datetime('now'), ?, ?, ?)
    `).run(snapshotId, outcome.return_pct ?? 0, outcome.btc_return_pct ?? 0, outcome.relative_return_pct ?? 0);
  }

  return snapshotId;
}

// ── Tests: Spearman helpers ──────────────────────────────────────────────

test('spearmanRank — perfect positive correlation', () => {
  const x = [1, 2, 3, 4, 5];
  const y = [1, 2, 3, 4, 5];
  const rho = spearmanRank(x, y);
  assert.ok(rho !== null);
  assert.ok(Math.abs(rho - 1.0) < 0.0001, `Expected 1.0, got ${rho}`);
});

test('spearmanRank — perfect negative correlation', () => {
  const x = [1, 2, 3, 4, 5];
  const y = [5, 4, 3, 2, 1];
  const rho = spearmanRank(x, y);
  assert.ok(rho !== null);
  assert.ok(Math.abs(rho - (-1.0)) < 0.0001, `Expected -1.0, got ${rho}`);
});

test('spearmanRank — returns null for n < 5', () => {
  const rho = spearmanRank([1, 2, 3], [3, 2, 1]);
  assert.equal(rho, null);
});

test('spearmanRank — known value', () => {
  // Classic example: x=[1,2,3,4,5,6], y=[1,2,3,4,5,6] → rho=1
  const x = [10, 20, 30, 40, 50, 60];
  const y = [15, 25, 35, 45, 55, 65];
  const rho = spearmanRank(x, y);
  assert.ok(Math.abs(rho - 1.0) < 0.001);
});

test('toRanks — basic ranking', () => {
  const ranks = toRanks([30, 10, 20]);
  assert.deepEqual(ranks, [3, 1, 2]);
});

// ── Tests: calculateMetrics with empty DB ───────────────────────────────

test('calculateMetrics — empty DB returns insufficient_data for all metrics', () => {
  const db = makeDb();
  const metrics = calculateMetrics(db);

  assert.ok(metrics.generated_at, 'should have generated_at');

  // Coverage
  assert.equal(metrics.coverage.total_tokens, 0);
  assert.equal(metrics.coverage.total_snapshots, 0);
  assert.equal(metrics.coverage.total_with_outcomes, 0);

  // Hit rates
  assert.equal(metrics.hit_rates.status, 'insufficient_data');
  assert.equal(metrics.hit_rates.count, 0);
  assert.equal(metrics.hit_rates.min_required, 10);

  // Correlation
  assert.equal(metrics.correlation.status, 'insufficient_data');
  assert.equal(metrics.correlation.count, 0);
  assert.equal(metrics.correlation.min_required, 5);

  // Breaker protection
  assert.equal(metrics.breaker_protection.status, 'insufficient_data');

  // Category performance — empty array
  assert.ok(Array.isArray(metrics.category_performance));
  assert.equal(metrics.category_performance.length, 0);

  // Verdict distribution — empty object
  assert.deepEqual(metrics.verdict_distribution, {});

  // Recent scans — empty array
  assert.ok(Array.isArray(metrics.recent_scans));
  assert.equal(metrics.recent_scans.length, 0);
});

// ── Tests: Coverage stats ────────────────────────────────────────────────

test('getCoverageStats — counts snapshots and outcomes correctly', () => {
  const db = makeDb();

  // Insert 2 snapshots: one with outcome, one without
  insertSnapshot(db, {
    projectName: 'alpha', overall_score: 70, verdict: 'BUY',
    outcome: { return_pct: 20, btc_return_pct: 10, relative_return_pct: 10 },
  });
  insertSnapshot(db, {
    projectName: 'beta', overall_score: 40, verdict: 'AVOID',
  });

  const metrics = calculateMetrics(db);
  assert.equal(metrics.coverage.total_snapshots, 2);
  assert.equal(metrics.coverage.total_with_outcomes, 1);
  assert.ok(metrics.coverage.first_snapshot_at !== null);
  assert.ok(metrics.coverage.last_snapshot_at !== null);
});

// ── Tests: Hit rates ─────────────────────────────────────────────────────

test('getHitRates — insufficient data when < 10 outcomes', () => {
  const db = makeDb();
  // Insert 5 outcomes (below threshold of 10)
  for (let i = 0; i < 5; i++) {
    insertSnapshot(db, {
      projectName: `coin${i}`, verdict: 'BUY', overall_score: 70,
      outcome: { return_pct: 5, btc_return_pct: 2, relative_return_pct: 3 },
    });
  }
  const metrics = calculateMetrics(db);
  assert.equal(metrics.hit_rates.status, 'insufficient_data');
  assert.equal(metrics.hit_rates.count, 5);
});

test('getHitRates — 3 BUY (2 hit), 2 AVOID (1 hit)', () => {
  const db = makeDb();

  // 3 BUY: 2 hit (positive relative return), 1 miss
  insertSnapshot(db, { verdict: 'BUY', overall_score: 75, outcome: { relative_return_pct: 10 } });
  insertSnapshot(db, { verdict: 'BUY', overall_score: 72, outcome: { relative_return_pct: 5 } });
  insertSnapshot(db, { verdict: 'BUY', overall_score: 68, outcome: { relative_return_pct: -3 } });

  // 2 AVOID: 1 hit (negative relative return), 1 miss
  insertSnapshot(db, { verdict: 'AVOID', overall_score: 35, outcome: { relative_return_pct: -8 } });
  insertSnapshot(db, { verdict: 'AVOID', overall_score: 38, outcome: { relative_return_pct: 4 } });

  // Fill to 10 total with HOLD
  for (let i = 0; i < 5; i++) {
    insertSnapshot(db, { verdict: 'HOLD', overall_score: 55, outcome: { relative_return_pct: 1 } });
  }

  const metrics = calculateMetrics(db);
  const hr = metrics.hit_rates;

  assert.ok(!hr.status, 'Should not be insufficient');
  assert.equal(hr.buy_count, 3);
  assert.equal(hr.avoid_count, 2);
  assert.ok(Math.abs(hr.buy_hit_rate - 2/3) < 0.001, `Expected ${2/3}, got ${hr.buy_hit_rate}`);
  assert.ok(Math.abs(hr.avoid_hit_rate - 0.5) < 0.001, `Expected 0.5, got ${hr.avoid_hit_rate}`);
  assert.equal(hr.hold_count, 5);
});

// ── Tests: Spearman correlation (via calculateMetrics) ───────────────────

test('getScoreCorrelation — insufficient data when < 5 outcomes', () => {
  const db = makeDb();
  for (let i = 0; i < 3; i++) {
    insertSnapshot(db, {
      overall_score: 50 + i * 10, verdict: 'HOLD',
      outcome: { relative_return_pct: i * 5 },
    });
  }
  const metrics = calculateMetrics(db);
  assert.equal(metrics.correlation.status, 'insufficient_data');
  assert.equal(metrics.correlation.count, 3);
});

test('getScoreCorrelation — positive correlation with monotonic data', () => {
  const db = makeDb();
  // Perfect rank order: higher score → better return
  const pairs = [
    { score: 20, ret: -10 },
    { score: 40, ret: -5 },
    { score: 60, ret: 2 },
    { score: 75, ret: 8 },
    { score: 90, ret: 15 },
  ];
  for (const p of pairs) {
    insertSnapshot(db, {
      overall_score: p.score, verdict: 'HOLD',
      outcome: { relative_return_pct: p.ret },
    });
  }
  const metrics = calculateMetrics(db);
  const corr = metrics.correlation;
  assert.ok(!corr.status, 'Should not be insufficient');
  assert.ok(corr.spearman_rho > 0.9, `Expected rho > 0.9, got ${corr.spearman_rho}`);
  assert.equal(corr.interpretation, 'strong');
  assert.equal(corr.count, 5);
});

// ── Tests: Verdict distribution ──────────────────────────────────────────

test('getVerdictDistribution — counts per verdict', () => {
  const db = makeDb();
  insertSnapshot(db, { verdict: 'STRONG BUY', overall_score: 90 });
  insertSnapshot(db, { verdict: 'BUY', overall_score: 75 });
  insertSnapshot(db, { verdict: 'BUY', overall_score: 72 });
  insertSnapshot(db, { verdict: 'HOLD', overall_score: 55 });
  insertSnapshot(db, { verdict: 'AVOID', overall_score: 35 });

  const metrics = calculateMetrics(db);
  const vd = metrics.verdict_distribution;

  assert.equal(vd['STRONG BUY'], 1);
  assert.equal(vd['BUY'], 2);
  assert.equal(vd['HOLD'], 1);
  assert.equal(vd['AVOID'], 1);
  assert.equal(vd['STRONG AVOID'], undefined); // not present
});

// ── Tests: Recent scans ──────────────────────────────────────────────────

test('getRecentScans — returns most recent entries up to limit', () => {
  const db = makeDb();
  for (let i = 0; i < 25; i++) {
    insertSnapshot(db, {
      projectName: `coin${i}`,
      overall_score: 50 + i,
      verdict: 'HOLD',
      snapshotAt: new Date(Date.now() + i * 1000).toISOString(),
    });
  }
  const metrics = calculateMetrics(db);
  assert.equal(metrics.recent_scans.length, 20, 'Should return max 20 scans');
  // First result should be the most recent (coin24)
  assert.equal(metrics.recent_scans[0].project_name, 'coin24');
});

// ── Tests: Circuit breaker protection ────────────────────────────────────

test('getBreakerProtection — tokens with breakers and outcomes', () => {
  const db = makeDb();

  // 3 tokens with circuit breakers, 2 with outcomes
  insertSnapshot(db, {
    verdict: 'AVOID', overall_score: 30,
    circuit_breakers_json: JSON.stringify([{ type: 'liquidity_crisis' }]),
    outcome: { return_pct: -35, btc_return_pct: 5, relative_return_pct: -40 }, // lost > 20%
  });
  insertSnapshot(db, {
    verdict: 'AVOID', overall_score: 32,
    circuit_breakers_json: JSON.stringify([{ type: 'dump_risk' }]),
    outcome: { return_pct: -10, btc_return_pct: 5, relative_return_pct: -15 }, // did NOT lose > 20%
  });
  insertSnapshot(db, {
    verdict: 'AVOID', overall_score: 28,
    circuit_breakers_json: JSON.stringify([{ type: 'rug_risk' }]),
    // no outcome
  });

  const metrics = calculateMetrics(db);
  const bp = metrics.breaker_protection;

  assert.ok(!bp.status, 'Should not be insufficient');
  assert.equal(bp.total_with_breaker, 3);
  assert.equal(bp.with_outcomes, 2);
  assert.equal(bp.actually_lost_20pct, 1);
  assert.ok(Math.abs(bp.protection_rate - 0.5) < 0.001, `Expected 0.5, got ${bp.protection_rate}`);
});

test('getBreakerProtection — no breakers returns insufficient_data', () => {
  const db = makeDb();
  insertSnapshot(db, { verdict: 'BUY', overall_score: 80 });

  const metrics = calculateMetrics(db);
  assert.equal(metrics.breaker_protection.status, 'insufficient_data');
});

// ── Tests: Category performance ──────────────────────────────────────────

test('getCategoryPerformance — filters categories with < 5 outcomes', () => {
  const db = makeDb();

  // defi: 5 outcomes (should be included)
  for (let i = 0; i < 5; i++) {
    insertSnapshot(db, {
      category: 'defi', verdict: 'BUY', overall_score: 70 + i,
      outcome: { relative_return_pct: 5 + i },
    });
  }
  // layer1: 3 outcomes (should be excluded)
  for (let i = 0; i < 3; i++) {
    insertSnapshot(db, {
      category: 'layer1', verdict: 'BUY', overall_score: 80,
      outcome: { relative_return_pct: 10 },
    });
  }

  const metrics = calculateMetrics(db);
  const cats = metrics.category_performance;

  const defi = cats.find(c => c.category === 'defi');
  const layer1 = cats.find(c => c.category === 'layer1');

  assert.ok(defi, 'defi should be included (5 outcomes)');
  assert.equal(defi.count, 5);
  assert.ok(!layer1, 'layer1 should be excluded (< 5 outcomes)');
});
