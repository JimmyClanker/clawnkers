#!/usr/bin/env node
/**
 * Daily Snapshot — Score Backtest Pipeline
 * 
 * Collects algorithmic scores for top crypto assets via quick-scan endpoint.
 * Stores in SQLite for forward-return calibration.
 * 
 * Usage: node scripts/daily-snapshot.js [--limit 50]
 * Cost: $0 (all free APIs, no LLM)
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'backtest.db');
const BASE_URL = 'http://localhost:4021';
const LIMIT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--limit') || '50', 10);

// Rate limiting: CoinGecko free = 10-30 calls/min
const DELAY_MS = 3000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ensureColumn(db, table, column, typeSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
}

function scoreBucket(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n < 3) return '0-3';
  if (n < 5) return '3-5';
  if (n < 7) return '5-7';
  return '7-10';
}

function initDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  
  db.exec(`CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    snapshot_date TEXT NOT NULL,
    price_usd REAL,
    mcap REAL,
    volume_24h REAL,
    price_change_24h REAL,
    price_change_7d REAL,
    price_change_30d REAL,
    score_market REAL,
    score_onchain REAL,
    score_social REAL,
    score_dev REAL,
    score_tokenomics REAL,
    score_distribution REAL,
    score_risk REAL,
    score_overall REAL,
    score_bucket TEXT,
    verdict_snapshot TEXT,
    confidence_snapshot REAL,
    raw_json TEXT,
    return_7d REAL,
    return_30d REAL,
    return_90d REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(symbol, snapshot_date)
  )`);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots(snapshot_date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_symbol ON snapshots(symbol)`);
  ensureColumn(db, 'snapshots', 'score_bucket', 'TEXT');
  ensureColumn(db, 'snapshots', 'verdict_snapshot', 'TEXT');
  ensureColumn(db, 'snapshots', 'confidence_snapshot', 'REAL');
  
  return db;
}

async function getTopAssets(limit) {
  // CoinGecko top by market cap
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=7d,30d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko failed: ${res.status}`);
  const data = await res.json();
  return data.map(c => ({
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name || '',
    price: c.current_price,
    mcap: c.market_cap,
    volume: c.total_volume,
    change_24h: c.price_change_percentage_24h,
    change_7d: c.price_change_percentage_7d_in_currency,
    change_30d: c.price_change_percentage_30d_in_currency,
  }));
}

async function quickScan(project) {
  const url = `${BASE_URL}/alpha/quick?project=${encodeURIComponent(project)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

function extractScores(scanResult) {
  if (!scanResult?.scores) return null;
  const s = scanResult.scores;
  const get = (key) => {
    const v = s[key];
    if (v == null) return null;
    if (typeof v === 'object') return v.score ?? null;
    return v;
  };
  const overall = get('overall');
  return {
    market: get('market_strength') ?? get('market'),
    onchain: get('onchain_health') ?? get('onchain'),
    social: get('social_momentum') ?? get('social'),
    dev: get('development') ?? get('dev'),
    tokenomics: get('tokenomics_health') ?? get('tokenomics'),
    distribution: get('distribution'),
    risk: get('risk'),
    overall,
    score_bucket: scoreBucket(overall),
    verdict: scanResult?.quick_analysis?.verdict ?? scanResult?.analysis?.verdict ?? null,
    confidence: scanResult?.scores?.overall?.overall_confidence ?? null,
  };
}

async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[snapshot] ${today} — fetching top ${LIMIT} assets...`);
  
  const db = initDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO snapshots 
    (symbol, name, snapshot_date, price_usd, mcap, volume_24h,
     price_change_24h, price_change_7d, price_change_30d,
     score_market, score_onchain, score_social, score_dev,
     score_tokenomics, score_distribution, score_risk, score_overall,
     score_bucket, verdict_snapshot, confidence_snapshot, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  let assets;
  try {
    assets = await getTopAssets(LIMIT);
    console.log(`[snapshot] Got ${assets.length} assets from CoinGecko`);
  } catch (err) {
    console.error(`[snapshot] Failed to fetch assets: ${err.message}`);
    process.exit(1);
  }
  
  let scanned = 0, failed = 0;
  
  for (const asset of assets) {
    try {
      const scan = await quickScan(asset.name);
      const scores = extractScores(scan);
      
      insert.run(
        asset.symbol,
        asset.name,
        today,
        asset.price,
        asset.mcap,
        asset.volume,
        asset.change_24h,
        asset.change_7d,
        asset.change_30d,
        scores?.market,
        scores?.onchain,
        scores?.social,
        scores?.dev,
        scores?.tokenomics,
        scores?.distribution,
        scores?.risk,
        scores?.overall,
        scores?.score_bucket,
        scores?.verdict,
        scores?.confidence,
        scan ? JSON.stringify(scan) : null,
      );
      
      scanned++;
      if (scanned % 10 === 0) console.log(`[snapshot] ${scanned}/${assets.length} scanned...`);
      
      await sleep(DELAY_MS);
    } catch (err) {
      console.error(`[snapshot] ${asset.symbol}: ${err.message}`);
      failed++;
    }
  }
  
  console.log(`[snapshot] Done: ${scanned} scanned, ${failed} failed`);
  
  // Tag forward returns for old snapshots
  tagForwardReturns(db, assets);
  
  db.close();
}

function tagForwardReturns(db, currentAssets) {
  const priceMap = new Map(currentAssets.map(a => [a.symbol, a.price]));
  
  // Find snapshots 7+ days old without return_7d
  const old7d = db.prepare(`
    SELECT id, symbol, price_usd FROM snapshots
    WHERE return_7d IS NULL 
    AND snapshot_date <= date('now', '-7 days')
    AND price_usd IS NOT NULL
  `).all();
  
  const update7d = db.prepare(`UPDATE snapshots SET return_7d = ? WHERE id = ?`);
  let tagged = 0;
  
  for (const row of old7d) {
    const currentPrice = priceMap.get(row.symbol);
    if (currentPrice && row.price_usd) {
      const ret = (currentPrice - row.price_usd) / row.price_usd;
      update7d.run(ret, row.id);
      tagged++;
    }
  }
  
  // Same for 30d
  const old30d = db.prepare(`
    SELECT id, symbol, price_usd FROM snapshots
    WHERE return_30d IS NULL
    AND snapshot_date <= date('now', '-30 days')
    AND price_usd IS NOT NULL
  `).all();
  
  const update30d = db.prepare(`UPDATE snapshots SET return_30d = ? WHERE id = ?`);
  let tagged30 = 0;
  
  for (const row of old30d) {
    const currentPrice = priceMap.get(row.symbol);
    if (currentPrice && row.price_usd) {
      const ret = (currentPrice - row.price_usd) / row.price_usd;
      update30d.run(ret, row.id);
      tagged30++;
    }
  }
  
  if (tagged > 0 || tagged30 > 0) {
    console.log(`[snapshot] Tagged forward returns: ${tagged} (7d), ${tagged30} (30d)`);
  }
}

main().catch(err => {
  console.error(`[snapshot] Fatal: ${err.message}`);
  process.exit(1);
});
