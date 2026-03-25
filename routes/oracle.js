import express from 'express';
import { detectSignals, getSignals, getTopMovers, getWatchlist } from '../oracle/index.js';

export function createOracleRouter({ config }) {
  const router = express.Router();

  // Protetto — genera nuovi segnali
  router.get('/oracle/detect', (req, res) => {
    if (config.alphaAuthKey && req.query.key !== config.alphaAuthKey) {
      return res.status(401).json({ error: 'Auth required' });
    }
    try {
      const result = detectSignals();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pubblico — lista segnali attivi
  router.get('/oracle/signals', (req, res) => {
    const { type, severity, limit, active } = req.query;
    try {
      const signals = getSignals({
        type,
        severity,
        limit: Math.min(parseInt(limit) || 50, 100),
        activeOnly: active !== 'false',
      });
      res.json({ signals, count: signals.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pubblico — top movers
  router.get('/oracle/top-movers', (req, res) => {
    const { limit } = req.query;
    try {
      const movers = getTopMovers({ limit: Math.min(parseInt(limit) || 10, 50) });
      res.json({ movers, count: movers.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pubblico — watchlist (token con più segnali attivi)
  router.get('/oracle/watchlist', (req, res) => {
    const { limit } = req.query;
    try {
      const watchlist = getWatchlist({ limit: Math.min(parseInt(limit) || 20, 50) });
      res.json({ watchlist, count: watchlist.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
