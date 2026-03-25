import express from 'express';
import { collectAll } from '../collectors/index.js';
import { calculateScores } from '../synthesis/scoring.js';
import { fallbackReport, generateReport, generateQuickReport } from '../synthesis/llm.js';
import { formatReport } from '../synthesis/templates.js';
import { getBenchmarkForCategory, compareToSector } from '../services/sector-benchmarks.js';
import { detectRedFlags } from '../services/red-flags.js';
import { detectAlphaSignals } from '../services/alpha-signals.js';
import { generateTradeSetup } from '../services/trade-setup.js';
import { assessRiskReward } from '../services/risk-reward.js';
import { scoreReportQuality } from '../services/report-quality.js';
import { detectCompetitors } from '../services/competitor-detection.js';
import { generateElevatorPitch } from '../services/elevator-pitch.js';
import { detectChanges } from '../services/change-detector.js';

function safeParseJSON(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}

// ── Direct USDC payment verification (Base mainnet) ──────────────
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PAY_TO = '0x4bde6b11df6c0f0f5351e6fb0e7bdc40eaa0cb4d';

async function verifyPayment(txHash) {
  const rpc = 'https://mainnet.base.org';
  let receipt;
  try {
    const resp = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }),
    });
    const data = await resp.json();
    receipt = data.result;
  } catch (err) {
    console.error('[pay-verify] RPC error:', err.message);
    return false;
  }

  if (!receipt || receipt.status !== '0x1') return false;

  for (const log of (receipt.logs || [])) {
    if (
      log.address.toLowerCase() === USDC_BASE &&
      log.topics[0] === TRANSFER_TOPIC &&
      log.topics[2] &&
      log.topics[2].toLowerCase().includes(PAY_TO.slice(2))
    ) {
      const amount = parseInt(log.data, 16);
      if (amount >= 1000000) return true; // >= $1 USDC
    }
  }
  return false;
}

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
    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      scores_json TEXT,
      report_json TEXT,
      scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scan_history_project ON scan_history(project_name, scanned_at);
  `);
}

function storeScanHistory(db, projectName, scores, report) {
  try {
    db.prepare(
      'INSERT INTO scan_history (project_name, scores_json, report_json, scanned_at) VALUES (?, ?, ?, ?)'
    ).run(projectName, JSON.stringify(scores), JSON.stringify(report), new Date().toISOString());
  } catch (err) {
    console.error('[scan_history] Failed to store:', err.message);
  }
}

function getScanVersion(db, projectName) {
  try {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM scan_history WHERE project_name = ?').get(projectName);
    return (row?.cnt ?? 0) + 1;
  } catch {
    return 1;
  }
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

function summarizeDataQuality(rawData, scores) {
  const collectors = rawData?.metadata?.collectors || {};
  const failedCollectors = Object.entries(collectors)
    .filter(([, payload]) => payload?.ok === false || payload?.error)
    .map(([name, payload]) => ({ name, error: payload?.error || 'unknown error' }));

  const durationMs = Number(rawData?.metadata?.duration_ms || 0);
  const latencyBucket = durationMs >= 15000 ? 'slow' : durationMs >= 5000 ? 'moderate' : 'fast';

  return {
    completeness_pct: scores?.overall?.completeness ?? null,
    collector_success_count: Object.keys(collectors).length - failedCollectors.length,
    collector_failure_count: failedCollectors.length,
    failed_collectors: failedCollectors,
    latency_bucket: latencyBucket,
    duration_ms: durationMs || null,
  };
}

function buildResponse({ projectName, rawData, scores, analysis, mode }) {
  const formatted = formatReport(projectName, rawData, scores, analysis);
  return {
    ...formatted.json,
    mode,
    data_quality: summarizeDataQuality(rawData, scores),
    report_text: formatted.text,
    report_html: formatted.html,
  };
}

async function runAnalysis({ projectName, exaService, mode, config, collectAllFn, collectorCache, db }) {
  const rawData = await collectAllFn(projectName, exaService, collectorCache);
  const scores = calculateScores(rawData);

  // Add sector comparison context
  const category = rawData?.onchain?.category || null;
  let sectorComparison = null;
  if (category) {
    try {
      const benchmark = await getBenchmarkForCategory(category);
      if (benchmark) {
        sectorComparison = compareToSector(
          {
            tvl: rawData?.onchain?.tvl,
            market_cap: rawData?.market?.market_cap,
          },
          benchmark,
        );
      }
    } catch (_) { /* sector comparison is non-critical */ }
  }

  // Inject sector comparison into rawData so LLM can reference it
  if (sectorComparison) {
    rawData.sector_comparison = sectorComparison;
  }

  // Detect red flags and alpha signals — inject into rawData for LLM context
  const redFlags = detectRedFlags(rawData, scores);
  const alphaSignals = detectAlphaSignals(rawData, scores);
  rawData.red_flags = redFlags;
  rawData.alpha_signals = alphaSignals;

  const analysis =
    mode === 'quick'
      ? await generateQuickReport(projectName, rawData, scores, { apiKey: config?.xaiApiKey })
      : await generateReport(projectName, rawData, scores, { apiKey: config?.xaiApiKey });

  // Trade setup + risk/reward
  const tradeSetup = generateTradeSetup(rawData, scores);
  const riskReward = assessRiskReward(rawData, scores, tradeSetup);

  // Report quality
  const reportQuality = scoreReportQuality(rawData, scores, analysis);

  // Competitor detection (async, non-blocking)
  let competitors = { competitors: [], comparison_summary: 'Skipped.' };
  try {
    competitors = await detectCompetitors(projectName, rawData);
  } catch (_) { /* non-critical */ }

  // Elevator pitch
  const elevatorPitch = generateElevatorPitch(projectName, rawData, scores, analysis);

  // What changed vs previous scan
  let changes = { has_previous: false, changes: [] };
  if (db) {
    try {
      changes = detectChanges(db, projectName, { rawData, scores, verdict: analysis?.verdict });
    } catch (_) { /* non-critical */ }
  }

  // Compute scan_version before storing
  const scanVersion = db ? getScanVersion(db, projectName) : null;

  const response = buildResponse({ projectName, rawData, scores, analysis, mode });

  // Include sector comparison in response
  if (sectorComparison) {
    response.sector_comparison = sectorComparison;
  }

  // Inject all new service outputs into response
  response.red_flags = redFlags;
  response.alpha_signals = alphaSignals;
  response.trade_setup = tradeSetup;
  response.risk_reward = riskReward;
  response.report_quality = reportQuality;
  response.competitors = competitors;
  response.elevator_pitch = elevatorPitch.pitch;
  response.changes = changes;

  // Add scan versioning
  if (scanVersion !== null) {
    response.scan_version = scanVersion;
  }

  // Store in scan history
  if (db) {
    storeScanHistory(db, projectName, scores, response);
  }

  return response;
}

export function createAlphaRouter({ config, exaService, signalsService, collectAllFn = collectAll, collectorCache = null }) {
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

  async function getOrCreateReport({ cacheKey, ttlMs, projectName, exaService, mode, collectorCache: cc = collectorCache }) {
    const cached = cache.read(cacheKey, ttlMs);
    if (cached) return cached;

    // Single-flight: dedup concurrent requests for the same key
    if (inFlight.has(cacheKey)) {
      return inFlight.get(cacheKey);
    }

    const promise = (async () => {
      try {
        const report = await runAnalysis({ projectName, exaService, mode, config, collectAllFn, collectorCache: cc, db: signalsService.db });
        cache.write(cacheKey, report);
        try { signalsService.db.exec("CREATE TABLE IF NOT EXISTS scan_counter (id INTEGER PRIMARY KEY, count INTEGER DEFAULT 0)"); signalsService.db.exec("INSERT OR IGNORE INTO scan_counter (id, count) VALUES (1, 0)"); signalsService.db.prepare("UPDATE scan_counter SET count = count + 1 WHERE id = 1").run(); } catch {}
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
      return res.status(400).json({ error: 'Missing or invalid ?project= parameter (max 100 characters)' });
    }

    if (
      mode === 'full' &&
      config?.xaiApiKey &&
      config?.alphaAuthKey &&
      req.get('x-alpha-key') !== config.alphaAuthKey &&
      req.query.key !== config.alphaAuthKey
    ) {
      return res.status(401).json({
        error: 'Unauthorized: a valid x-alpha-key header is required for full alpha reports',
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

  // ── Scan history endpoint ──────────────────────────────────────
  router.get('/alpha/history', (req, res) => {
    const projectName = normalizeProject(req.query.project);
    if (!projectName) {
      return res.status(400).json({ error: 'Missing or invalid ?project= parameter' });
    }
    try {
      const rows = signalsService.db.prepare(
        'SELECT id, project_name, scores_json, report_json, scanned_at FROM scan_history WHERE project_name = ? ORDER BY scanned_at DESC LIMIT 10'
      ).all(projectName);
      const history = rows.map((row, idx) => ({
        scan_version: rows.length - idx,
        id: row.id,
        project_name: row.project_name,
        scanned_at: row.scanned_at,
        scores: safeParseJSON(row.scores_json),
        report: safeParseJSON(row.report_json),
      }));
      return res.json({ project: projectName, count: history.length, history });
    } catch (err) {
      console.error('[alpha/history]', err.message);
      return res.status(500).json({ error: 'Failed to retrieve scan history' });
    }
  });

  // ── Machine-readable JSON export ──────────────────────────────
  router.get('/alpha/export', async (req, res) => {
    const projectName = normalizeProject(req.query.project);
    if (!projectName) {
      return res.status(400).json({ error: 'Missing or invalid ?project= parameter' });
    }

    // Try cache first (full mode)
    const cacheKey = buildCacheKey(projectName, 'full');
    let report = cache.read(cacheKey, FULL_TTL_MS);

    // Fall back to quick if no full cached
    if (!report) {
      const quickKey = buildCacheKey(projectName, 'quick');
      report = cache.read(quickKey, QUICK_TTL_MS);
    }

    // If nothing cached, run a quick analysis
    if (!report) {
      try {
        report = await getOrCreateReport({ cacheKey: buildCacheKey(projectName, 'quick'), ttlMs: QUICK_TTL_MS, projectName, exaService, mode: 'quick' });
      } catch (err) {
        return res.status(502).json({ error: 'Export scan failed: ' + err.message });
      }
    }

    // Build compact machine-readable export (strip HTML, strip verbose text)
    const dimensionScores = {};
    const scoreKeys = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'overall'];
    for (const key of scoreKeys) {
      const val = report?.scores?.[key];
      dimensionScores[key] = typeof val === 'object' ? (val?.score ?? null) : (val ?? null);
    }

    const km = report?.key_metrics ?? {};
    const exportPayload = {
      project_name: report?.project_name ?? projectName,
      timestamp: report?.generated_at ?? new Date().toISOString(),
      verdict: report?.verdict ?? null,
      overall_score: dimensionScores.overall,
      dimension_scores: dimensionScores,
      key_metrics: {
        price: km.price ?? null,
        market_cap: km.market_cap ?? null,
        tvl: km.tvl ?? null,
        volume_24h: km.volume_24h ?? null,
      },
      red_flags: (report?.red_flags ?? []).map((f) => ({ flag: f.flag, severity: f.severity, detail: f.detail })),
      alpha_signals: (report?.alpha_signals ?? []).map((s) => ({ signal: s.signal, strength: s.strength, detail: s.detail })),
      trade_setup: report?.trade_setup ? {
        entry_zone: report.trade_setup.entry_zone,
        stop_loss: report.trade_setup.stop_loss,
        take_profit_targets: report.trade_setup.take_profit_targets,
        risk_reward_ratio: report.trade_setup.risk_reward_ratio,
        setup_quality: report.trade_setup.setup_quality,
      } : null,
      risk_reward: report?.risk_reward ? {
        rr_ratio: report.risk_reward.rr_ratio,
        probability_tp1: report.risk_reward.probability_tp1,
        probability_tp2: report.risk_reward.probability_tp2,
        kelly_fraction: report.risk_reward.kelly_fraction,
        position_size_suggestion: report.risk_reward.position_size_suggestion,
        expected_value: report.risk_reward.expected_value,
      } : null,
      elevator_pitch: report?.elevator_pitch ?? null,
      report_quality: report?.report_quality ? {
        quality_score: report.report_quality.quality_score,
        grade: report.report_quality.grade,
        issues: report.report_quality.issues,
      } : null,
      scan_version: report?.scan_version ?? null,
      mode: report?.mode ?? null,
    };

    res.set('Content-Type', 'application/json');
    return res.json(exportPayload);
  });

  // ── Direct USDC payment: verify tx then run full scan ──────────
  router.post('/alpha/pay-verify', express.json(), async (req, res) => {
    const { txHash, project } = req.body || {};
    if (!txHash || !project) {
      return res.status(400).json({ error: 'Missing txHash or project' });
    }

    const projectName = normalizeProject(project);
    if (!projectName) {
      return res.status(400).json({ error: 'Invalid project name (max 100 characters)' });
    }

    const valid = await verifyPayment(txHash);
    if (!valid) {
      return res.status(402).json({ error: 'Payment not verified. Ensure you sent >= $1 USDC to our wallet on Base.' });
    }

    // Run full scan (bypasses auth key check since payment is proven on-chain)
    const ttlMs = FULL_TTL_MS;
    const cacheKey = buildCacheKey(projectName, 'full');
    try {
      const response = await getOrCreateReport({ cacheKey, ttlMs, projectName, exaService, mode: 'full', collectorCache });
      return res.json(response);
    } catch (error) {
      console.error(`[pay-verify] scan failed: ${error.stack || error.message}`);
      return res.status(500).json({ error: 'Scan failed: ' + error.message });
    }
  });

  return router;
}
