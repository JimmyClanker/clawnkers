import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  detectScoreMomentum,
  detectCategoryLeaderShift,
  detectBreakerAlerts,
  detectDivergence,
  detectRegimeShift,
  saveSignals,
} from '../oracle/signal-detector.js';
import { getSignals, getTopMovers, getWatchlist } from '../oracle/index.js';

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

const CREATE_SCHEMA = `
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
  CREATE TABLE IF NOT EXISTS oracle_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_type TEXT NOT NULL,
    token_id INTEGER,
    severity TEXT,
    title TEXT,
    detail TEXT,
    data_json TEXT,
    generated_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY (token_id) REFERENCES token_universe(id)
  );
`;

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(CREATE_SCHEMA);
  return db;
}

function insertToken(db, { symbol = 'TKN', name = 'Token', category = 'DeFi', coingecko_id = null } = {}) {
  const r = db.prepare(
    'INSERT INTO token_universe (symbol, name, category, coingecko_id) VALUES (?, ?, ?, ?)'
  ).run(symbol, name, category, coingecko_id ?? symbol.toLowerCase());
  return Number(r.lastInsertRowid);
}

function insertSnapshot(db, tokenId, { snapshot_at = null, price_change_7d = null } = {}) {
  const at = snapshot_at || new Date().toISOString().replace('T', ' ').slice(0, 19);
  const r = db.prepare(
    'INSERT INTO token_snapshots (token_id, project_name, snapshot_at, price_change_7d) VALUES (?, ?, ?, ?)'
  ).run(tokenId, `project_${tokenId}`, at, price_change_7d);
  return Number(r.lastInsertRowid);
}

function insertScore(db, snapshotId, { overall_score = 5.0, category = 'DeFi', circuit_breakers_json = null } = {}) {
  const r = db.prepare(
    'INSERT INTO token_scores (snapshot_id, overall_score, category, circuit_breakers_json) VALUES (?, ?, ?, ?)'
  ).run(snapshotId, overall_score, category, circuit_breakers_json);
  return Number(r.lastInsertRowid);
}

// Helper: datetime N hours ago
function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function daysAgo(d) {
  return hoursAgo(d * 24);
}

// ---------------------------------------------------------------------------
// SCORE_MOMENTUM tests
// ---------------------------------------------------------------------------

test('SCORE_MOMENTUM: delta > 1.0 generates signal', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const snapOld = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(72) });
  insertScore(db, snapOld, { overall_score: 4.0 });
  const snapNew = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(1) });
  insertScore(db, snapNew, { overall_score: 5.5 });

  const signals = detectScoreMomentum(db);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signal_type, 'SCORE_MOMENTUM');
  assert.equal(signals[0].token_id, tokenId);
  assert.equal(signals[0].severity, 'medium'); // delta 1.5 → high? no 1.5 > 1.5 is false, so medium
});

test('SCORE_MOMENTUM: delta < 1.0 generates no signal', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const snapOld = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(72) });
  insertScore(db, snapOld, { overall_score: 5.0 });
  const snapNew = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(1) });
  insertScore(db, snapNew, { overall_score: 5.8 });

  const signals = detectScoreMomentum(db);
  assert.equal(signals.length, 0);
});

test('SCORE_MOMENTUM: severity scaling — medium (delta ~1.2)', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const snapOld = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(70) });
  insertScore(db, snapOld, { overall_score: 4.0 });
  const snapNew = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(1) });
  insertScore(db, snapNew, { overall_score: 5.2 }); // delta 1.2

  const signals = detectScoreMomentum(db);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].severity, 'medium');
});

test('SCORE_MOMENTUM: severity scaling — high (delta 1.6)', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const snapOld = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(70) });
  insertScore(db, snapOld, { overall_score: 4.0 });
  const snapNew = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(1) });
  insertScore(db, snapNew, { overall_score: 5.6 }); // delta 1.6 > 1.5

  const signals = detectScoreMomentum(db);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].severity, 'high');
});

test('SCORE_MOMENTUM: severity scaling — critical (delta 2.1)', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const snapOld = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(70) });
  insertScore(db, snapOld, { overall_score: 3.0 });
  const snapNew = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(1) });
  insertScore(db, snapNew, { overall_score: 5.1 }); // delta 2.1

  const signals = detectScoreMomentum(db);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].severity, 'critical');
});

test('SCORE_MOMENTUM: declining direction', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const snapOld = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(70) });
  insertScore(db, snapOld, { overall_score: 7.0 });
  const snapNew = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(1) });
  insertScore(db, snapNew, { overall_score: 5.5 }); // delta -1.5

  const signals = detectScoreMomentum(db);
  assert.equal(signals.length, 1);
  const data = JSON.parse(signals[0].data_json);
  assert.equal(data.direction, 'declining');
});

// ---------------------------------------------------------------------------
// CATEGORY_LEADER_SHIFT tests
// ---------------------------------------------------------------------------

test('CATEGORY_LEADER_SHIFT: top 3 change generates signal', () => {
  const db = createTestDb();
  const cat = 'DeFi';

  // 3 token nella categoria con snapshot 7g fa
  const t1 = insertToken(db, { symbol: 'A', name: 'Alpha', category: cat });
  const t2 = insertToken(db, { symbol: 'B', name: 'Beta', category: cat });
  const t3 = insertToken(db, { symbol: 'C', name: 'Gamma', category: cat });
  const t4 = insertToken(db, { symbol: 'D', name: 'Delta', category: cat });

  // Snapshot vecchio (7g fa): top3 = A(8), B(7), C(6)
  const s1old = insertSnapshot(db, t1, { snapshot_at: daysAgo(7) });
  insertScore(db, s1old, { overall_score: 8.0, category: cat });
  const s2old = insertSnapshot(db, t2, { snapshot_at: daysAgo(7) });
  insertScore(db, s2old, { overall_score: 7.0, category: cat });
  const s3old = insertSnapshot(db, t3, { snapshot_at: daysAgo(7) });
  insertScore(db, s3old, { overall_score: 6.0, category: cat });
  const s4old = insertSnapshot(db, t4, { snapshot_at: daysAgo(7) });
  insertScore(db, s4old, { overall_score: 5.0, category: cat });

  // Snapshot recente: top3 = A(8), D(7.5), B(7) — C è fuori
  const s1new = insertSnapshot(db, t1, { snapshot_at: hoursAgo(1) });
  insertScore(db, s1new, { overall_score: 8.0, category: cat });
  const s2new = insertSnapshot(db, t2, { snapshot_at: hoursAgo(1) });
  insertScore(db, s2new, { overall_score: 7.0, category: cat });
  const s3new = insertSnapshot(db, t3, { snapshot_at: hoursAgo(1) });
  insertScore(db, s3new, { overall_score: 5.0, category: cat }); // C scende
  const s4new = insertSnapshot(db, t4, { snapshot_at: hoursAgo(1) });
  insertScore(db, s4new, { overall_score: 7.5, category: cat }); // D sale

  const signals = detectCategoryLeaderShift(db);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signal_type, 'CATEGORY_LEADER_SHIFT');
  assert.equal(signals[0].token_id, null);
  const data = JSON.parse(signals[0].data_json);
  assert.equal(data.category, cat);
});

test('CATEGORY_LEADER_SHIFT: unchanged top 3 generates no signal', () => {
  const db = createTestDb();
  const cat = 'Layer1';

  const t1 = insertToken(db, { symbol: 'X', name: 'Xen', category: cat });
  const t2 = insertToken(db, { symbol: 'Y', name: 'Yen', category: cat });
  const t3 = insertToken(db, { symbol: 'Z', name: 'Zen', category: cat });

  // Snapshot vecchio
  const s1old = insertSnapshot(db, t1, { snapshot_at: daysAgo(7) });
  insertScore(db, s1old, { overall_score: 8.0, category: cat });
  const s2old = insertSnapshot(db, t2, { snapshot_at: daysAgo(7) });
  insertScore(db, s2old, { overall_score: 7.0, category: cat });
  const s3old = insertSnapshot(db, t3, { snapshot_at: daysAgo(7) });
  insertScore(db, s3old, { overall_score: 6.0, category: cat });

  // Snapshot recente — stesso ordine
  const s1new = insertSnapshot(db, t1, { snapshot_at: hoursAgo(1) });
  insertScore(db, s1new, { overall_score: 8.0, category: cat });
  const s2new = insertSnapshot(db, t2, { snapshot_at: hoursAgo(1) });
  insertScore(db, s2new, { overall_score: 7.0, category: cat });
  const s3new = insertSnapshot(db, t3, { snapshot_at: hoursAgo(1) });
  insertScore(db, s3new, { overall_score: 6.0, category: cat });

  const signals = detectCategoryLeaderShift(db);
  assert.equal(signals.length, 0);
});

// ---------------------------------------------------------------------------
// BREAKER_ALERT tests
// ---------------------------------------------------------------------------

test('BREAKER_ALERT: breaker activated generates high signal', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);

  // Snapshot precedente — nessun breaker
  const snapOld = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(4) });
  insertScore(db, snapOld, { overall_score: 5.0, circuit_breakers_json: '[]' });

  // Snapshot recente (ultime 24h) — breaker attivo
  const snapNew = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(1) });
  insertScore(db, snapNew, {
    overall_score: 3.0,
    circuit_breakers_json: JSON.stringify([{ type: 'low_liquidity', cap: 3, reason: 'Liquidity below threshold' }]),
  });

  const signals = detectBreakerAlerts(db);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signal_type, 'BREAKER_ALERT');
  assert.equal(signals[0].severity, 'high');
  const data = JSON.parse(signals[0].data_json);
  assert.equal(data.activated, true);
  assert.equal(data.breaker_type, 'low_liquidity');
});

test('BREAKER_ALERT: breaker cleared generates low signal', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);

  // Snapshot precedente — breaker attivo
  const snapOld = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(4) });
  insertScore(db, snapOld, {
    overall_score: 3.0,
    circuit_breakers_json: JSON.stringify([{ type: 'low_liquidity', cap: 3, reason: 'Liquidity below threshold' }]),
  });

  // Snapshot recente — breaker sparito
  const snapNew = insertSnapshot(db, tokenId, { snapshot_at: hoursAgo(1) });
  insertScore(db, snapNew, { overall_score: 6.0, circuit_breakers_json: '[]' });

  const signals = detectBreakerAlerts(db);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signal_type, 'BREAKER_ALERT');
  assert.equal(signals[0].severity, 'low');
  const data = JSON.parse(signals[0].data_json);
  assert.equal(data.activated, false);
});

// ---------------------------------------------------------------------------
// DIVERGENCE tests
// ---------------------------------------------------------------------------

test('DIVERGENCE: score >= 7.0 + price -20% → positive_divergence', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const snap = insertSnapshot(db, tokenId, { price_change_7d: -20.0 });
  insertScore(db, snap, { overall_score: 7.5 });

  const signals = detectDivergence(db);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signal_type, 'DIVERGENCE');
  const data = JSON.parse(signals[0].data_json);
  assert.equal(data.divergence_type, 'positive_divergence');
});

test('DIVERGENCE: score <= 4.0 + price +20% → negative_divergence', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const snap = insertSnapshot(db, tokenId, { price_change_7d: 20.0 });
  insertScore(db, snap, { overall_score: 3.0 });

  const signals = detectDivergence(db);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signal_type, 'DIVERGENCE');
  const data = JSON.parse(signals[0].data_json);
  assert.equal(data.divergence_type, 'negative_divergence');
});

test('DIVERGENCE: score 5.0 + price -20% → no signal (score not extreme)', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const snap = insertSnapshot(db, tokenId, { price_change_7d: -20.0 });
  insertScore(db, snap, { overall_score: 5.0 });

  const signals = detectDivergence(db);
  assert.equal(signals.length, 0);
});

test('DIVERGENCE: score 7.5 + price -5% → no signal (price change not large enough)', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const snap = insertSnapshot(db, tokenId, { price_change_7d: -5.0 });
  insertScore(db, snap, { overall_score: 7.5 });

  const signals = detectDivergence(db);
  assert.equal(signals.length, 0);
});

// ---------------------------------------------------------------------------
// REGIME_SHIFT
// ---------------------------------------------------------------------------

test('REGIME_SHIFT: always returns empty array', () => {
  const db = createTestDb();
  const signals = detectRegimeShift(db);
  assert.deepEqual(signals, []);
});

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

test('Dedup: same signal_type + token_id not duplicated if not expired', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const signal = {
    signal_type: 'SCORE_MOMENTUM',
    token_id: tokenId,
    severity: 'medium',
    title: 'Test signal',
    detail: 'Test detail',
    data_json: '{}',
    expires_at: expiresAt,
  };

  const first = saveSignals(db, [signal]);
  assert.equal(first.length, 1);

  const second = saveSignals(db, [signal]);
  assert.equal(second.length, 0); // duplicato, non salvato

  const count = db.prepare('SELECT COUNT(*) as c FROM oracle_signals').get();
  assert.equal(count.c, 1);
});

test('Dedup: expired signals can be re-created', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);

  const expiredAt = new Date(Date.now() - 1000).toISOString().replace('T', ' ').slice(0, 19);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const signalExpired = {
    signal_type: 'SCORE_MOMENTUM',
    token_id: tokenId,
    severity: 'medium',
    title: 'Old signal',
    detail: 'Old detail',
    data_json: '{}',
    expires_at: expiredAt,
  };
  saveSignals(db, [signalExpired]);

  const signalNew = { ...signalExpired, title: 'New signal', expires_at: expiresAt };
  const saved = saveSignals(db, [signalNew]);
  assert.equal(saved.length, 1); // il vecchio è scaduto, nuovo OK
});

// ---------------------------------------------------------------------------
// getSignals() filters
// ---------------------------------------------------------------------------

test('getSignals(): filter by type', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const exp = new Date(Date.now() + 86400000).toISOString().replace('T', ' ').slice(0, 19);

  saveSignals(db, [
    { signal_type: 'SCORE_MOMENTUM', token_id: tokenId, severity: 'high', title: 'A', detail: '', data_json: '{}', expires_at: exp },
    { signal_type: 'DIVERGENCE', token_id: tokenId, severity: 'high', title: 'B', detail: '', data_json: '{}', expires_at: exp },
  ]);

  const momentum = getSignals({ type: 'SCORE_MOMENTUM', db });
  assert.equal(momentum.length, 1);
  assert.equal(momentum[0].signal_type, 'SCORE_MOMENTUM');

  const divergence = getSignals({ type: 'DIVERGENCE', db });
  assert.equal(divergence.length, 1);
  assert.equal(divergence[0].signal_type, 'DIVERGENCE');
});

test('getSignals(): filter by severity', () => {
  const db = createTestDb();
  const t1 = insertToken(db, { symbol: 'AA', name: 'AA' });
  const t2 = insertToken(db, { symbol: 'BB', name: 'BB' });
  const exp = new Date(Date.now() + 86400000).toISOString().replace('T', ' ').slice(0, 19);

  saveSignals(db, [
    { signal_type: 'SCORE_MOMENTUM', token_id: t1, severity: 'high', title: 'H', detail: '', data_json: '{}', expires_at: exp },
    { signal_type: 'DIVERGENCE', token_id: t2, severity: 'medium', title: 'M', detail: '', data_json: '{}', expires_at: exp },
  ]);

  const highOnly = getSignals({ severity: 'high', db });
  assert.equal(highOnly.length, 1);
  assert.equal(highOnly[0].severity, 'high');
});

test('getSignals(): activeOnly filters expired signals', () => {
  const db = createTestDb();
  const tokenId = insertToken(db);
  const expired = new Date(Date.now() - 1000).toISOString().replace('T', ' ').slice(0, 19);
  const active = new Date(Date.now() + 86400000).toISOString().replace('T', ' ').slice(0, 19);

  db.prepare('INSERT INTO oracle_signals (signal_type, token_id, severity, title, detail, data_json, expires_at) VALUES (?,?,?,?,?,?,?)')
    .run('SCORE_MOMENTUM', tokenId, 'high', 'Old', '', '{}', expired);
  db.prepare('INSERT INTO oracle_signals (signal_type, token_id, severity, title, detail, data_json, expires_at) VALUES (?,?,?,?,?,?,?)')
    .run('DIVERGENCE', tokenId, 'medium', 'Active', '', '{}', active);

  const activeOnly = getSignals({ activeOnly: true, db });
  assert.equal(activeOnly.length, 1);
  assert.equal(activeOnly[0].title, 'Active');

  const all = getSignals({ activeOnly: false, db });
  assert.equal(all.length, 2);
});

// ---------------------------------------------------------------------------
// getTopMovers()
// ---------------------------------------------------------------------------

test('getTopMovers(): returns tokens ordered by |delta| desc', () => {
  const db = createTestDb();

  const t1 = insertToken(db, { symbol: 'T1', name: 'Token1' });
  const t2 = insertToken(db, { symbol: 'T2', name: 'Token2' });
  const t3 = insertToken(db, { symbol: 'T3', name: 'Token3' });

  // Token1: delta 1.5 (old 4.0 -> new 5.5)
  const s1old = insertSnapshot(db, t1, { snapshot_at: hoursAgo(70) });
  insertScore(db, s1old, { overall_score: 4.0 });
  const s1new = insertSnapshot(db, t1, { snapshot_at: hoursAgo(1) });
  insertScore(db, s1new, { overall_score: 5.5 });

  // Token2: delta 3.0 (old 3.0 -> new 6.0) — biggest mover
  const s2old = insertSnapshot(db, t2, { snapshot_at: hoursAgo(70) });
  insertScore(db, s2old, { overall_score: 3.0 });
  const s2new = insertSnapshot(db, t2, { snapshot_at: hoursAgo(1) });
  insertScore(db, s2new, { overall_score: 6.0 });

  // Token3: delta 0.5 — small mover
  const s3old = insertSnapshot(db, t3, { snapshot_at: hoursAgo(70) });
  insertScore(db, s3old, { overall_score: 5.0 });
  const s3new = insertSnapshot(db, t3, { snapshot_at: hoursAgo(1) });
  insertScore(db, s3new, { overall_score: 5.5 });

  const movers = getTopMovers({ limit: 10, db });
  // Token3 ha delta < 0.5 ma è comunque nel range 60-84h, risultato dipende dalla query
  // Solo T1 e T2 hanno delta che rientra nel range 60-84h
  assert.ok(movers.length >= 1);
  // Il primo deve essere T2 (delta 3.0)
  assert.equal(movers[0].token_id, t2);
  assert.equal(movers[0].delta, 3.0);
  assert.equal(movers[0].direction, 'improving');
});

// ---------------------------------------------------------------------------
// getWatchlist()
// ---------------------------------------------------------------------------

test('getWatchlist(): returns tokens with active signals ordered by count', () => {
  const db = createTestDb();
  const t1 = insertToken(db, { symbol: 'W1', name: 'Watch1' });
  const t2 = insertToken(db, { symbol: 'W2', name: 'Watch2' });
  const exp = new Date(Date.now() + 86400000).toISOString().replace('T', ' ').slice(0, 19);

  // t1 ha 2 segnali, t2 ha 1 segnale
  db.prepare('INSERT INTO oracle_signals (signal_type, token_id, severity, title, detail, data_json, expires_at) VALUES (?,?,?,?,?,?,?)')
    .run('SCORE_MOMENTUM', t1, 'high', 'S1', '', '{}', exp);
  db.prepare('INSERT INTO oracle_signals (signal_type, token_id, severity, title, detail, data_json, expires_at) VALUES (?,?,?,?,?,?,?)')
    .run('DIVERGENCE', t1, 'high', 'S2', '', '{}', exp);
  db.prepare('INSERT INTO oracle_signals (signal_type, token_id, severity, title, detail, data_json, expires_at) VALUES (?,?,?,?,?,?,?)')
    .run('BREAKER_ALERT', t2, 'medium', 'S3', '', '{}', exp);

  const watchlist = getWatchlist({ limit: 10, db });
  assert.equal(watchlist.length, 2);
  assert.equal(watchlist[0].token_id, t1); // t1 ha più segnali
  assert.equal(watchlist[0].signal_count, 2);
  assert.equal(watchlist[1].token_id, t2);
  assert.equal(watchlist[1].signal_count, 1);
});
