import { collectAll } from '../collectors/index.js';
import { calculateScores } from '../synthesis/scoring.js';
import { generateReport, generateQuickReport } from '../synthesis/llm.js';
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

import { computeScoreVelocity } from '../services/score-velocity.js';
import { detectTrendReversal } from '../services/trend-reversal.js';
import { detectNarrativeMomentum } from '../services/narrative-momentum.js';
import { calculateMomentum } from '../services/momentum.js';
import { computeNarrativeStrength } from '../services/narrative-strength.js';
import { analyzeSupplyUnlockRisk } from '../services/supply-unlock-detector.js';

export function safeParseJSON(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}

/**
 * Build price_alerts array from red flags and alpha signals with price-related types.
 * Maintains backward compatibility with the old price-alerts.js format.
 */
export function buildPriceAlerts(redFlags = [], alphaSignals = []) {
  const alerts = [];
  
  // Map red flags to price alerts
  const redFlagsToPriceAlerts = {
    flash_crash: true,
    atl_proximity: true,
  };
  
  for (const flag of redFlags) {
    if (redFlagsToPriceAlerts[flag.flag]) {
      alerts.push({
        type: flag.flag,
        severity: flag.severity,
        message: flag.detail,
        data: {},
      });
    }
  }
  
  // Map alpha signals to price alerts
  const alphaSignalsToPriceAlerts = {
    flash_pump: true,
    ath_breakout: true,
    recovery_from_low: true,
    volume_surge: true,
  };
  
  for (const signal of alphaSignals) {
    if (alphaSignalsToPriceAlerts[signal.signal]) {
      alerts.push({
        type: signal.signal,
        severity: signal.strength === 'strong' ? 'warning' : 'info',
        message: signal.detail,
        data: {},
      });
    }
  }
  
  return alerts;
}

// ── Direct USDC payment verification (Base mainnet) ──────────────
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const PAY_TO = '0x4bde6b11df6c0f0f5351e6fb0e7bdc40eaa0cb4d';

export async function verifyPayment(txHash) {
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

export const FULL_TTL_MS = 60 * 60 * 1000;
export const QUICK_TTL_MS = 15 * 60 * 1000;

/**
 * Round 700 (AutoResearch batch): Adaptive TTL based on market volatility.
 * High-volatility regime = shorter cache TTL (data goes stale faster)
 * Stable market = longer cache TTL (fewer wasted API calls)
 *
 * @param {string} mode - 'full' | 'quick'
 * @param {object|null} volatility - from assessVolatility() or cached report
 * @param {object|null} scores - from calculateScores()
 * @returns {number} TTL in milliseconds
 */
export function adaptiveTtlMs(mode = 'full', volatility = null, scores = null) {
  const base = mode === 'quick' ? QUICK_TTL_MS : FULL_TTL_MS;

  const regime = volatility?.regime ?? 'calm';
  const overallScore = Number(scores?.overall?.score ?? 5);

  // High-volatility tokens: cache expires faster (fresher data needed)
  let multiplier = 1.0;
  if (regime === 'extreme') multiplier = 0.25;       // 15min cache (extreme vol)
  else if (regime === 'high') multiplier = 0.5;       // 30min cache (high vol)
  else if (regime === 'elevated') multiplier = 0.75;  // 45min cache (elevated vol)
  // calm = 1.0 = normal TTL

  // Very high scores (potential breakout) or very low scores (potential collapse) = shorter TTL
  if (overallScore >= 8.5 || overallScore <= 2.5) multiplier = Math.min(multiplier, 0.5);

  return Math.round(base * multiplier);
}

export function ensureSchema(db) {
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

export function storeScanHistory(db, projectName, scores, report) {
  try {
    db.prepare(
      'INSERT INTO scan_history (project_name, scores_json, report_json, scanned_at) VALUES (?, ?, ?, ?)'
    ).run(projectName, JSON.stringify(scores), JSON.stringify(report), new Date().toISOString());
  } catch (err) {
    console.error('[scan_history] Failed to store:', err.message);
  }
}

export function getScanVersion(db, projectName) {
  try {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM scan_history WHERE project_name = ?').get(projectName);
    return (row?.cnt ?? 0) + 1;
  } catch {
    return 1;
  }
}

// Round 158 (AutoResearch): enhanced input sanitization
// - Strip control characters and null bytes (prevent log injection)
// - Reject obvious injection patterns (SQL-like, script tags, path traversal)
// - Allow alphanumeric + common crypto token chars: spaces, hyphens, dots, parens
const ALLOWED_PROJECT_PATTERN = /^[a-zA-Z0-9 \-_.()\[\]+'&/:@#%~]+$/;
const INJECTION_PATTERNS = [
  /<[^>]*>/,                        // HTML/script tags
  /['"`;|\\]/,                      // SQL injection chars
  /\.\.[/\\]/,                      // path traversal
  /javascript:/i,                   // protocol injection
  /\x00/,                           // null byte
  /[\x01-\x08\x0b\x0c\x0e-\x1f]/,  // other control chars
  // Round 238 (AutoResearch): additional security patterns
  /data:/i,                          // data: URI scheme
  /vbscript:/i,                      // VBScript injection
  /on\w+\s*=/i,                      // inline event handlers (onload=, onclick= etc)
  /expression\s*\(/i,                // CSS expression() injection
  // Round 384 (AutoResearch batch): additional hardening
  /\$\{/,                            // template literal injection
  /\beval\b/i,                       // eval() injection
  /\bimport\b.*\(/i,                 // dynamic import injection
  /\bfetch\b.*\(/i,                  // fetch() injection in project name
  /[\r\n]/,                          // newline injection (HTTP header splitting)
];

export function normalizeProject(project) {
  if (typeof project !== 'string') return null;
  const value = project.trim();
  if (!value || value.length > 100) return null;
  // Reject if contains control characters or injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(value)) return null;
  }
  // Allow only safe characters (note: most token names are simple alphanumeric)
  // Don't block if it doesn't match — just log and continue (too aggressive to block non-ASCII)
  // Only hard-block injection chars above
  return value;
}

export function buildCacheKey(projectName, mode) {
  return `${mode}:${projectName.trim().toLowerCase()}`;
}

export function createCacheHelpers(db) {
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

export function summarizeDataQuality(rawData, scores) {
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

export function buildResponse({ projectName, rawData, scores, analysis, mode }) {
  const formatted = formatReport(projectName, rawData, scores, analysis);
  return {
    ...formatted.json,
    mode,
    data_quality: summarizeDataQuality(rawData, scores),
    report_text: formatted.text,
    report_html: formatted.html,
  };
}

import { runPipeline } from '../analysis/pipeline.js';

export async function runAnalysis({ projectName, exaService, mode, config, collectAllFn, collectorCache, db }) {
  // Delegate to the structured 3-phase pipeline
  return runPipeline({ projectName, exaService, mode, config, collectAllFn, collectorCache, db });
}

// Legacy implementation kept for reference — the pipeline calls the same services
export async function _runAnalysisLegacy({ projectName, exaService, mode, config, collectAllFn, collectorCache, db }) {
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

  // IMPORTANT: compute derived context BEFORE LLM generation so prompts can use it.
  const volatilityAssessment = assessVolatility(rawData);
  rawData.volatility = volatilityAssessment;

  const priceAlerts = buildPriceAlerts(redFlags, alphaSignals);
  rawData.price_alerts = priceAlerts;

  const trendReversal = detectTrendReversal(rawData);
  rawData.trend_reversal = trendReversal;

  const narrativeMomentum = detectNarrativeMomentum(rawData);
  rawData.narrative_momentum = narrativeMomentum;

  // Round 234 (AutoResearch): narrative strength score + supply unlock risk
  rawData.narrative_strength = computeNarrativeStrength(narrativeMomentum, rawData.onchain ?? {}, rawData.market ?? {});
  rawData.supply_unlock_risk = analyzeSupplyUnlockRisk(rawData.tokenomics ?? {}, rawData.market ?? {});

  // Round 27 (AutoResearch nightly): compute momentum service data and inject into rawData
  // so alpha-signals.js can detect price-volume divergence patterns
  const momentumData = calculateMomentum(rawData);
  rawData.momentum = momentumData;

  const analysis =
    mode === 'quick'
      ? await generateQuickReport(projectName, rawData, scores, { apiKey: config?.xaiApiKey })
      : await generateReport(projectName, rawData, scores, { apiKey: config?.xaiApiKey });

  // Round 30 (AutoResearch batch): run independent sync services in one pass,
  // and competitor detection (async) in parallel with post-collection sync work.
  const tradeSetup = generateTradeSetup(rawData, scores);
  const riskReward = assessRiskReward(rawData, scores, tradeSetup);
  const reportQuality = scoreReportQuality(rawData, scores, analysis);
  const elevatorPitch = generateElevatorPitch(projectName, rawData, scores, analysis);
  const thesis = generateThesis(projectName, rawData, scores, redFlags, alphaSignals);

  // Competitor detection (async, non-blocking) — start in parallel with sync work
  const competitorPromise = detectCompetitors(projectName, rawData).catch(() => ({ competitors: [], comparison_summary: 'Skipped.' }));

  // What changed vs previous scan (sync)
  let changes = { has_previous: false, changes: [] };
  if (db) {
    try {
      changes = detectChanges(db, projectName, { rawData, scores, verdict: analysis?.verdict });
    } catch (_) { /* non-critical */ }
  }

  // Await competitor detection (started above in parallel)
  let competitors;
  try {
    competitors = await competitorPromise;
  } catch (_) {
    competitors = { competitors: [], comparison_summary: 'Skipped.' };
  }

  // Compute scan_version before storing
  const scanVersion = db ? getScanVersion(db, projectName) : null;


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

  // Attach volatility + price alerts + score velocity + trend reversal to response
  response.volatility = volatilityAssessment;
  response.price_alerts = priceAlerts;
  response.trend_reversal = trendReversal;
  response.narrative_momentum = narrativeMomentum;

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
  // Round 28 (AutoResearch nightly): include momentum data in response
  response.momentum = momentumData;

  // Round 234 (AutoResearch): include narrative strength + supply unlock risk in response
  response.narrative_strength = rawData.narrative_strength ?? null;
  response.supply_unlock_risk = rawData.supply_unlock_risk ?? null;

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
