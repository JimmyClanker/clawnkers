import { getCalibrationDb } from '../calibration/db.js';
export { detectSignals } from './signal-detector.js';

/**
 * Query segnali dal DB.
 * @param {{ type?: string, severity?: string, limit?: number, activeOnly?: boolean, db?: import('better-sqlite3').Database }} [opts]
 */
export function getSignals({ type, severity, limit = 50, activeOnly = true, db: injectedDb } = {}) {
  const db = injectedDb || getCalibrationDb();
  let sql = 'SELECT * FROM oracle_signals WHERE 1=1';
  const params = [];

  if (activeOnly) {
    sql += " AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))";
  }
  if (type) {
    sql += ' AND signal_type = ?';
    params.push(type);
  }
  if (severity) {
    sql += ' AND severity = ?';
    params.push(severity);
  }

  sql += ' ORDER BY generated_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params).map(row => ({
    ...row,
    data: row.data_json ? JSON.parse(row.data_json) : null,
  }));
}

/**
 * Top movers: token con maggior delta score nelle ultime 72h.
 * @param {{ limit?: number, db?: import('better-sqlite3').Database }} [opts]
 */
export function getTopMovers({ limit = 10, db: injectedDb } = {}) {
  const db = injectedDb || getCalibrationDb();

  const rows = db.prepare(`
    SELECT
      tu.id AS token_id,
      tu.name AS token_name,
      tu.symbol AS token_symbol,
      sc_recent.overall_score AS current_score,
      sc_old.overall_score    AS prev_score,
      (sc_recent.overall_score - sc_old.overall_score) AS delta,
      ABS(sc_recent.overall_score - sc_old.overall_score) AS abs_delta,
      ts_recent.snapshot_at AS recent_at,
      ts_old.snapshot_at    AS old_at
    FROM token_universe tu

    JOIN token_snapshots ts_recent
      ON ts_recent.token_id = tu.id
      AND ts_recent.id = (
        SELECT id FROM token_snapshots
        WHERE token_id = tu.id
        ORDER BY snapshot_at DESC LIMIT 1
      )
    JOIN token_scores sc_recent ON sc_recent.snapshot_id = ts_recent.id

    JOIN token_snapshots ts_old
      ON ts_old.token_id = tu.id
      AND ts_old.id = (
        SELECT id FROM token_snapshots
        WHERE token_id = tu.id
          AND datetime(snapshot_at) <= datetime(ts_recent.snapshot_at, '-60 hours')
          AND datetime(snapshot_at) >= datetime(ts_recent.snapshot_at, '-84 hours')
        ORDER BY snapshot_at DESC LIMIT 1
      )
    JOIN token_scores sc_old ON sc_old.snapshot_id = ts_old.id

    WHERE sc_recent.overall_score IS NOT NULL
      AND sc_old.overall_score IS NOT NULL

    ORDER BY abs_delta DESC
    LIMIT ?
  `).all(limit);

  return rows.map(row => ({
    token_id: row.token_id,
    token_name: row.token_name,
    token_symbol: row.token_symbol,
    current_score: row.current_score,
    prev_score: row.prev_score,
    delta: row.delta,
    direction: row.delta > 0 ? 'improving' : 'declining',
  }));
}

/**
 * Watchlist: token con segnali attivi, ordinati per numero di segnali (desc).
 * @param {{ limit?: number, db?: import('better-sqlite3').Database }} [opts]
 */
export function getWatchlist({ limit = 20, db: injectedDb } = {}) {
  const db = injectedDb || getCalibrationDb();

  const rows = db.prepare(`
    SELECT
      os.token_id,
      tu.name AS token_name,
      tu.symbol AS token_symbol,
      COUNT(*) AS signal_count,
      MAX(CASE os.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS max_severity_rank,
      GROUP_CONCAT(DISTINCT os.signal_type) AS signal_types
    FROM oracle_signals os
    LEFT JOIN token_universe tu ON tu.id = os.token_id
    WHERE (os.expires_at IS NULL OR datetime(os.expires_at) > datetime('now'))
      AND os.token_id IS NOT NULL
    GROUP BY os.token_id
    ORDER BY signal_count DESC, max_severity_rank DESC
    LIMIT ?
  `).all(limit);

  return rows.map(row => ({
    token_id: row.token_id,
    token_name: row.token_name,
    token_symbol: row.token_symbol,
    signal_count: row.signal_count,
    signal_types: row.signal_types ? row.signal_types.split(',') : [],
  }));
}
