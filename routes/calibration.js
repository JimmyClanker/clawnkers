/**
 * calibration.js — Routes for batch scanning and token universe
 *
 * GET /alpha/batch-scan?tier=A&level=1&limit=10&key=AUTH_KEY  (protected)
 * GET /alpha/universe  (public)
 */

import express from 'express';
import { getCalibrationDb } from '../calibration/db.js';
import { runBatchScan } from '../calibration/batch-scanner.js';

/**
 * Create calibration router.
 * @param {object} opts
 * @param {object} opts.config - app config (needs alphaAuthKey)
 * @returns {express.Router}
 */
export function createCalibrationRouter({ config } = {}) {
  const router = express.Router();

  /**
   * GET /alpha/universe — list all tokens in the universe (public)
   */
  router.get('/alpha/universe', (req, res) => {
    try {
      const db = getCalibrationDb();
      const tier = req.query.tier ? String(req.query.tier).toUpperCase() : null;
      const category = req.query.category ? String(req.query.category) : null;

      let sql = 'SELECT id, symbol, name, coingecko_id, category, tier, active, added_at FROM token_universe WHERE active = 1';
      const params = [];

      if (tier && (tier === 'A' || tier === 'B')) {
        sql += ' AND tier = ?';
        params.push(tier);
      }
      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }

      sql += ' ORDER BY tier ASC, id ASC';

      const tokens = db.prepare(sql).all(...params);

      return res.json({
        tokens,
        count: tokens.length,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[calibration/universe]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /alpha/batch-scan — trigger a batch scan (protected)
   *
   * Query params:
   *   key=AUTH_KEY (required)
   *   tier=A|B|all (default: A)
   *   level=0|1 (default: 1)
   *   limit=N (default: 10, max: 150)
   */
  router.get('/alpha/batch-scan', async (req, res) => {
    // Auth check
    if (config?.alphaAuthKey) {
      const providedKey = req.query.key || req.get('x-alpha-key');
      if (providedKey !== config.alphaAuthKey) {
        return res.status(401).json({ error: 'Unauthorized: valid key required' });
      }
    }

    const tier = req.query.tier ? String(req.query.tier) : 'A';
    const level = parseInt(req.query.level ?? '1', 10);
    const limit = Math.min(parseInt(req.query.limit ?? '10', 10), 150);

    if (!['A', 'B', 'all'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Use A, B, or all.' });
    }
    if (![0, 1].includes(level)) {
      return res.status(400).json({ error: 'Invalid level. Use 0 or 1.' });
    }
    if (isNaN(limit) || limit < 1) {
      return res.status(400).json({ error: 'Invalid limit. Must be >= 1.' });
    }

    try {
      const summary = await runBatchScan({ tier, level, limit });
      return res.json(summary);
    } catch (err) {
      console.error('[calibration/batch-scan]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export default createCalibrationRouter;
