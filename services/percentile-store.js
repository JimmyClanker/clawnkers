/**
 * percentile-store.js — Round 12
 * Stores scan scores in SQLite and provides percentile ranking.
 */

const DIMENSIONS = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'distribution', 'risk'];

/**
 * Ensure the score_history table exists.
 * @param {object} db - better-sqlite3 database instance
 */
export function initScoreHistory(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS score_history (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      project  TEXT    NOT NULL,
      dimension TEXT   NOT NULL,
      score    REAL    NOT NULL,
      scanned_at TEXT  NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sh_dim ON score_history(dimension);
    CREATE INDEX IF NOT EXISTS idx_sh_project ON score_history(project);
  `);
}

/**
 * Round 75: Get all historical scores for a dimension as a sorted array.
 * Used for percentile visualization and distribution charts.
 * @param {object} db
 * @param {string} dimension
 * @returns {number[]} sorted scores ascending
 */
export function getDimensionDistribution(db, dimension) {
  try {
    initScoreHistory(db);
    if (!dimension) {
      // 'overall' is stored in scan_history, not score_history
      const rows = db.prepare(
        "SELECT CAST(json_extract(scores_json, '$.overall.score') AS REAL) AS score FROM scan_history WHERE scores_json IS NOT NULL ORDER BY score ASC"
      ).all();
      return rows.map((r) => r.score).filter((s) => s != null && Number.isFinite(s));
    }
    const rows = db.prepare('SELECT score FROM score_history WHERE dimension = ? ORDER BY score ASC').all(dimension);
    return rows.map((r) => r.score);
  } catch {
    return [];
  }
}

/**
 * Store all dimension scores for a project scan.
 * @param {object} db - better-sqlite3 database instance
 * @param {string} projectName
 * @param {object} scores - result of calculateScores()
 */
export function storeScores(db, projectName, scores) {
  initScoreHistory(db);
  const scannedAt = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO score_history (project, dimension, score, scanned_at) VALUES (?, ?, ?, ?)'
  );
  const insertMany = db.transaction((entries) => {
    for (const [dim, val] of entries) {
      const score = typeof val === 'object' ? val.score : val;
      if (score != null && Number.isFinite(score)) {
        insert.run(projectName, dim, score, scannedAt);
      }
    }
  });

  const entries = DIMENSIONS
    .filter((d) => scores[d] != null)
    .map((d) => [d, scores[d]]);

  insertMany(entries);
}

/**
 * Return the percentile rank (0–100) of a given score within all historical scores for a dimension.
 * @param {object} db
 * @param {string} dimension
 * @param {number} score
 * @returns {number} percentile 0–100
 */
export function getPercentile(db, dimension, score) {
  initScoreHistory(db);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM score_history WHERE dimension = ?').get(dimension)?.cnt ?? 0;
  if (total === 0) return 50; // neutral fallback when no history
  const below = db.prepare('SELECT COUNT(*) as cnt FROM score_history WHERE dimension = ? AND score < ?').get(dimension, score)?.cnt ?? 0;
  return Math.round((below / total) * 100);
}

/**
 * Return percentiles for all dimensions in a scores object.
 * @param {object} db
 * @param {object} scores - calculateScores() result
 * @returns {object} { market_strength: number, ... }
 */
export function getAllPercentiles(db, scores) {
  const result = {};
  for (const dim of DIMENSIONS) {
    const val = scores[dim];
    if (val != null) {
      const score = typeof val === 'object' ? val.score : val;
      result[dim] = getPercentile(db, dim, score);
    }
  }
  return result;
}
