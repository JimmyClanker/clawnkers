import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

const DEFAULT_DB_PATH = resolve(process.cwd(), 'data/calibration.db');
const CREATE_SCHEMA_SQL = `
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
    score_bucket TEXT,
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

  CREATE TABLE IF NOT EXISTS llm_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    model TEXT,
    report_json TEXT,
    cost_estimate REAL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (snapshot_id) REFERENCES token_snapshots(id)
  );

  CREATE INDEX IF NOT EXISTS idx_token_universe_coingecko_id ON token_universe(coingecko_id);
  CREATE INDEX IF NOT EXISTS idx_token_snapshots_project_name ON token_snapshots(project_name, snapshot_at DESC);
  CREATE INDEX IF NOT EXISTS idx_token_snapshots_token_id ON token_snapshots(token_id, snapshot_at DESC);
  CREATE INDEX IF NOT EXISTS idx_token_scores_snapshot_id ON token_scores(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_token_outcomes_checked_at ON token_outcomes(checked_at);
`;

let calibrationDb = null;
let calibrationDbPath = null;

function resolveDbPath() {
  return process.env.CALIBRATION_DB_PATH || DEFAULT_DB_PATH;
}

function ensureColumn(db, table, column, typeSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
  }
}

function initializeDb(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(CREATE_SCHEMA_SQL);
  ensureColumn(db, 'token_scores', 'score_bucket', 'TEXT');
  return db;
}

export function getCalibrationDb() {
  const dbPath = resolveDbPath();
  if (calibrationDb && calibrationDbPath === dbPath) {
    return calibrationDb;
  }

  if (calibrationDb && calibrationDbPath !== dbPath) {
    try { calibrationDb.close(); } catch (_) { /* ignore */ }
    calibrationDb = null;
    calibrationDbPath = null;
  }

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  calibrationDb = initializeDb(new Database(dbPath));
  calibrationDbPath = dbPath;
  return calibrationDb;
}

export function getSnapshotsForOutcomeTracking(maxAgeDays = 30) {
  const safeMaxAgeDays = Number.isFinite(Number(maxAgeDays)) ? Math.max(1, Number(maxAgeDays)) : 30;
  const db = getCalibrationDb();
  return db.prepare(`
    SELECT
      s.id AS snapshot_id,
      s.project_name,
      s.snapshot_at,
      s.price,
      s.btc_price,
      u.symbol,
      u.name,
      u.coingecko_id,
      u.chain,
      u.category,
      COUNT(o.snapshot_id) AS outcomes_recorded
    FROM token_snapshots s
    LEFT JOIN token_universe u ON u.id = s.token_id
    LEFT JOIN token_outcomes o ON o.snapshot_id = s.id
    WHERE datetime(s.snapshot_at) >= datetime('now', ?)
    GROUP BY s.id
    ORDER BY datetime(s.snapshot_at) DESC
  `).all(`-${safeMaxAgeDays} days`);
}

export async function storeScanSnapshot(projectName, rawData, scores) {
  const mod = await import('./snapshot-store.js');
  return mod.storeScanSnapshot(projectName, rawData, scores);
}

export function __resetCalibrationDbForTests() {
  if (calibrationDb) {
    try { calibrationDb.close(); } catch (_) { /* ignore */ }
  }
  calibrationDb = null;
  calibrationDbPath = null;
}
