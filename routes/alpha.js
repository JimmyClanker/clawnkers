import express from 'express';
import { collectAll } from '../collectors/index.js';
import {
  safeParseJSON,
  verifyPayment,
  FULL_TTL_MS,
  QUICK_TTL_MS,
  adaptiveTtlMs,
  normalizeProject,
  buildCacheKey,
  createCacheHelpers,
  runAnalysis,
} from './alpha-helpers.js';
import { createHistoryRouter } from './alpha-history.js';
import { storeScanSnapshot } from '../calibration/snapshot-store.js';


function extractAlphaErrorDetails(error) {
  const stage = error?.stage || error?.step || 'unknown';
  const message = error?.cause?.message || error?.message || 'Unknown error';
  return { stage, message };
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
        try {
          const snapshotId = await storeScanSnapshot(projectName, report?.raw_data, report?.scores);
          console.log(`[alpha] Snapshot saved: #${snapshotId}`);
        } catch (err) {
          console.error('[alpha] Snapshot save failed:', err.message);
        }
        // Round 700 (AutoResearch batch): compute adaptive TTL based on freshly computed volatility
        const adaptedTtlMs = adaptiveTtlMs(mode, report?.volatility, report?.scores);
        if (adaptedTtlMs !== ttlMs) {
          console.log(`[alpha] Adaptive TTL for ${projectName}: ${ttlMs}ms → ${adaptedTtlMs}ms (regime: ${report?.volatility?.regime ?? 'unknown'})`);
        }
        return {
          ...report,
          cache: {
            ...(report.cache || {}),
            hit: false,
            key: cacheKey,
            ttl_ms: adaptedTtlMs,
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
    const asyncRefresh = req.query.async_refresh === 'true' || req.query.async_refresh === '1';
    // Round 73: force_refresh bypasses cache by using 0ms TTL (effectively cache-miss always)
    const ttlMs = forceRefresh ? 0 : (mode === 'quick' ? QUICK_TTL_MS : FULL_TTL_MS);
    const cacheKey = buildCacheKey(projectName, mode);

    // For full scans behind Cloudflare/tunnel, async refresh avoids 502 timeout:
    // return cached result immediately, trigger recomputation in background, then client can poll.
    if (mode === 'full' && forceRefresh && asyncRefresh) {
      const cached = cache.read(cacheKey, FULL_TTL_MS);
      if (cached) {
        if (!inFlight.has(cacheKey)) {
          void getOrCreateReport({ cacheKey, ttlMs: 0, projectName, exaService, mode }).catch((err) => {
            console.error(`[alpha:${mode}] async refresh failed for ${projectName}:`, err?.message || err);
          });
        }
        res.set('X-Refresh-Mode', 'async');
        res.set('X-Refresh-Started', 'true');
        return res.status(202).json({
          ...cached,
          refresh: {
            mode: 'async',
            started: true,
            cache_served: true,
          },
        });
      }
    }

    try {
      const response = await getOrCreateReport({ cacheKey, ttlMs, projectName, exaService, mode });
      // Round 72: Add cache status header for client-side debugging
      const cacheStatus = response?.cache?.hit ? 'HIT' : 'MISS';
      res.set('X-Cache-Status', cacheStatus);
      res.set('X-Cache-Age-Ms', String(response?.cache?.age_ms ?? 0));
      // Round 382 (AutoResearch): Add scan quality headers for API consumers
      const overallConf = response?.scores?.overall?.overall_confidence;
      if (overallConf != null) res.set('X-Overall-Confidence', String(overallConf));
      const verdict = response?.analysis?.verdict || response?.quick_analysis?.verdict;
      if (verdict) res.set('X-Verdict', verdict);
      const scanScore = response?.scores?.overall?.score;
      if (scanScore != null) res.set('X-Alpha-Score', String(scanScore));
      // Round 384 (AutoResearch batch): expose data completeness and category for API consumers
      const completeness = response?.scores?.overall?.completeness;
      if (completeness != null) res.set('X-Data-Completeness', String(completeness));
      const category = response?.scores?.overall?.category;
      if (category) res.set('X-Token-Category', category);
      return res.json(response);
    } catch (error) {
      const { stage, message } = extractAlphaErrorDetails(error);
      console.error(`[alpha:${mode}] analysis failed at stage=${stage}: ${message}`, {
        projectName,
        cacheKey,
        forceRefresh,
        stack: error?.stack,
        cause: error?.cause?.stack || error?.cause?.message || null,
      });
      // Round R22: Classify error type for better client handling
      const isTimeout = message.includes('timeout') || message.includes('AbortError') || message.includes('abort');
      const isRateLimit = message.includes('429') || message.includes('rate limit') || message.includes('Too Many');
      const statusCode = isRateLimit ? 429 : isTimeout ? 504 : 502;
      if (isRateLimit) res.set('Retry-After', '60');
      return res.status(statusCode).json({
        error: `Alpha analysis failed during ${stage}`,
        detail: message,
        error_type: isRateLimit ? 'rate_limited' : isTimeout ? 'timeout' : 'upstream_error',
        retry_after_seconds: isRateLimit ? 60 : isTimeout ? 10 : null,
      });
    }
  }

  router.get('/alpha', (req, res) => handleRequest(req, res, 'full'));
  router.get('/alpha/quick', (req, res) => handleRequest(req, res, 'quick'));

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

    const normalizedRaw = projects.map(normalizeProject);
    const invalidCount = normalizedRaw.filter((p) => !p).length;
    const normalized = [...new Set(normalizedRaw.filter(Boolean).map((p) => p.trim()))];
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
          // Round 19 (AutoResearch batch): include trend + volatility in batch output
          trend_reversal: r.trend_reversal ? { pattern: r.trend_reversal.pattern, confidence: r.trend_reversal.confidence } : null,
          volatility_regime: r.volatility?.regime ?? 'calm',
          critical_flags: (r.red_flags ?? []).filter((f) => f.severity === 'critical').length,
          strong_signals: (r.alpha_signals ?? []).filter((s) => s.strength === 'strong').length,
          // Round 21 (AutoResearch nightly): add liquidity health and news momentum
          liquidity_health: r.raw_data?.dex?.liquidity_health_score ?? null,
          news_momentum: r.raw_data?.social?.news_momentum ?? null,
          report_quality_grade: r.report_quality?.grade ?? null,
          scan_duration_ms: r.scan_duration_ms ?? null,
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
      unique_projects: normalized.length,
      duplicates_removed: projects.length - invalidCount - normalized.length,
      invalid_projects: invalidCount,
      generated_at: new Date().toISOString(),
    });
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
        // Round 60 (AutoResearch): watchlist_score — prioritization score for watchlist sorting
        // Balances: overall score, alpha signals, volatility risk, red flags
        const overallScore = scores.overall?.score ?? 5;
        const alphaSignals = r.alpha_signals ?? [];
        const redFlagCount = (r.red_flags ?? []).length;
        const criticalFlagCount = (r.red_flags ?? []).filter((f) => f.severity === 'critical').length;
        const volPenalty = r.volatility?.regime === 'extreme' ? 20 : r.volatility?.regime === 'high' ? 10 : 0;
        const watchlistScore = Math.round(
          (overallScore / 10) * 60 +                               // overall score (0-60)
          Math.min(alphaSignals.length * 5, 20) +                  // alpha signals (0-20)
          Math.max(0, 20 - redFlagCount * 4 - criticalFlagCount * 8) - // red flags penalty (0-20)
          volPenalty                                               // volatility penalty (0-20)
        );

        return {
          project: projectName,
          ok: true,
          verdict: r.verdict,
          overall_score: overallScore,
          watchlist_score: Math.max(0, Math.min(100, watchlistScore)),
          dimension_scores: dimScores,
          key_metrics: {
            price_fmt: r.key_metrics?.price_fmt,
            market_cap_fmt: r.key_metrics?.market_cap_fmt,
            volume_24h_fmt: r.key_metrics?.volume_24h_fmt,
          },
          red_flag_count: (r.red_flags ?? []).length,
          critical_flag_count: (r.red_flags ?? []).filter((f) => f.severity === 'critical').length,
          alpha_signal_count: alphaSignals.length,
          volatility_regime: r.volatility?.regime ?? 'calm',
          elevator_pitch: r.elevator_pitch ?? null,
          one_line_risk: r.elevator_pitch?.one_line_risk ?? null,
          cache_hit: r.cache?.hit ?? false,
        };
      }
      return { project: projectName, ok: false, error: result.reason?.message ?? 'Scan failed' };
    });

    // Round 60: Sort by watchlist_score descending (better prioritization than raw score)
    const sorted = [...watchlist].sort((a, b) => (b.watchlist_score ?? b.overall_score ?? -1) - (a.watchlist_score ?? a.overall_score ?? -1));

    return res.json({
      watchlist: sorted,
      count: sorted.length,
      generated_at: new Date().toISOString(),
    });
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

  // ── Round 15 (AutoResearch nightly): Server health endpoint for monitoring ──
  router.get('/alpha/health', (req, res) => {
    try {
      const db = signalsService.db;
      const totalScans = (() => { try { return db.prepare('SELECT COALESCE(count,0) as c FROM scan_counter WHERE id=1').get()?.c ?? 0; } catch { return 0; } })();
      const recentScans1h = (() => {
        try {
          const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          return db.prepare('SELECT COUNT(*) as c FROM scan_history WHERE scanned_at >= ?').get(cutoff)?.c ?? 0;
        } catch { return 0; }
      })();
      const cacheSize = (() => { try { return db.prepare('SELECT COUNT(*) as c FROM alpha_reports').get()?.c ?? 0; } catch { return 0; } })();
      return res.json({
        status: 'ok',
        uptime_seconds: Math.round(process.uptime()),
        total_scans: totalScans,
        scans_last_1h: recentScans1h,
        cache_entries: cacheSize,
        in_flight_requests: inFlight.size,
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ status: 'error', error: err.message });
    }
  });

  // ── Round R23: /alpha/trending — return CoinGecko trending coins with quick scores ──
  router.get('/alpha/trending', async (req, res) => {
    try {
      const trendingUrl = 'https://api.coingecko.com/api/v3/search/trending';
      const resp = await fetch(trendingUrl, { headers: { 'User-Agent': 'alpha-scanner/6.0.0' }, signal: AbortSignal.timeout(8000) });
      if (!resp.ok) throw new Error(`CoinGecko trending: HTTP ${resp.status}`);
      const data = await resp.json();
      const coins = (data?.coins || []).slice(0, 7).map((entry) => ({
        name: entry?.item?.name,
        symbol: entry?.item?.symbol,
        coin_id: entry?.item?.id,
        market_cap_rank: entry?.item?.market_cap_rank,
        thumb: entry?.item?.thumb,
        score: entry?.item?.score,
      })).filter((c) => c.name);
      return res.json({ trending: coins, count: coins.length, generated_at: new Date().toISOString() });
    } catch (err) {
      return res.status(502).json({ error: 'Failed to fetch trending: ' + err.message });
    }
  });

  // ── Mount history router on /alpha/* ──────────────────────────
  const historyRouter = createHistoryRouter({
    signalsService,
    cache,
    getOrCreateReport,
    exaService,
    FULL_TTL_MS,
    QUICK_TTL_MS,
    buildCacheKey,
    normalizeProject,
    safeParseJSON,
  });
  router.use('/alpha', historyRouter);

  return router;
}

export default createAlphaRouter;
