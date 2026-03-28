/**
 * pipeline.js — Analysis Pipeline Architecture (Round 1)
 *
 * Orchestrates the 3-phase analysis pipeline:
 *   Phase 1: Data Collection (collectors → rawData)
 *   Phase 2: Enrichment (red flags, alpha signals, volatility, momentum, narrative, trend reversal)
 *   Phase 3: Synthesis (scoring, LLM report, thesis, trade setup, R:R, quality, competitors, elevator pitch)
 *
 * Each phase has clear input/output contracts and is independently testable.
 */

import { calculateScores, computeSparklineTrend, computeSignalStrengthIndex } from '../synthesis/scoring.js';
import { generateReport, generateQuickReport } from '../synthesis/llm.js';
import { getBenchmarkForCategory, compareToSector } from '../services/sector-benchmarks.js';
import { detectRedFlags, detectFeeRevenueDivergence } from '../services/red-flags.js';
import { detectAlphaSignals, detectRecentAthMomentum } from '../services/alpha-signals.js';
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

import { analyzeCrossDimensional } from './cross-dimensional.js';
import { calculateConviction } from './conviction.js';
import { analyzeTemporalDelta } from './temporal.js';
import { buildRiskMatrix } from './risk-matrix.js';
import { classifySector, getSectorWeights } from './sector-context.js';
import { buildPriceAlerts, getScanVersion, storeScanHistory, buildResponse } from '../routes/alpha-helpers.js';


function withPipelineStage(stage, error, context = {}) {
  const wrapped = new Error(error?.message || `Alpha pipeline failed during ${stage}`);
  wrapped.name = 'AlphaPipelineError';
  wrapped.stage = stage;
  wrapped.context = context;
  wrapped.cause = error;
  if (error?.stack) {
    wrapped.stack = `${wrapped.name}: ${wrapped.message}
[stage:${stage}]
${error.stack}`;
  }
  return wrapped;
}


/**
 * Phase 1: Data Collection
 * Runs all collectors and returns rawData.
 *
 * @param {string} projectName
 * @param {object} exaService
 * @param {object|null} collectorCache
 * @param {Function} collectAllFn
 * @returns {Promise<object>} rawData from all collectors
 */
export async function phaseCollect({ projectName, exaService, collectorCache, collectAllFn }) {
  const rawData = await collectAllFn(projectName, exaService, collectorCache);
  return rawData;
}

/**
 * Phase 2: Enrichment
 * Takes rawData + scores, enriches with derived signals and context.
 * Mutates rawData by injecting enrichment fields.
 *
 * @param {object} rawData - raw collector output
 * @param {object} scores - calculateScores() result
 * @returns {object} enrichment - structured enrichment results
 */
export function phaseEnrich(rawData, scores) {
  // Sector comparison
  const category = rawData?.onchain?.category || null;
  let sectorComparison = null;
  if (category) {
    try {
      // Note: getBenchmarkForCategory is async but we handle it in the pipeline runner
    } catch (_) { /* non-critical */ }
  }

  // Core enrichment — all sync
  const redFlagsBase = detectRedFlags(rawData, scores);
  // Round 381 (AutoResearch): inject fee-revenue divergence flag if detected
  const feeRevDivFlag = detectFeeRevenueDivergence(rawData);
  const redFlags = feeRevDivFlag
    ? [...redFlagsBase, feeRevDivFlag]
    : redFlagsBase;

  const alphaSignalsBase = detectAlphaSignals(rawData, scores);
  // Round 381 (AutoResearch): ATH momentum signal is now wired inside detectAlphaSignals
  // via the detectRecentAthMomentum call added in Round 15, so just use alphaSignalsBase directly
  const alphaSignals = alphaSignalsBase;
  const volatilityAssessment = assessVolatility(rawData);
  const priceAlerts = buildPriceAlerts(redFlags, alphaSignals);
  const trendReversal = detectTrendReversal(rawData);
  const narrativeMomentum = detectNarrativeMomentum(rawData);
  const momentumData = calculateMomentum(rawData);

  // Cross-dimensional analysis (Round 3)
  const crossDimensional = analyzeCrossDimensional(scores, rawData);

  // Risk matrix (Round 7)
  const riskMatrix = buildRiskMatrix(rawData, scores, redFlags);

  // Round 233 (AutoResearch nightly): compute P/TVL and inject as enrichment signal
  try {
    const mcap = rawData?.market?.market_cap;
    const tvl = rawData?.onchain?.tvl;
    if (mcap != null && tvl != null && tvl > 0) {
      const ptvl = mcap / tvl;
      rawData.ptvl_ratio = parseFloat(ptvl.toFixed(3));
      rawData.ptvl_label = ptvl < 0.5 ? 'deep_value' : ptvl < 1.0 ? 'undervalued' : ptvl < 2.0 ? 'fair_value' : ptvl < 5.0 ? 'premium' : 'highly_speculative';
    }
  } catch (_) { /* non-critical */ }

  // Round 155 (AutoResearch): compute sparkline trend quality and inject for LLM context
  try {
    const sparklineTrend = computeSparklineTrend(rawData?.market?.sparkline_7d);
    if (sparklineTrend?.trend_quality) {
      rawData.sparkline_trend = sparklineTrend;
    }
  } catch (_) { /* non-critical */ }

  // Round 383 (AutoResearch): Compute signal strength index — 0-100 composite of alpha vs red flags
  // Used by report-quality.js, scoring calibration, and verdict confidence assessment
  const signalStrengthIndex = computeSignalStrengthIndex(alphaSignals, redFlags);

  // Inject into rawData for LLM context
  rawData.red_flags = redFlags;
  rawData.alpha_signals = alphaSignals;
  rawData.signal_strength_index = signalStrengthIndex;
  rawData.volatility = volatilityAssessment;
  rawData.price_alerts = priceAlerts;
  rawData.trend_reversal = trendReversal;
  rawData.narrative_momentum = narrativeMomentum;
  rawData.momentum = momentumData;
  rawData.cross_dimensional = crossDimensional;
  rawData.risk_matrix = riskMatrix;

  return {
    redFlags,
    alphaSignals,
    volatilityAssessment,
    priceAlerts,
    trendReversal,
    narrativeMomentum,
    momentumData,
    crossDimensional,
    riskMatrix,
    sectorComparison,
  };
}

/**
 * Phase 2b: Async enrichment (sector comparison, temporal analysis)
 * Handles async operations that couldn't run in sync phaseEnrich.
 *
 * @param {object} rawData
 * @param {object} scores
 * @param {object} enrichment - from phaseEnrich
 * @param {object|null} db
 * @param {string} projectName
 * @returns {Promise<object>} asyncEnrichment
 */
export async function phaseEnrichAsync(rawData, scores, enrichment, db, projectName) {
  const category = rawData?.onchain?.category || null;
  let sectorComparison = null;

  if (category) {
    try {
      const benchmark = await getBenchmarkForCategory(category);
      if (benchmark) {
        sectorComparison = compareToSector(
          { tvl: rawData?.onchain?.tvl, market_cap: rawData?.market?.market_cap },
          benchmark,
        );
        if (sectorComparison) {
          rawData.sector_comparison = sectorComparison;
          rawData.sector_comparison._volume_24h = rawData?.market?.total_volume ?? null;
          rawData.sector_comparison._tvl = rawData?.onchain?.tvl ?? null;
        }
      }
    } catch (_) { /* non-critical */ }
  }

  // Sector context engine (Round 6)
  const sectorContext = classifySector(rawData);
  rawData.sector_context = sectorContext;

  // Temporal analysis (Round 4)
  let temporalDelta = null;
  if (db) {
    try {
      temporalDelta = analyzeTemporalDelta(db, projectName, rawData, scores);
      rawData.temporal_delta = temporalDelta;
    } catch (_) { /* non-critical */ }
  }

  // Conviction score (Round 5)
  const conviction = calculateConviction(rawData, scores, enrichment);
  rawData.conviction = conviction;

  enrichment.sectorComparison = sectorComparison;
  enrichment.sectorContext = sectorContext;
  enrichment.temporalDelta = temporalDelta;
  enrichment.conviction = conviction;

  return enrichment;
}

/**
 * Phase 3: Synthesis
 * Takes rawData + scores + enrichment, produces the final report.
 *
 * @param {object} params
 * @returns {Promise<object>} response
 */
export async function phaseSynthesize({
  projectName, rawData, scores, enrichment, mode, config, db,
}) {
  const {
    redFlags, alphaSignals, volatilityAssessment, priceAlerts,
    trendReversal, narrativeMomentum, momentumData, sectorComparison,
    crossDimensional, riskMatrix, conviction, temporalDelta, sectorContext,
  } = enrichment;

  // LLM report generation
  const analysis =
    mode === 'quick'
      ? await generateQuickReport(projectName, rawData, scores, { apiKey: config?.xaiApiKey })
      : await generateReport(projectName, rawData, scores, { apiKey: config?.xaiApiKey });

  // Sync synthesis services
  const tradeSetup = generateTradeSetup(rawData, scores);
  const riskReward = assessRiskReward(rawData, scores, tradeSetup);
  const reportQuality = scoreReportQuality(rawData, scores, analysis);
  const elevatorPitch = generateElevatorPitch(projectName, rawData, scores, analysis);
  const thesis = generateThesis(projectName, rawData, scores, redFlags, alphaSignals);

  // Async: competitor detection
  let competitors;
  try {
    competitors = await detectCompetitors(projectName, rawData)
      .catch(() => ({ competitors: [], comparison_summary: 'Skipped.' }));
  } catch (_) {
    competitors = { competitors: [], comparison_summary: 'Skipped.' };
  }

  // Change detection
  let changes = { has_previous: false, changes: [] };
  if (db) {
    try {
      changes = detectChanges(db, projectName, { rawData, scores, verdict: analysis?.verdict });
    } catch (_) { /* non-critical */ }
  }

  // TVL leadership signal
  if (competitors?.competitors?.length > 0 && rawData?.onchain?.tvl != null) {
    const projectTvl = rawData.onchain.tvl;
    const allCompetitorsTvl = competitors.competitors.map((c) => c.tvl ?? 0);
    const isTvlLeader = allCompetitorsTvl.every((t) => projectTvl > t);
    if (isTvlLeader) {
      rawData.alpha_signals = rawData.alpha_signals || [];
      if (!rawData.alpha_signals.some((s) => s.signal === 'tvl_sector_leader')) {
        rawData.alpha_signals.push({
          signal: 'tvl_sector_leader',
          strength: 'strong',
          detail: `${projectName} has the highest TVL in its sector among detected peers — category dominance.`,
        });
      }
    }
  }

  const scanVersion = db ? getScanVersion(db, projectName) : null;

  // Build base response
  const response = buildResponse({ projectName, rawData, scores, analysis, mode });

  // Attach all enrichment + synthesis outputs
  response.volatility = volatilityAssessment;
  response.price_alerts = priceAlerts;
  response.trend_reversal = trendReversal;
  response.narrative_momentum = narrativeMomentum;
  response.red_flags = redFlags;
  response.alpha_signals = rawData.alpha_signals; // includes TVL leader if added
  response.trade_setup = tradeSetup;
  response.risk_reward = riskReward;
  response.report_quality = reportQuality;
  response.competitors = competitors;
  response.elevator_pitch = elevatorPitch.pitch;
  response.thesis = thesis;
  response.changes = changes;
  response.momentum = momentumData;

  // New structured analysis outputs
  response.cross_dimensional = crossDimensional;
  response.risk_matrix = riskMatrix;
  response.conviction = conviction;
  response.sector_context = sectorContext;
  if (temporalDelta) response.temporal_delta = temporalDelta;

  if (sectorComparison) response.sector_comparison = sectorComparison;
  if (scanVersion !== null) response.scan_version = scanVersion;

  // Score velocity
  if (db) {
    try {
      response.score_velocity = computeScoreVelocity(db, projectName);
    } catch (_) { /* non-critical */ }
  }

  // Store in scan history
  if (db) {
    storeScanHistory(db, projectName, scores, response);
  }

  return response;
}

/**
 * Full pipeline runner — orchestrates all 3 phases.
 * Drop-in replacement for runAnalysis().
 */
export async function runPipeline({ projectName, exaService, mode, config, collectAllFn, collectorCache, db }) {
  // Round R30: Track total scan duration for performance telemetry
  const _pipelineStart = Date.now();

  let rawData;
  try {
    rawData = await phaseCollect({ projectName, exaService, collectorCache, collectAllFn });
  } catch (error) {
    throw withPipelineStage('collector', error, { projectName, mode });
  }

  let scores;
  try {
    scores = calculateScores(rawData);
  } catch (error) {
    throw withPipelineStage('scoring', error, { projectName, mode });
  }

  let enrichment;
  try {
    enrichment = phaseEnrich(rawData, scores);
  } catch (error) {
    throw withPipelineStage('enrichment', error, { projectName, mode });
  }

  try {
    await phaseEnrichAsync(rawData, scores, enrichment, db, projectName);
  } catch (error) {
    throw withPipelineStage('async-enrichment', error, { projectName, mode });
  }

  let result;
  try {
    result = await phaseSynthesize({
      projectName, rawData, scores, enrichment, mode, config, db,
    });
  } catch (error) {
    throw withPipelineStage('synthesis', error, { projectName, mode });
  }

  // Round R30: Attach scan_duration_ms to the result for telemetry
  if (result && typeof result === 'object') {
    result.scan_duration_ms = Date.now() - _pipelineStart;
  }

  // Round 700 (AutoResearch batch): Quick health index — 0-100 composite score for API consumers
  // Lets agents quickly compare projects without parsing all 7 dimensions
  if (result && scores) {
    try {
      const dims = ['market_strength', 'onchain_health', 'social_momentum', 'development', 'tokenomics_health', 'distribution', 'risk'];
      const dimVals = dims.map((d) => Number(scores?.[d]?.score ?? 5)).filter(Number.isFinite);
      if (dimVals.length > 0) {
        const avg = dimVals.reduce((a, b) => a + b, 0) / dimVals.length;
        result.health_index = Math.round(((avg - 1) / 9) * 100);
        result.health_label = result.health_index >= 70 ? 'healthy'
          : result.health_index >= 50 ? 'moderate'
          : result.health_index >= 30 ? 'weak'
          : 'critical';
      }
    } catch (_) { /* non-critical */ }
  }

  return result;
}

