import Database from 'better-sqlite3';
import crypto from 'crypto';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      strategy TEXT NOT NULL,
      entry REAL DEFAULT 0,
      sl REAL DEFAULT 0,
      tp REAL DEFAULT 0,
      rr REAL DEFAULT 0,
      context TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp);
    CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
  `);
}

export function secureCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createSignalsService({ dbPath, maxBatchSignals = 100, ingestKey } = {}) {
  if (!dbPath) {
    throw new Error('Missing dbPath');
  }

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  createSchema(db);

  const insertSignal = db.prepare(`
    INSERT INTO signals (timestamp, symbol, direction, strategy, entry, sl, tp, rr, context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const querySignals = db.prepare(
    'SELECT * FROM signals WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT 500'
  );
  const querySignalsByCoin = db.prepare(
    'SELECT * FROM signals WHERE timestamp >= ? AND UPPER(symbol) = UPPER(?) ORDER BY timestamp DESC LIMIT 500'
  );
  const querySignalsByCoinAndType = db.prepare(
    'SELECT * FROM signals WHERE timestamp >= ? AND UPPER(symbol) = UPPER(?) AND UPPER(strategy) = UPPER(?) ORDER BY timestamp DESC LIMIT 500'
  );
  const querySignalsByType = db.prepare(
    'SELECT * FROM signals WHERE timestamp >= ? AND UPPER(strategy) = UPPER(?) ORDER BY timestamp DESC LIMIT 500'
  );
  const countSignals = db.prepare('SELECT COUNT(*) as count FROM signals');
  const countSince = db.prepare('SELECT COUNT(*) as count FROM signals WHERE timestamp >= ?');
  const topSymbols = db.prepare(
    'SELECT symbol, COUNT(*) as count FROM signals WHERE timestamp >= ? GROUP BY symbol ORDER BY count DESC LIMIT 10'
  );
  const byStrategy = db.prepare(
    'SELECT strategy, COUNT(*) as count FROM signals WHERE timestamp >= ? GROUP BY strategy'
  );
  const lastSignal = db.prepare('SELECT timestamp FROM signals ORDER BY timestamp DESC LIMIT 1');

  const insertMany = db.transaction((signals, now) => {
    for (const signal of signals) {
      if (!signal.symbol || typeof signal.symbol !== 'string') continue;
      insertSignal.run(
        signal.timestamp || now,
        signal.symbol.toUpperCase().slice(0, 20),
        String(signal.direction || 'UNKNOWN').slice(0, 10),
        String(signal.strategy || 'UNKNOWN').slice(0, 30),
        Number(signal.entry) || 0,
        Number(signal.sl) || 0,
        Number(signal.tp) || 0,
        Number(signal.rr) || 0,
        JSON.stringify(signal.context || {}).slice(0, 2000)
      );
    }
  });

  function ingestSignals(payload) {
    if (!payload) {
      throw new Error('Missing body');
    }

    const incoming = Array.isArray(payload) ? payload : [payload];
    if (incoming.length > maxBatchSignals) {
      throw new Error(`Max ${maxBatchSignals} signals per batch`);
    }

    const now = new Date().toISOString();
    insertMany(incoming, now);

    return {
      ingested: incoming.length,
      total: countSignals.get().count,
    };
  }

  function normalizeSignal(row) {
    return {
      ...row,
      context: JSON.parse(row.context || '{}'),
    };
  }

  function mapType(type) {
    const typeMap = { div: 'DIVERGENCE', convergence: 'CONVERGENCE' };
    return type && type !== 'all' ? typeMap[type] || String(type).toUpperCase() : null;
  }

  function getSignals({ coin, type, hours = 168 } = {}) {
    const hoursNum = Math.min(parseInt(hours, 10) || 168, 720);
    const cutoff = new Date(Date.now() - hoursNum * 3600 * 1000).toISOString();
    const mappedType = mapType(type);

    let rows;
    if (coin && mappedType) {
      rows = querySignalsByCoinAndType.all(cutoff, coin, mappedType);
    } else if (coin) {
      rows = querySignalsByCoin.all(cutoff, coin);
    } else if (mappedType) {
      rows = querySignalsByType.all(cutoff, mappedType);
    } else {
      rows = querySignals.all(cutoff);
    }

    return {
      signals: rows.map(normalizeSignal),
      count: rows.length,
      totalStored: countSignals.get().count,
      query: { coin: coin || null, type: type || 'all', hours: hoursNum },
    };
  }

  function getStats() {
    const now = Date.now();
    const h24 = new Date(now - 24 * 3600 * 1000).toISOString();
    const h7d = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
    const strategies = {};

    for (const row of byStrategy.all(h7d)) {
      strategies[row.strategy] = row.count;
    }

    return {
      totalStored: countSignals.get().count,
      last24h: countSince.get(h24).count,
      last7d: countSince.get(h7d).count,
      lastSignal: lastSignal.get()?.timestamp || null,
      byStrategy7d: strategies,
      topSymbols7d: topSymbols.all(h7d).map((row) => [row.symbol, row.count]),
    };
  }

  return {
    db,
    authorizeIngestKey: (candidate) => secureCompare(candidate, ingestKey),
    ingestSignals,
    getSignals,
    getStats,
    countSignals: () => countSignals.get().count,
    close: () => db.close(),
  };
}
