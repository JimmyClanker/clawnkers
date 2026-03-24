import express from 'express';
import { collectAll } from '../collectors/index.js';
import { calculateScores } from '../synthesis/scoring.js';
import { fallbackReport, generateReport } from '../synthesis/llm.js';
import { formatReport } from '../synthesis/templates.js';

const FULL_TTL_MS = 60 * 60 * 1000;
const QUICK_TTL_MS = 15 * 60 * 1000;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS alpha_reports (
      project_name TEXT PRIMARY KEY,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_alpha_reports_created_at ON alpha_reports(created_at);
  `);
}

function normalizeProject(project) {
  if (typeof project !== 'string') return null;
  const value = project.trim();
  if (!value || value.length > 100) return null;
  return value;
}

function buildCacheKey(projectName, mode) {
  return `${mode}:${projectName.trim().toLowerCase()}`;
}

function createCacheHelpers(db) {
  ensureSchema(db);

  const getStmt = db.prepare('SELECT report_json, created_at FROM alpha_reports WHERE project_name = ?');
  const deleteStmt = db.prepare('DELETE FROM alpha_reports WHERE project_name = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO alpha_reports (project_name, report_json, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(project_name) DO UPDATE SET
      report_json = excluded.report_json,
      created_at = excluded.created_at
  `);

  return {
    read(cacheKey, ttlMs) {
      const row = getStmt.get(cacheKey);
      if (!row) return null;

      const ageMs = Date.now() - new Date(row.created_at).getTime();
      if (Number.isNaN(ageMs) || ageMs > ttlMs) return null;

      try {
        const payload = JSON.parse(row.report_json);
        payload.cache = {
          ...(payload.cache || {}),
          hit: true,
          key: cacheKey,
          age_ms: ageMs,
          ttl_ms: ttlMs,
          created_at: row.created_at,
        };
        return payload;
      } catch {
        deleteStmt.run(cacheKey);
        return null;
      }
    },
    write(cacheKey, payload) {
      const createdAt = new Date().toISOString();
      upsertStmt.run(
        cacheKey,
        JSON.stringify({
          ...payload,
          cache: {
            ...(payload.cache || {}),
            hit: false,
            key: cacheKey,
            age_ms: 0,
            created_at: createdAt,
          },
        }),
        createdAt
      );
    },
  };
}

function buildResponse({ projectName, rawData, scores, analysis, mode }) {
  const formatted = formatReport(projectName, rawData, scores, analysis);
  return {
    ...formatted.json,
    mode,
    report_text: formatted.text,
    report_html: formatted.html,
  };
}

async function runAnalysis({ projectName, exaService, mode, config, collectAllFn }) {
  const rawData = await collectAllFn(projectName, exaService);
  const scores = calculateScores(rawData);
  const analysis =
    mode === 'quick'
      ? fallbackReport(projectName, rawData, scores)
      : await generateReport(projectName, rawData, scores, { apiKey: config?.xaiApiKey });

  return buildResponse({ projectName, rawData, scores, analysis, mode });
}

export function createAlphaRouter({ config, exaService, signalsService, collectAllFn = collectAll }) {
  const router = express.Router();
  const cache = createCacheHelpers(signalsService.db);
  const inFlight = new Map();

  // Cleanup expired cache rows every 30 min
  const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
  const cleanupStmt = signalsService.db.prepare(
    "DELETE FROM alpha_reports WHERE datetime(created_at) < datetime('now', '-2 hours')"
  );
  const cleanupTimer = setInterval(() => {
    try { cleanupStmt.run(); } catch (_) { /* ignore */ }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();

  async function getOrCreateReport({ cacheKey, ttlMs, projectName, exaService, mode }) {
    const cached = cache.read(cacheKey, ttlMs);
    if (cached) return cached;

    // Single-flight: dedup concurrent requests for the same key
    if (inFlight.has(cacheKey)) {
      return inFlight.get(cacheKey);
    }

    const promise = (async () => {
      try {
        const report = await runAnalysis({ projectName, exaService, mode, config, collectAllFn });
        cache.write(cacheKey, report);
        return {
          ...report,
          cache: {
            ...(report.cache || {}),
            hit: false,
            key: cacheKey,
            ttl_ms: ttlMs,
            age_ms: 0,
            created_at: new Date().toISOString(),
          },
        };
      } finally {
        inFlight.delete(cacheKey);
      }
    })();

    inFlight.set(cacheKey, promise);
    return promise;
  }

  async function handleRequest(req, res, mode) {
    const projectName = normalizeProject(req.query.project);
    if (!projectName) {
      return res.status(400).json({ error: 'Missing or invalid ?project= parameter (max 100 chars)' });
    }

    if (
      mode === 'full' &&
      config?.xaiApiKey &&
      config?.alphaAuthKey &&
      req.get('x-alpha-key') !== config.alphaAuthKey
    ) {
      return res.status(401).json({
        error: 'Unauthorized: valid x-alpha-key header required for full alpha reports',
      });
    }

    const ttlMs = mode === 'quick' ? QUICK_TTL_MS : FULL_TTL_MS;
    const cacheKey = buildCacheKey(projectName, mode);

    try {
      const response = await getOrCreateReport({ cacheKey, ttlMs, projectName, exaService, mode });
      return res.json(response);
    } catch (error) {
      console.error(`[alpha:${mode}] ${error.stack || error.message}`);
      return res.status(502).json({ error: 'Alpha analysis failed' });
    }
  }

  router.get('/alpha', (req, res) => handleRequest(req, res, 'full'));
  router.get('/alpha/quick', (req, res) => handleRequest(req, res, 'quick'));

  return router;
}
