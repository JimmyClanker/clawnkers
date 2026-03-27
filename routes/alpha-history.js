import express from 'express';
import { getDimensionDistribution } from '../services/percentile-store.js';

export function createHistoryRouter({ signalsService, cache, getOrCreateReport, exaService, FULL_TTL_MS, QUICK_TTL_MS, buildCacheKey, normalizeProject, safeParseJSON }) {
  const router = express.Router();

  // ── Scan history endpoint ──────────────────────────────────────
  router.get('/history', (req, res) => {
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
  router.get('/export', async (req, res) => {
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
      formatted_metrics: {
        price: report?.key_metrics?.price_fmt ?? null,
        market_cap: report?.key_metrics?.market_cap_fmt ?? null,
        tvl: report?.key_metrics?.tvl_fmt ?? null,
        volume_24h: report?.key_metrics?.volume_24h_fmt ?? null,
        overall_score: report?.key_metrics?.overall_score_fmt ?? null,
      },
      thesis_summary: report?.thesis ? {
        one_liner: report.thesis.one_liner ?? null,
        bull_case: report.thesis.bull_case ?? null,
        bear_case: report.thesis.bear_case ?? null,
        conviction_score: report.thesis.conviction_score ?? null,
      } : null,
      score_summary: ['market_strength','onchain_health','social_momentum','development','tokenomics_health','overall'].map(dim => {
        const val = report?.scores?.[dim];
        const score = typeof val === 'object' ? (val?.score ?? null) : (val ?? null);
        return { dimension: dim, score, score_fmt: score != null ? `${Number(score).toFixed(1)}/10` : 'n/a' };
      }),
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
      conviction: report?.conviction ?? null,
      composite_alpha_index: report?.composite_alpha_index ?? null,
      data_quality: report?.data_quality ?? null,
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
      // Round 406 (AutoResearch): tl_dr + risk_profile + narrative_strength in export
      tl_dr: (() => {
        const score = dimensionScores.overall;
        const verdict = report?.verdict ?? 'HOLD';
        const pitch = report?.elevator_pitch ?? report?.thesis?.one_liner ?? null;
        const base = `${projectName}: ${verdict} (${score?.toFixed(1) ?? '?'}/10)`;
        return pitch ? `${base} — ${pitch}` : base;
      })(),
      risk_profile: {
        risk_level: report?.red_flags_summary?.risk_level ?? (() => {
          const critical = (report?.red_flags ?? []).filter(f => f.severity === 'critical').length;
          const warnings = (report?.red_flags ?? []).filter(f => f.severity === 'warning').length;
          return critical >= 2 ? 'critical' : critical >= 1 ? 'high' : warnings >= 3 ? 'elevated' : warnings >= 1 ? 'moderate' : 'low';
        })(),
        critical_flags: (report?.red_flags ?? []).filter(f => f.severity === 'critical').length,
        circuit_breakers_active: report?.scores?.overall?.circuit_breakers?.capped ?? false,
        volatility_regime: report?.raw_data?.volatility?.regime ?? 'calm',
        supply_unlock_risk: report?.raw_data?.supply_unlock_risk?.risk_level ?? 'unknown',
      },
      narrative_strength: report?.raw_data?.narrative_strength ? {
        strength: report.raw_data.narrative_strength.strength,
        score: report.raw_data.narrative_strength.score,
        detail: report.raw_data.narrative_strength.detail,
      } : null,
      // Round 415 (AutoResearch): opportunity_snapshot + alpha_signals_top3 in export
      opportunity_snapshot: {
        verdict: report?.verdict ?? 'HOLD',
        score: (() => { const s = report?.scores?.overall?.score; return s != null ? parseFloat(Number(s).toFixed(1)) : null; })(),
        alpha_index: report?.composite_alpha_index ?? null,
        risk_level: (() => {
          const crit = (report?.red_flags ?? []).filter(f => f.severity === 'critical').length;
          const warns = (report?.red_flags ?? []).filter(f => f.severity === 'warning').length;
          return crit >= 2 ? 'critical' : crit >= 1 ? 'high' : warns >= 3 ? 'elevated' : warns >= 1 ? 'moderate' : 'low';
        })(),
        action_bias: (() => {
          const v = (report?.verdict ?? '').toUpperCase();
          if (v === 'STRONG BUY') return 'enter_large';
          if (v === 'BUY') return 'enter_moderate';
          if (v === 'HOLD') return 'watch';
          if (v === 'AVOID') return 'stay_out';
          if (v === 'STRONG AVOID') return 'exit_if_held';
          return 'watch';
        })(),
      },
      alpha_signals_top3: (report?.alpha_signals ?? [])
        .filter(s => s.strength === 'strong' || s.strength === 'moderate')
        .slice(0, 3)
        .map(s => ({ signal: s.signal, strength: s.strength, detail: s.detail ?? null })),
    };

    res.set('Content-Type', 'application/json');
    return res.json(exportPayload);
  });

  // ── Round 22: Scan statistics endpoint ────────────────────────
  router.get('/stats', (req, res) => {
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
  router.get('/trending', (req, res) => {
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
  router.get('/sparkline', (req, res) => {
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
  router.get('/digest', (req, res) => {
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

  // ── Round 30: Leaderboard endpoint ────────────────────────────
  router.get('/leaderboard', (req, res) => {
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

  // ── Round 20 (AutoResearch batch): Active signals endpoint — aggregate alpha signals ──
  router.get('/signals', (req, res) => {
    const windowHours = Math.min(Number(req.query.window_hours) || 48, 168);
    const minStrength = req.query.min_strength || 'moderate'; // 'weak'|'moderate'|'strong'
    const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
    const minStrengthVal = strengthOrder[minStrength] ?? 2;

    try {
      const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
      const rows = signalsService.db.prepare(`
        SELECT sh.project_name, sh.scanned_at, sh.report_json
        FROM scan_history sh
        INNER JOIN (
          SELECT project_name, MAX(scanned_at) AS latest
          FROM scan_history WHERE scanned_at >= ?
          GROUP BY project_name
        ) latest ON sh.project_name = latest.project_name AND sh.scanned_at = latest.latest
        ORDER BY sh.scanned_at DESC LIMIT 50
      `).all(cutoff);

      const allSignals = [];
      for (const row of rows) {
        const report = safeParseJSON(row.report_json) ?? {};
        const signals = Array.isArray(report.alpha_signals) ? report.alpha_signals : [];
        for (const sig of signals) {
          const sv = strengthOrder[sig.strength] ?? 1;
          if (sv >= minStrengthVal) {
            allSignals.push({
              project: row.project_name,
              scanned_at: row.scanned_at,
              signal: sig.signal,
              strength: sig.strength,
              detail: sig.detail,
              overall_score: report.scores?.overall?.score ?? null,
              verdict: report.verdict ?? null,
            });
          }
        }
      }

      // Sort: strong first, then by project score
      allSignals.sort((a, b) => {
        const sv = (strengthOrder[b.strength] ?? 0) - (strengthOrder[a.strength] ?? 0);
        if (sv !== 0) return sv;
        return (b.overall_score ?? 0) - (a.overall_score ?? 0);
      });

      return res.json({
        signals: allSignals.slice(0, 50),
        count: allSignals.length,
        window_hours: windowHours,
        min_strength: minStrength,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[alpha/signals]', err.message);
      return res.status(500).json({ error: 'Failed to aggregate signals' });
    }
  });

  // ── Round 76: Score distribution endpoint — population stats ─────────────
  router.get('/distribution', (req, res) => {
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

  return router;
}
