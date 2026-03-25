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
import { generateThesis } from '../services/thesis-generator.js';
import { assessVolatility } from '../services/volatility-guard.js';
import { detectPriceAlerts } from '../services/price-alerts.js';
import { computeScoreVelocity } from '../services/score-velocity.js';
import { getDimensionDistribution } from '../services/percentile-store.js';

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

  const successCount = Object.keys(collectors).length - failedCollectors.length;
  const totalCount = Object.keys(collectors).length;
  return {
    completeness_pct: scores?.overall?.completeness ?? null,
    collector_success_count: successCount,
    collector_failure_count: failedCollectors.length,
    collector_total_count: totalCount,
    collector_success_rate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) : null,
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
    // Round 50: also pass volume/TVL data to sector comparison for efficiency calc
    rawData.sector_comparison._volume_24h = rawData?.market?.total_volume ?? null;
    rawData.sector_comparison._tvl = rawData?.onchain?.tvl ?? null;
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

  // Round 12: Investment thesis (bull/bear/neutral)
  const thesis = generateThesis(projectName, rawData, scores, redFlags, alphaSignals);

  // What changed vs previous scan
  let changes = { has_previous: false, changes: [] };
  if (db) {
    try {
      changes = detectChanges(db, projectName, { rawData, scores, verdict: analysis?.verdict });
    } catch (_) { /* non-critical */ }
  }

  // Compute scan_version before storing
  const scanVersion = db ? getScanVersion(db, projectName) : null;

  // Round 35: volatility regime assessment (computed before buildResponse so it flows into rawData for LLM)
  const volatilityAssessment = assessVolatility(rawData);
  rawData.volatility = volatilityAssessment;

  // Round 47: price alert detection
  const priceAlerts = detectPriceAlerts(rawData);
  rawData.price_alerts = priceAlerts;

  // Round 28: TVL leadership signal — if project TVL > all detected competitors, note it
  if (
    competitors?.competitors?.length > 0 &&
    rawData?.onchain?.tvl != null
  ) {
    const projectTvl = rawData.onchain.tvl;
    const allCompetitorsTvl = competitors.competitors.map((c) => c.tvl ?? 0);
    const isTvlLeader = allCompetitorsTvl.every((t) => projectTvl > t);
    if (isTvlLeader) {
      rawData.alpha_signals = rawData.alpha_signals || [];
      const alreadyHas = rawData.alpha_signals.some((s) => s.signal === 'tvl_sector_leader');
      if (!alreadyHas) {
        rawData.alpha_signals.push({
          signal: 'tvl_sector_leader',
          strength: 'strong',
          detail: `${projectName} has the highest TVL in its sector among detected peers — category dominance.`,
        });
      }
    }
  }

  const response = buildResponse({ projectName, rawData, scores, analysis, mode });

  // Attach volatility + price alerts + score velocity to response (after buildResponse)
  response.volatility = volatilityAssessment;
  response.price_alerts = priceAlerts;

  // Round 52: score velocity
  if (db) {
    try {
      const velocity = computeScoreVelocity(db, projectName);
      response.score_velocity = velocity;
    } catch (_) { /* non-critical */ }
  }

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
  response.thesis = thesis;
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

    const forceRefresh = req.query.force_refresh === 'true' || req.query.force_refresh === '1';
    // Round 73: force_refresh bypasses cache by using 0ms TTL (effectively cache-miss always)
    const ttlMs = forceRefresh ? 0 : (mode === 'quick' ? QUICK_TTL_MS : FULL_TTL_MS);
    const cacheKey = buildCacheKey(projectName, mode);

    try {
      const response = await getOrCreateReport({ cacheKey, ttlMs, projectName, exaService, mode });
      // Round 72: Add cache status header for client-side debugging
      const cacheStatus = response?.cache?.hit ? 'HIT' : 'MISS';
      res.set('X-Cache-Status', cacheStatus);
      res.set('X-Cache-Age-Ms', String(response?.cache?.age_ms ?? 0));
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
      // Round 20: include score trend comparison between adjacent scans
      const history = rows.map((row, idx) => {
        const scores = safeParseJSON(row.scores_json);
        const nextRow = rows[idx + 1]; // older scan
        let scoreTrend = null;
        if (nextRow) {
          const prevScores = safeParseJSON(nextRow.scores_json);
          const currOverall = scores?.overall?.score ?? scores?.overall;
          const prevOverall = prevScores?.overall?.score ?? prevScores?.overall;
          if (currOverall != null && prevOverall != null) {
            const delta = Number(currOverall) - Number(prevOverall);
            scoreTrend = {
              overall_delta: parseFloat(delta.toFixed(2)),
              direction: delta > 0.2 ? 'up' : delta < -0.2 ? 'down' : 'flat',
            };
          }
        }
        return {
          scan_version: rows.length - idx,
          id: row.id,
          project_name: row.project_name,
          scanned_at: row.scanned_at,
          scores,
          score_trend: scoreTrend,
          verdict: safeParseJSON(row.report_json)?.verdict ?? null,
        };
      });
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
      // Round 49: Compact agent-readable summary
      summary: (() => {
        const score = dimensionScores.overall;
        const verdict = report?.verdict ?? 'HOLD';
        const criticalFlags = (report?.red_flags ?? []).filter((f) => f.severity === 'critical').length;
        const strongSignals = (report?.alpha_signals ?? []).filter((s) => s.strength === 'strong').length;
        const pitch = report?.elevator_pitch ?? null;
        const parts = [`${report?.project_name ?? projectName} — ${verdict} (${score?.toFixed(1) ?? '?'}/10)`];
        if (criticalFlags > 0) parts.push(`⚠️ ${criticalFlags} critical flag(s)`);
        if (strongSignals > 0) parts.push(`🚀 ${strongSignals} strong signal(s)`);
        if (pitch) parts.push(pitch);
        return parts.join(' · ');
      })(),
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

  // ── Round 27: Batch quick-scan endpoint ───────────────────────
  router.post('/alpha/batch', express.json({ limit: '10kb' }), async (req, res) => {
    const { projects } = req.body || {};
    if (!Array.isArray(projects) || projects.length === 0) {
      return res.status(400).json({ error: 'Provide a JSON body: { "projects": ["btc", "eth", ...] }' });
    }
    if (projects.length > 5) {
      return res.status(400).json({ error: 'Maximum 5 projects per batch request' });
    }

    const normalized = projects.map(normalizeProject).filter(Boolean);
    if (normalized.length === 0) {
      return res.status(400).json({ error: 'No valid project names provided' });
    }

    // Run all quick scans in parallel (already uses cache + single-flight)
    const results = await Promise.allSettled(
      normalized.map((projectName) =>
        getOrCreateReport({
          cacheKey: buildCacheKey(projectName, 'quick'),
          ttlMs: QUICK_TTL_MS,
          projectName,
          exaService,
          mode: 'quick',
        })
      )
    );

    const batch = results.map((result, idx) => {
      const projectName = normalized[idx];
      if (result.status === 'fulfilled') {
        const r = result.value;
        return {
          project: projectName,
          ok: true,
          verdict: r.verdict,
          overall_score: r.scores?.overall?.score ?? null,
          key_metrics: r.key_metrics,
          elevator_pitch: r.elevator_pitch ?? null,
          cache: r.cache,
        };
      }
      return {
        project: projectName,
        ok: false,
        error: result.reason?.message ?? 'Scan failed',
      };
    });

    return res.json({
      batch,
      count: batch.length,
      generated_at: new Date().toISOString(),
    });
  });

  // ── Round 22: Scan statistics endpoint ────────────────────────
  router.get('/alpha/stats', (req, res) => {
    try {
      const totalScans = (() => {
        try {
          return signalsService.db.prepare('SELECT COALESCE(count, 0) as count FROM scan_counter WHERE id = 1').get()?.count ?? 0;
        } catch { return 0; }
      })();

      const uniqueProjects = (() => {
        try {
          return signalsService.db.prepare('SELECT COUNT(DISTINCT project_name) as cnt FROM scan_history').get()?.cnt ?? 0;
        } catch { return 0; }
      })();

      const recentScans24h = (() => {
        try {
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          return signalsService.db.prepare('SELECT COUNT(*) as cnt FROM scan_history WHERE scanned_at >= ?').get(cutoff)?.cnt ?? 0;
        } catch { return 0; }
      })();

      const verdictDist = (() => {
        try {
          const rows = signalsService.db.prepare(`
            SELECT
              json_extract(report_json, '$.verdict') AS verdict,
              COUNT(*) AS cnt
            FROM scan_history
            GROUP BY verdict
          `).all();
          return rows.reduce((acc, r) => { if (r.verdict) acc[r.verdict] = r.cnt; return acc; }, {});
        } catch { return {}; }
      })();

      const avgScore = (() => {
        try {
          const row = signalsService.db.prepare(`
            SELECT AVG(CAST(json_extract(scores_json, '$.overall.score') AS REAL)) AS avg_score
            FROM scan_history
            WHERE scanned_at >= ?
          `).get(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
          return row?.avg_score != null ? Math.round(row.avg_score * 100) / 100 : null;
        } catch { return null; }
      })();

      return res.json({
        total_scans: totalScans,
        unique_projects: uniqueProjects,
        scans_last_24h: recentScans24h,
        verdict_distribution: verdictDist,
        avg_overall_score_7d: avgScore,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[alpha/stats]', err.message);
      return res.status(500).json({ error: 'Failed to compute stats' });
    }
  });

  // ── Round 15: Trending projects (recently scanned with improving momentum) ─
  router.get('/alpha/trending', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 10, 25);
    const windowHours = Math.min(Number(req.query.window_hours) || 24, 168);
    try {
      // Get projects scanned in the last N hours, ordered by most recently scanned
      const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
      const rows = signalsService.db.prepare(`
        SELECT
          sh.project_name,
          sh.scanned_at,
          sh.scores_json,
          sh.report_json,
          COUNT(*) OVER (PARTITION BY sh.project_name) AS scan_count
        FROM scan_history sh
        INNER JOIN (
          SELECT project_name, MAX(scanned_at) AS latest
          FROM scan_history
          WHERE scanned_at >= ?
          GROUP BY project_name
        ) recent ON sh.project_name = recent.project_name
          AND sh.scanned_at = recent.latest
        ORDER BY sh.scanned_at DESC
        LIMIT ?
      `).all(cutoff, limit);

      const entries = rows.map((row) => {
        const scores = safeParseJSON(row.scores_json);
        const report = safeParseJSON(row.report_json);
        const overall = scores?.overall?.score ?? null;
        return {
          project_name: row.project_name,
          scanned_at: row.scanned_at,
          overall_score: overall,
          verdict: report?.verdict ?? null,
          scan_count: row.scan_count,
          alpha_signals: (report?.alpha_signals ?? []).length,
          red_flags: (report?.red_flags ?? []).filter((f) => f.severity === 'critical').length,
          dex_pressure: report?.raw_data?.dex?.pressure_signal ?? null,
          tvl_stickiness: report?.raw_data?.onchain?.tvl_stickiness ?? null,
        };
      });

      return res.json({
        trending: entries,
        count: entries.length,
        window_hours: windowHours,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[alpha/trending]', err.message);
      return res.status(500).json({ error: 'Failed to build trending list' });
    }
  });

  // ── Round 45: Score sparkline endpoint — score history for charting ────
  router.get('/alpha/sparkline', (req, res) => {
    const projectName = normalizeProject(req.query.project);
    if (!projectName) {
      return res.status(400).json({ error: 'Missing ?project= parameter' });
    }
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    try {
      const rows = signalsService.db.prepare(`
        SELECT id, scanned_at, scores_json
        FROM scan_history
        WHERE project_name = ?
        ORDER BY scanned_at DESC LIMIT ?
      `).all(projectName, limit);

      if (rows.length === 0) {
        return res.json({ project: projectName, sparkline: [], message: 'No history found.' });
      }

      const DIMS = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'distribution', 'risk', 'overall'];
      const rawPoints = rows.reverse().map((row) => {
        const s = safeParseJSON(row.scores_json) ?? {};
        const point = { id: row.id, scanned_at: row.scanned_at };
        for (const dim of DIMS) {
          const val = s[dim];
          point[dim] = typeof val === 'object' ? (val?.score ?? null) : (val ?? null);
        }
        return point;
      });
      // Round 70: Add delta (change vs previous point) for each sparkline entry
      const sparkline = rawPoints.map((point, idx) => {
        if (idx === 0) return { ...point, overall_delta: null };
        const prev = rawPoints[idx - 1];
        const delta = point.overall != null && prev.overall != null
          ? parseFloat((point.overall - prev.overall).toFixed(2))
          : null;
        return { ...point, overall_delta: delta };
      });

      // Round 71: Summary stats for the sparkline
      const overallScores = sparkline.map((p) => p.overall).filter((v) => v != null);
      const sparklineSummary = overallScores.length > 0 ? {
        min: Math.min(...overallScores),
        max: Math.max(...overallScores),
        avg: parseFloat((overallScores.reduce((a, b) => a + b, 0) / overallScores.length).toFixed(2)),
        latest: overallScores[overallScores.length - 1],
        trend: overallScores.length >= 2
          ? (overallScores[overallScores.length - 1] > overallScores[0] ? 'up' : overallScores[overallScores.length - 1] < overallScores[0] ? 'down' : 'flat')
          : 'insufficient_data',
      } : null;

      return res.json({
        project: projectName,
        count: sparkline.length,
        sparkline,
        summary: sparklineSummary,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[alpha/sparkline]', err.message);
      return res.status(500).json({ error: 'Failed to build sparkline' });
    }
  });

  // ── Round 44: Daily digest endpoint — top movers from scan_history ──────
  router.get('/alpha/digest', (req, res) => {
    const windowHours = Math.min(Number(req.query.window_hours) || 24, 168);
    try {
      const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

      // Get latest scan per project within window
      const rows = signalsService.db.prepare(`
        SELECT sh.project_name, sh.scanned_at, sh.scores_json, sh.report_json
        FROM scan_history sh
        INNER JOIN (
          SELECT project_name, MAX(scanned_at) AS latest
          FROM scan_history WHERE scanned_at >= ?
          GROUP BY project_name
        ) latest ON sh.project_name = latest.project_name AND sh.scanned_at = latest.latest
        ORDER BY sh.scanned_at DESC LIMIT 50
      `).all(cutoff);

      if (rows.length === 0) {
        return res.json({ digest: 'No scans in the last window.', projects: [], generated_at: new Date().toISOString() });
      }

      const projects = rows.map((row) => {
        const scores = JSON.parse(row.scores_json || '{}');
        const report = JSON.parse(row.report_json || '{}');
        return {
          name: row.project_name,
          verdict: report.verdict ?? 'HOLD',
          score: scores.overall?.score ?? null,
          critical_flags: (report.red_flags ?? []).filter((f) => f.severity === 'critical').length,
          strong_signals: (report.alpha_signals ?? []).filter((s) => s.strength === 'strong').length,
          price_fmt: report.key_metrics?.price_fmt ?? 'n/a',
          market_cap_fmt: report.key_metrics?.market_cap_fmt ?? 'n/a',
          elevator_pitch: report.elevator_pitch ?? null,
          scanned_at: row.scanned_at,
        };
      }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

      const strongBuys = projects.filter((p) => p.verdict === 'STRONG BUY' || p.verdict === 'BUY');
      const avoids = projects.filter((p) => p.verdict === 'STRONG AVOID' || p.verdict === 'AVOID');
      const topScore = projects[0];

      const lines = [
        `🧠 Alpha Scanner Digest — Last ${windowHours}h`,
        `📊 ${projects.length} projects scanned`,
        '',
        `🏆 Top rated: ${topScore?.name ?? 'none'} (${topScore?.score?.toFixed(1) ?? 'n/a'}/10 — ${topScore?.verdict ?? 'n/a'})`,
        `✅ Bullish: ${strongBuys.length} (${strongBuys.slice(0, 3).map((p) => p.name).join(', ') || 'none'})`,
        `❌ Avoid: ${avoids.length} (${avoids.slice(0, 3).map((p) => p.name).join(', ') || 'none'})`,
        '',
        '🔍 Full ranking:',
        ...projects.slice(0, 10).map((p, i) => `  ${i + 1}. ${p.name} — ${p.score?.toFixed(1) ?? '?'}/10 [${p.verdict}]${p.critical_flags > 0 ? ` ⚠️ ${p.critical_flags} critical` : ''}${p.strong_signals > 0 ? ` 🚀 ${p.strong_signals} signals` : ''}`),
      ];

      return res.json({
        digest: lines.join('\n'),
        projects,
        window_hours: windowHours,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[alpha/digest]', err.message);
      return res.status(500).json({ error: 'Failed to build digest' });
    }
  });

  // ── Round 38: Watchlist endpoint — track a portfolio of projects ──────────
  router.get('/alpha/watchlist', async (req, res) => {
    const raw = req.query.projects || req.query.project || '';
    const projectList = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    if (projectList.length === 0) {
      return res.status(400).json({ error: 'Provide ?projects=btc,eth,sol (comma-separated)' });
    }
    if (projectList.length > 8) {
      return res.status(400).json({ error: 'Maximum 8 projects per watchlist request' });
    }
    const normalized = projectList.map(normalizeProject).filter(Boolean);

    const results = await Promise.allSettled(
      normalized.map((projectName) =>
        getOrCreateReport({
          cacheKey: buildCacheKey(projectName, 'quick'),
          ttlMs: QUICK_TTL_MS,
          projectName,
          exaService,
          mode: 'quick',
        })
      )
    );

    const watchlist = results.map((result, idx) => {
      const projectName = normalized[idx];
      if (result.status === 'fulfilled') {
        const r = result.value;
        const scores = r.scores ?? {};
        const dimScores = {};
        for (const dim of ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'risk']) {
          dimScores[dim] = scores[dim]?.score ?? null;
        }
        return {
          project: projectName,
          ok: true,
          verdict: r.verdict,
          overall_score: scores.overall?.score ?? null,
          dimension_scores: dimScores,
          key_metrics: {
            price_fmt: r.key_metrics?.price_fmt,
            market_cap_fmt: r.key_metrics?.market_cap_fmt,
            volume_24h_fmt: r.key_metrics?.volume_24h_fmt,
          },
          red_flag_count: (r.red_flags ?? []).length,
          critical_flag_count: (r.red_flags ?? []).filter((f) => f.severity === 'critical').length,
          alpha_signal_count: (r.alpha_signals ?? []).length,
          volatility_regime: r.volatility?.regime ?? 'calm',
          elevator_pitch: r.elevator_pitch ?? null,
          cache_hit: r.cache?.hit ?? false,
        };
      }
      return { project: projectName, ok: false, error: result.reason?.message ?? 'Scan failed' };
    });

    // Sort by overall_score descending for at-a-glance ranking
    const sorted = [...watchlist].sort((a, b) => (b.overall_score ?? -1) - (a.overall_score ?? -1));

    return res.json({
      watchlist: sorted,
      count: sorted.length,
      generated_at: new Date().toISOString(),
    });
  });

  // ── Round 30: Leaderboard endpoint ────────────────────────────
  router.get('/alpha/leaderboard', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    try {
      // Get the most recent scan for each project and rank by overall score
      const rows = signalsService.db.prepare(`
        SELECT
          sh.project_name,
          sh.scanned_at,
          sh.scores_json,
          sh.report_json
        FROM scan_history sh
        INNER JOIN (
          SELECT project_name, MAX(scanned_at) AS latest
          FROM scan_history
          GROUP BY project_name
        ) latest_scans ON sh.project_name = latest_scans.project_name
          AND sh.scanned_at = latest_scans.latest
        ORDER BY sh.scanned_at DESC
        LIMIT 100
      `).all();

      const entries = rows
        .map((row) => {
          const scores = safeParseJSON(row.scores_json);
          const report = safeParseJSON(row.report_json);
          const overall = scores?.overall?.score ?? scores?.overall ?? null;
          return {
            project_name: row.project_name,
            scanned_at: row.scanned_at,
            overall_score: overall,
            verdict: report?.verdict ?? null,
            price_fmt: report?.key_metrics?.price_fmt ?? null,
            market_cap_fmt: report?.key_metrics?.market_cap_fmt ?? null,
          };
        })
        .filter((e) => e.overall_score != null)
        .sort((a, b) => b.overall_score - a.overall_score)
        .slice(0, limit);

      return res.json({
        leaderboard: entries,
        count: entries.length,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[alpha/leaderboard]', err.message);
      return res.status(500).json({ error: 'Failed to build leaderboard' });
    }
  });

  // ── Round 76: Score distribution endpoint — population stats ─────────────
  router.get('/alpha/distribution', (req, res) => {
    const DIMS = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'distribution', 'risk', 'overall'];
    const result = {};
    for (const dim of DIMS) {
      try {
        const scores = getDimensionDistribution(signalsService.db, dim === 'overall' ? null : dim);
        // null = overall (from scan_history)
        if (!scores.length) { result[dim] = null; continue; }
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const mid = Math.floor(scores.length / 2);
        const median = scores.length % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid];
        result[dim] = {
          n: scores.length,
          min: parseFloat(Math.min(...scores).toFixed(2)),
          max: parseFloat(Math.max(...scores).toFixed(2)),
          avg: parseFloat(avg.toFixed(2)),
          median: parseFloat(median.toFixed(2)),
          p25: parseFloat((scores[Math.floor(scores.length * 0.25)] ?? scores[0]).toFixed(2)),
          p75: parseFloat((scores[Math.floor(scores.length * 0.75)] ?? scores[scores.length - 1]).toFixed(2)),
        };
      } catch (_) { result[dim] = null; }
    }
    return res.json({ distribution: result, generated_at: new Date().toISOString() });
  });

  // ── Round 10: Project comparison endpoint ─────────────────────
  router.get('/alpha/compare', async (req, res) => {
    const a = normalizeProject(req.query.a);
    const b = normalizeProject(req.query.b);
    if (!a || !b) {
      return res.status(400).json({ error: 'Missing ?a= and ?b= project parameters' });
    }
    if (a.toLowerCase() === b.toLowerCase()) {
      return res.status(400).json({ error: 'Parameters a and b must be different projects' });
    }

    try {
      const [reportA, reportB] = await Promise.all([
        getOrCreateReport({ cacheKey: buildCacheKey(a, 'quick'), ttlMs: QUICK_TTL_MS, projectName: a, exaService, mode: 'quick' }),
        getOrCreateReport({ cacheKey: buildCacheKey(b, 'quick'), ttlMs: QUICK_TTL_MS, projectName: b, exaService, mode: 'quick' }),
      ]);

      const compareScores = (key) => {
        const sa = reportA?.scores?.[key]?.score ?? reportA?.scores?.[key] ?? null;
        const sb = reportB?.scores?.[key]?.score ?? reportB?.scores?.[key] ?? null;
        return { [a]: sa, [b]: sb, winner: sa != null && sb != null ? (sa > sb ? a : sb > sa ? b : 'tie') : null };
      };

      const dimensions = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'distribution', 'risk'];
      const scoreComparison = {};
      for (const dim of dimensions) {
        scoreComparison[dim] = compareScores(dim);
      }
      scoreComparison.overall = compareScores('overall');

      return res.json({
        comparison: {
          [a]: {
            verdict: reportA?.verdict,
            overall_score: reportA?.scores?.overall?.score ?? null,
            key_metrics: reportA?.key_metrics,
          },
          [b]: {
            verdict: reportB?.verdict,
            overall_score: reportB?.scores?.overall?.score ?? null,
            key_metrics: reportB?.key_metrics,
          },
        },
        score_comparison: scoreComparison,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[alpha/compare]', err.message);
      return res.status(502).json({ error: 'Comparison failed: ' + err.message });
    }
  });

  return router;
}
