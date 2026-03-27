import { getCalibrationDb } from '../calibration/db.js';

/**
 * Analizza gli snapshot più recenti e genera segnali.
 * Progettato per essere chiamato periodicamente (ogni 1-6h).
 * @param {{ db?: import('better-sqlite3').Database }} [opts]
 * @returns {{ signals: Array, summary: { total: number, by_type: Record<string,number> } }}
 */
export function detectSignals({ db: injectedDb } = {}) {
  const db = injectedDb || getCalibrationDb();
  const signals = [];

  signals.push(...detectScoreMomentum(db));
  signals.push(...detectCategoryLeaderShift(db));
  signals.push(...detectBreakerAlerts(db));
  signals.push(...detectDivergence(db));
  // REGIME_SHIFT: placeholder — ritorna [] per ora
  signals.push(...detectRegimeShift(db));

  const saved = saveSignals(db, signals);

  return {
    signals: saved,
    summary: {
      total: saved.length,
      by_type: saved.reduce((acc, s) => {
        acc[s.signal_type] = (acc[s.signal_type] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

// ---------------------------------------------------------------------------
// SCORE_MOMENTUM
// ---------------------------------------------------------------------------

/**
 * Confronta lo score più recente di ogni token con quello di ~72h fa (range 60-84h).
 * Se |delta| > 1.0 → segnale SCORE_MOMENTUM.
 */
export function detectScoreMomentum(db) {
  // Per ogni token, ottieni (snapshot_recente, score_recente) e
  // (snapshot_più_vecchio_almeno_60h_fa, score_relativo)
  const rows = db.prepare(`
    SELECT
      tu.id            AS token_id,
      tu.name          AS token_name,
      tu.symbol        AS token_symbol,
      ts_recent.id     AS recent_snapshot_id,
      ts_recent.snapshot_at AS recent_at,
      sc_recent.overall_score AS current_score,
      ts_old.id        AS old_snapshot_id,
      ts_old.snapshot_at   AS old_at,
      sc_old.overall_score  AS prev_score,
      (sc_recent.overall_score - sc_old.overall_score) AS delta
    FROM token_universe tu

    -- snapshot più recente per ogni token
    JOIN token_snapshots ts_recent
      ON ts_recent.token_id = tu.id
      AND ts_recent.id = (
        SELECT id FROM token_snapshots
        WHERE token_id = tu.id
        ORDER BY snapshot_at DESC LIMIT 1
      )
    JOIN token_scores sc_recent ON sc_recent.snapshot_id = ts_recent.id

    -- snapshot più recente che è almeno 60h fa (tolleranza 60-84h)
    JOIN token_snapshots ts_old
      ON ts_old.token_id = tu.id
      AND ts_old.id = (
        SELECT id FROM token_snapshots
        WHERE token_id = tu.id
          AND datetime(snapshot_at) <= datetime(ts_recent.snapshot_at, '-60 hours')
          AND datetime(snapshot_at) >= datetime(ts_recent.snapshot_at, '-84 hours')
        ORDER BY snapshot_at DESC LIMIT 1
      )
    JOIN token_scores sc_old ON sc_old.snapshot_id = ts_old.id

    WHERE sc_recent.overall_score IS NOT NULL
      AND sc_old.overall_score IS NOT NULL
      AND ABS(sc_recent.overall_score - sc_old.overall_score) > 1.0
  `).all();

  // Helper: ottieni tutti gli snapshot recenti per trend consistency check
  const getRecentSnapshots = (tokenId, recentAt) => {
    return db.prepare(`
      SELECT sc.overall_score
      FROM token_snapshots ts
      JOIN token_scores sc ON sc.snapshot_id = ts.id
      WHERE ts.token_id = ?
        AND datetime(ts.snapshot_at) <= datetime(?)
        AND sc.overall_score IS NOT NULL
      ORDER BY ts.snapshot_at DESC
      LIMIT 5
    `).all(tokenId, recentAt);
  };

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  return rows.map(row => {
    const delta = row.delta;
    const absDelta = Math.abs(delta);
    const direction = delta > 0 ? 'improving' : 'declining';
    // Round 438: factor in normalized_delta (relative change) to catch large % swings on low base
    const normalizedDelta_raw = row.current_score !== 0 ? (delta / row.current_score) : 0;
    const relativeChangePct = Math.abs(normalizedDelta_raw) * 100;
    // Upgrade severity if relative change >30% regardless of absolute delta
    let severity = absDelta > 2.0 ? 'critical' : absDelta > 1.5 ? 'high' : 'medium';
    if (severity === 'medium' && relativeChangePct > 30) severity = 'high'; // large relative shift
    const tokenName = row.token_name || row.token_symbol || `token#${row.token_id}`;

    const msOld = new Date(row.old_at.replace(' ', 'T') + 'Z').getTime();
    const msRecent = new Date(row.recent_at.replace(' ', 'T') + 'Z').getTime();
    const hours = Math.round((msRecent - msOld) / (1000 * 60 * 60));
    const velocity = hours > 0 ? (delta / hours) : 0; // pts per hour
    const normalizedDelta = normalizedDelta_raw; // relative change (already computed above)

    // Trend consistency: score è sempre cresciuto/decresciuto negli ultimi N snapshot?
    const recentSnaps = getRecentSnapshots(row.token_id, row.recent_at);
    let trendConsistent = false;
    let deltaAcceleration = 0; // Rate of change of rate of change
    if (recentSnaps.length >= 3) {
      const scores = recentSnaps.map(s => s.overall_score);
      const allImproving = scores.every((s, i) => i === 0 || s >= scores[i - 1]);
      const allDeclining = scores.every((s, i) => i === 0 || s <= scores[i - 1]);
      trendConsistent = direction === 'improving' ? allImproving : allDeclining;

      // Round 459: delta_acceleration — if last 3 snapshots: is the rate increasing?
      // deltas[0] = most recent change, deltas[1] = prior change
      if (scores.length >= 3) {
        const d1 = scores[0] - scores[1]; // most recent window delta
        const d2 = scores[1] - scores[2]; // prior window delta
        deltaAcceleration = d1 - d2; // positive = accelerating, negative = decelerating
      }
    }

    const consistencyNote = trendConsistent ? ' [consistent trend]' : '';
    const accelerationNote = Math.abs(deltaAcceleration) > 0.2
      ? (deltaAcceleration > 0 ? ' [accelerating]' : ' [decelerating]')
      : '';

    // Round 431: velocity_tier label — fast/normal/slow momentum
    const velocityTier = Math.abs(velocity) > 0.05 ? 'fast' : Math.abs(velocity) > 0.02 ? 'normal' : 'slow';

    // Round 432: score_zone — which conviction zone did the token land in?
    const scoreZone = row.current_score >= 7.0 ? 'strong_buy'
      : row.current_score >= 5.5 ? 'watch'
      : row.current_score >= 4.0 ? 'neutral'
      : 'avoid';
    const prevScoreZone = row.prev_score >= 7.0 ? 'strong_buy'
      : row.prev_score >= 5.5 ? 'watch'
      : row.prev_score >= 4.0 ? 'neutral'
      : 'avoid';
    const crossedZone = scoreZone !== prevScoreZone;

    return {
      signal_type: 'SCORE_MOMENTUM',
      token_id: row.token_id,
      severity,
      title: `${tokenName}: score ${direction} ${absDelta.toFixed(1)} pts in 72h (velocity: ${velocity.toFixed(3)} pts/h, ${velocityTier})${crossedZone ? ` [zone: ${prevScoreZone}→${scoreZone}]` : ''}${consistencyNote}${accelerationNote}`,
      detail: `Score moved from ${row.prev_score.toFixed(1)}/10 (${prevScoreZone}) to ${row.current_score.toFixed(1)}/10 (${scoreZone}). ${direction === 'improving' ? 'Positive momentum' : 'Deterioration detected'}. Velocity: ${velocity.toFixed(3)} pts/h (${velocityTier}).${crossedZone ? ` Zone boundary crossed: ${prevScoreZone} → ${scoreZone}.` : ''}${trendConsistent ? ' Trend is consistent across recent snapshots.' : ''}${Math.abs(deltaAcceleration) > 0.2 ? ` Momentum ${deltaAcceleration > 0 ? 'accelerating' : 'decelerating'} (Δ²=${deltaAcceleration.toFixed(2)}).` : ''}`,
      data_json: JSON.stringify({
        current_score: row.current_score,
        prev_score: row.prev_score,
        delta,
        direction,
        hours,
        velocity,
        velocity_tier: velocityTier,
        normalized_delta: normalizedDelta,
        trend_consistent: trendConsistent,
        score_zone: scoreZone,
        prev_score_zone: prevScoreZone,
        crossed_zone: crossedZone,
        delta_acceleration: parseFloat(deltaAcceleration.toFixed(3)),
      }),
      expires_at: expiresAt,
    };
  });
}

// ---------------------------------------------------------------------------
// CATEGORY_LEADER_SHIFT
// ---------------------------------------------------------------------------

/**
 * Per ogni categoria, confronta il top 3 attuale con quello di ~7 giorni fa.
 * Se cambia → segnale CATEGORY_LEADER_SHIFT.
 */
export function detectCategoryLeaderShift(db) {
  // Top 3 corrente per categoria
  const currentRows = db.prepare(`
    SELECT
      sc.category,
      tu.id AS token_id,
      tu.name AS token_name,
      tu.symbol AS token_symbol,
      sc.overall_score
    FROM token_scores sc
    JOIN token_snapshots ts ON ts.id = sc.snapshot_id
    JOIN token_universe tu ON tu.id = ts.token_id
    WHERE sc.category IS NOT NULL
      AND sc.overall_score IS NOT NULL
      AND ts.id IN (
        SELECT id FROM token_snapshots
        WHERE token_id = tu.id
        ORDER BY snapshot_at DESC LIMIT 1
      )
    ORDER BY sc.category, sc.overall_score DESC
  `).all();

  // Top 3 di ~7 giorni fa (range 6-8 giorni)
  const oldRows = db.prepare(`
    SELECT
      sc.category,
      tu.id AS token_id,
      tu.name AS token_name,
      tu.symbol AS token_symbol,
      sc.overall_score,
      ts.snapshot_at
    FROM token_scores sc
    JOIN token_snapshots ts ON ts.id = sc.snapshot_id
    JOIN token_universe tu ON tu.id = ts.token_id
    WHERE sc.category IS NOT NULL
      AND sc.overall_score IS NOT NULL
      AND ts.id IN (
        SELECT id FROM token_snapshots
        WHERE token_id = tu.id
          AND datetime(snapshot_at) <= datetime('now', '-6 days')
          AND datetime(snapshot_at) >= datetime('now', '-8 days')
        ORDER BY snapshot_at DESC LIMIT 1
      )
    ORDER BY sc.category, sc.overall_score DESC
  `).all();

  // Raggruppa per categoria
  const groupBy = (rows, key) => rows.reduce((acc, r) => {
    if (!acc[r[key]]) acc[r[key]] = [];
    acc[r[key]].push(r);
    return acc;
  }, {});

  const currentByCategory = groupBy(currentRows, 'category');
  const oldByCategory = groupBy(oldRows, 'category');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const signals = [];

  for (const [category, rows] of Object.entries(currentByCategory)) {
    const oldRows2 = oldByCategory[category];
    if (!oldRows2 || oldRows2.length === 0) continue; // nessun dato storico

    const newTop3Ids = rows.slice(0, 3).map(r => r.token_id);
    const oldTop3Ids = oldRows2.slice(0, 3).map(r => r.token_id);

    // Verifica se il top 3 è cambiato
    const sameIds = newTop3Ids.length === oldTop3Ids.length &&
      newTop3Ids.every(id => oldTop3Ids.includes(id));
    if (sameIds) continue;

    const newTop3Names = rows.slice(0, 3).map(r => r.token_name || r.token_symbol || `#${r.token_id}`);
    const oldTop3Names = oldRows2.slice(0, 3).map(r => r.token_name || r.token_symbol || `#${r.token_id}`);

    const enteredIds = newTop3Ids.filter(id => !oldTop3Ids.includes(id));
    const exitedIds = oldTop3Ids.filter(id => !newTop3Ids.includes(id));

    const enteredNames = rows
      .filter(r => enteredIds.includes(r.token_id))
      .map(r => r.token_name || r.token_symbol || `#${r.token_id}`);
    const exitedNames = oldRows2
      .filter(r => exitedIds.includes(r.token_id))
      .map(r => r.token_name || r.token_symbol || `#${r.token_id}`);

    const newLeader = newTop3Names[0] || 'Unknown';
    const changeCount = enteredIds.length; // quanti nuovi entrati
    const severity = changeCount >= 3 ? 'critical' : changeCount === 2 ? 'high' : 'medium';

    const newLeaderScore = rows[0]?.overall_score ?? null;
    const oldLeaderScore = oldRows2[0]?.overall_score ?? null;
    const scoreGap = (newLeaderScore !== null && oldLeaderScore !== null) ? (newLeaderScore - oldLeaderScore) : null;

    // Round 433: category_momentum — is the overall category getting stronger or weaker?
    // Compare average score of current top3 vs old top3
    const newTop3AvgScore = rows.slice(0, 3).reduce((s, r) => s + (r.overall_score ?? 0), 0) / Math.min(3, rows.length);
    const oldTop3AvgScore = oldRows2.slice(0, 3).reduce((s, r) => s + (r.overall_score ?? 0), 0) / Math.min(3, oldRows2.length);
    const categoryMomentum = (newTop3AvgScore - oldTop3AvgScore) > 0.3 ? 'strengthening'
      : (newTop3AvgScore - oldTop3AvgScore) < -0.3 ? 'weakening' : 'stable';

    signals.push({
      signal_type: 'CATEGORY_LEADER_SHIFT',
      token_id: null,
      severity,
      title: `${category}: leadership change — ${newLeader} enters top 3 (${changeCount} new, category ${categoryMomentum})`,
      detail: `New top 3: ${newTop3Names.join(', ')}. Previous: ${oldTop3Names.join(', ')}. ${changeCount} token(s) changed.${scoreGap !== null ? ` Leader score gap: ${scoreGap > 0 ? '+' : ''}${scoreGap.toFixed(1)} pts.` : ''} Category avg score: ${newTop3AvgScore.toFixed(2)} vs ${oldTop3AvgScore.toFixed(2)} (${categoryMomentum}).`,
      data_json: JSON.stringify({
        category,
        new_top3: newTop3Names,
        old_top3: oldTop3Names,
        new_top3_ids: newTop3Ids,
        old_top3_ids: oldTop3Ids,
        entered: enteredNames,
        exited: exitedNames,
        change_count: changeCount,
        score_gap: scoreGap,
        category_momentum: categoryMomentum,
        new_avg_score: parseFloat(newTop3AvgScore.toFixed(3)),
        old_avg_score: parseFloat(oldTop3AvgScore.toFixed(3)),
      }),
      expires_at: expiresAt,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// BREAKER_ALERT
// ---------------------------------------------------------------------------

/**
 * Rileva attivazione/disattivazione di circuit breaker per ogni token.
 */
export function detectBreakerAlerts(db) {
  // Per ogni token con snapshot nelle ultime 24h, confronta il circuit_breakers_json
  // con lo snapshot precedente
  const recentSnapshots = db.prepare(`
    SELECT
      ts.id AS snapshot_id,
      ts.token_id,
      ts.snapshot_at,
      tu.name AS token_name,
      tu.symbol AS token_symbol,
      sc.circuit_breakers_json,
      -- snapshot precedente
      (
        SELECT id FROM token_snapshots
        WHERE token_id = ts.token_id
          AND datetime(snapshot_at) < datetime(ts.snapshot_at)
        ORDER BY snapshot_at DESC LIMIT 1
      ) AS prev_snapshot_id
    FROM token_snapshots ts
    JOIN token_universe tu ON tu.id = ts.token_id
    JOIN token_scores sc ON sc.snapshot_id = ts.id
    WHERE datetime(ts.snapshot_at) >= datetime('now', '-24 hours')
      AND ts.id IN (
        SELECT MAX(id) FROM token_snapshots
        WHERE datetime(snapshot_at) >= datetime('now', '-24 hours')
        GROUP BY token_id
      )
  `).all();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const signals = [];

  for (const snap of recentSnapshots) {
    if (!snap.prev_snapshot_id) continue;

    const prevScore = db.prepare(`
      SELECT circuit_breakers_json FROM token_scores WHERE snapshot_id = ?
    `).get(snap.prev_snapshot_id);

    if (!prevScore) continue;

    let currentBreakers = [];
    let prevBreakers = [];

    try {
      currentBreakers = snap.circuit_breakers_json ? JSON.parse(snap.circuit_breakers_json) : [];
      prevBreakers = prevScore.circuit_breakers_json ? JSON.parse(prevScore.circuit_breakers_json) : [];
    } catch {
      continue;
    }

    if (!Array.isArray(currentBreakers)) currentBreakers = [];
    if (!Array.isArray(prevBreakers)) prevBreakers = [];

    // Estrai type/id per confronto
    const getBreakerKey = b => b?.type || b?.id || JSON.stringify(b);
    const currentKeys = new Set(currentBreakers.map(getBreakerKey));
    const prevKeys = new Set(prevBreakers.map(getBreakerKey));

    const tokenName = snap.token_name || snap.token_symbol || `token#${snap.token_id}`;

    // Breaker attivati (presenti ora, non prima)
    const activatedBreakers = [];
    for (const breaker of currentBreakers) {
      const key = getBreakerKey(breaker);
      if (!prevKeys.has(key)) {
        activatedBreakers.push(breaker);
      }
    }

    if (activatedBreakers.length > 0) {
      const breakerCount = currentBreakers.length;
      
      // Check se qualche breaker è attivo da >48h (presente negli ultimi 3+ snapshot)
      const oldSnapshots = db.prepare(`
        SELECT ts.id, sc.circuit_breakers_json
        FROM token_snapshots ts
        JOIN token_scores sc ON sc.snapshot_id = ts.id
        WHERE ts.token_id = ?
          AND datetime(ts.snapshot_at) <= datetime(?)
        ORDER BY ts.snapshot_at DESC
        LIMIT 4
      `).all(snap.token_id, snap.snapshot_at);

      let longDurationBreaker = false;
      if (oldSnapshots.length >= 3) {
        const currentKeys = new Set(currentBreakers.map(getBreakerKey));
        let persistentCount = 0;
        for (const oldSnap of oldSnapshots.slice(1)) {
          try {
            const oldB = oldSnap.circuit_breakers_json ? JSON.parse(oldSnap.circuit_breakers_json) : [];
            const oldKeys = new Set(oldB.map(getBreakerKey));
            const anyPersistent = [...currentKeys].some(k => oldKeys.has(k));
            if (anyPersistent) persistentCount++;
          } catch {}
        }
        longDurationBreaker = persistentCount >= 2; // presente in almeno 2 snapshot precedenti
      }

      const severity = longDurationBreaker ? 'critical' : (breakerCount >= 3 ? 'critical' : 'high');
      const firstBreaker = activatedBreakers[0];
      const breakerType = firstBreaker?.type || firstBreaker?.id || 'unknown';
      const cap = firstBreaker?.cap ?? firstBreaker?.score_cap ?? null;
      const reason = firstBreaker?.reason || firstBreaker?.detail || breakerType;
      const durationNote = longDurationBreaker ? ' [active >48h]' : '';

      // Round 436: breaker_risk_score — composite 1-10 risk score for alert prioritisation
      // Higher score = more urgent to act on
      // Components: severity (4 pts max) + breaker_count (3 pts max) + duration (3 pts max)
      const severityPts = longDurationBreaker ? 4 : severity === 'critical' ? 3 : 2;
      const countPts = Math.min(3, breakerCount);
      const durationPts = longDurationBreaker ? 3 : 0;
      const breakerRiskScore = Math.min(10, severityPts + countPts + durationPts);

      signals.push({
        signal_type: 'BREAKER_ALERT',
        token_id: snap.token_id,
        severity,
        title: `${tokenName}: circuit breaker ACTIVATED — ${breakerType} (${breakerCount} active, risk: ${breakerRiskScore}/10)${durationNote}`,
        detail: `${reason}. Score cap: ${cap != null ? cap + '/10' : 'n/a'}. Total breakers: ${breakerCount}. Risk score: ${breakerRiskScore}/10.${longDurationBreaker ? ' Breaker active for >48h.' : ''}`,
        data_json: JSON.stringify({ 
          breaker_type: breakerType, 
          activated: true, 
          cap, 
          reason, 
          breaker_count: breakerCount,
          long_duration: longDurationBreaker,
          all_breakers: currentBreakers.map(b => b?.type || b?.id || 'unknown'),
          breaker_risk_score: breakerRiskScore,
        }),
        expires_at: expiresAt,
      });
    }

    // Breaker disattivati (presenti prima, non ora)
    for (const breaker of prevBreakers) {
      const key = getBreakerKey(breaker);
      if (!currentKeys.has(key)) {
        const breakerType = breaker?.type || breaker?.id || 'unknown';
        const cap = breaker?.cap ?? breaker?.score_cap ?? null;
        const reason = breaker?.reason || breaker?.detail || breakerType;
        signals.push({
          signal_type: 'BREAKER_ALERT',
          token_id: snap.token_id,
          severity: 'low',
          title: `${tokenName}: circuit breaker cleared — ${breakerType}`,
          detail: `${reason}. Score cap: ${cap != null ? cap + '/10' : 'n/a'}.`,
          data_json: JSON.stringify({ breaker_type: breakerType, activated: false, cap, reason }),
          expires_at: expiresAt,
        });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// DIVERGENCE
// ---------------------------------------------------------------------------

/**
 * Rileva divergenza sentiment-price:
 * - score >= 6.5 + prezzo sceso > 15% in 7d → positive_divergence (opportunità)
 * - score <= 4.5 + prezzo salito > 15% in 7d → negative_divergence (trappola)
 * Severity: high se score estremo (≥7.0 o ≤4.0), medium se moderato (6.5-7.0 o 4.0-4.5).
 */
export function detectDivergence(db) {
  const rows = db.prepare(`
    SELECT
      tu.id AS token_id,
      tu.name AS token_name,
      tu.symbol AS token_symbol,
      ts.price_change_7d,
      ts.volume_24h,
      ts.market_cap,
      sc.overall_score,
      ts.snapshot_at
    FROM token_snapshots ts
    JOIN token_universe tu ON tu.id = ts.token_id
    JOIN token_scores sc ON sc.snapshot_id = ts.id
    WHERE ts.id IN (
      SELECT MAX(id) FROM token_snapshots GROUP BY token_id
    )
      AND sc.overall_score IS NOT NULL
      AND ts.price_change_7d IS NOT NULL
      AND (
        (sc.overall_score >= 6.5 AND ts.price_change_7d < -15.0)
        OR
        (sc.overall_score <= 4.5 AND ts.price_change_7d > 15.0)
      )
  `).all();

  // Round 456: persistence check — check if this token showed same divergence in prior snapshot
  const getDivergencePersistence = db.prepare(`
    SELECT sc.overall_score, ts.price_change_7d, ts.snapshot_at
    FROM token_snapshots ts
    JOIN token_scores sc ON sc.snapshot_id = ts.id
    WHERE ts.token_id = ?
      AND datetime(ts.snapshot_at) < datetime(?)
    ORDER BY ts.snapshot_at DESC
    LIMIT 3
  `);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  return rows.map(row => {
    const isPositive = row.overall_score >= 6.5 && row.price_change_7d < -15.0;
    const divergenceType = isPositive ? 'positive_divergence' : 'negative_divergence';
    const tokenName = row.token_name || row.token_symbol || `token#${row.token_id}`;
    const priceDirection = row.price_change_7d < 0 ? `down ${Math.abs(row.price_change_7d).toFixed(1)}%` : `up ${row.price_change_7d.toFixed(1)}%`;
    const scoreImplication = isPositive ? 'strong fundamentals' : 'weak fundamentals';
    const opportunityOrTrap = isPositive ? 'accumulation opportunity' : 'potential value trap';

    // Volume quality check: mcap e volume devono essere presenti per severity upgrade
    const volumeToMcap = (row.volume_24h && row.market_cap && row.market_cap > 0) 
      ? (row.volume_24h / row.market_cap) 
      : 0;
    const lowVolume = volumeToMcap < 0.05; // < 5% daily turnover = thin

    // Severity: high se score estremo + volume OK, medium se moderato o low volume
    const extremeScore = isPositive ? row.overall_score >= 7.0 : row.overall_score <= 4.0;
    let severity = extremeScore ? 'high' : 'medium';
    if (lowVolume && severity === 'high') severity = 'medium'; // downgrade se volume thin

    const volumeNote = lowVolume ? ' [low volume]' : '';

    // Round 456: divergence persistence — was divergence present in prior snapshots?
    let divergencePersistentSnapshots = 0;
    try {
      const priorSnaps = getDivergencePersistence.all(row.token_id, row.snapshot_at);
      for (const p of priorSnaps) {
        if (p.overall_score == null || p.price_change_7d == null) continue;
        const isPriorPos = p.overall_score >= 6.5 && p.price_change_7d < -15;
        const isPriorNeg = p.overall_score <= 4.5 && p.price_change_7d > 15;
        if ((isPositive && isPriorPos) || (!isPositive && isPriorNeg)) divergencePersistentSnapshots++;
      }
    } catch {}
    const isPersistent = divergencePersistentSnapshots >= 2;
    // Upgrade severity if persistent
    if (isPersistent && severity === 'medium') severity = 'high';

    // Round 434: divergence_magnitude — combined score×|price_delta| for ranking signal strength
    // Positive divergence: score × |negative_price_change| = how strong the buy-the-dip signal is
    // Negative divergence: (10 - score) × positive_price_change = how strong the sell signal is
    const divergenceMagnitude = isPositive
      ? parseFloat((row.overall_score * Math.abs(row.price_change_7d) / 10).toFixed(3))
      : parseFloat(((10 - row.overall_score) * Math.abs(row.price_change_7d) / 10).toFixed(3));
    const magnitudeLabel = divergenceMagnitude > 15 ? 'extreme' : divergenceMagnitude > 8 ? 'strong' : 'moderate';

    // Round 437: volume_confirmation — positive divergence with high volume is a stronger buy signal
    // High volume during a price dip means real sellers are being absorbed (accumulation)
    // High volume during a price pump with weak score = distribution (warning stronger)
    const volumeConfirmed = !lowVolume && (
      (isPositive && volumeToMcap > 0.15) ||  // positive: high vol dip = accumulation
      (!isPositive && volumeToMcap > 0.20)     // negative: high vol pump = pump-and-dump risk
    );
    const volumeConfirmNote = volumeConfirmed
      ? isPositive ? ' High volume confirms accumulation opportunity.' : ' High volume confirms distribution risk.'
      : '';

    return {
      signal_type: 'DIVERGENCE',
      token_id: row.token_id,
      severity,
      title: `${tokenName}: ${divergenceType} — score ${row.overall_score.toFixed(1)}/10 but price ${priceDirection}${volumeNote} [magnitude: ${magnitudeLabel}]`,
      detail: `Algorithmic score ${row.overall_score.toFixed(1)}/10 suggests ${scoreImplication}, but price has moved ${priceDirection} in 7d. Potential ${opportunityOrTrap}. Divergence magnitude: ${divergenceMagnitude} (${magnitudeLabel}).${isPersistent ? ` Divergence persistent across ${divergencePersistentSnapshots}+ snapshots — signal is sustained, not noise.` : ''}${volumeConfirmNote}${lowVolume ? ' Low volume (<5% daily turnover) — signal quality reduced.' : ''}`,
      data_json: JSON.stringify({
        score: row.overall_score,
        price_change_7d: row.price_change_7d,
        divergence_type: divergenceType,
        extreme_score: extremeScore,
        volume_to_mcap: volumeToMcap,
        low_volume: lowVolume,
        divergence_magnitude: divergenceMagnitude,
        magnitude_label: magnitudeLabel,
        volume_confirmed: volumeConfirmed,
        persistent_snapshots: divergencePersistentSnapshots,
        is_persistent: isPersistent,
      }),
      expires_at: expiresAt,
    };
  });
}

// ---------------------------------------------------------------------------
// REGIME_SHIFT
// ---------------------------------------------------------------------------

/**
 * Round 435: Detect market regime shifts using BTC price + dominance stored in snapshots.
 *
 * Strategy: compare median btc_price + median overall_score distribution across snapshots
 * - If BTC price dropped >15% in 7d AND avg score declined → bear regime entering
 * - If BTC price rose >15% in 7d AND avg score improving → bull regime entering
 * - If avg score dispersion increased → rotation/uncertainty regime
 *
 * Uses the token_snapshots.btc_price column (populated by batch scanner).
 * Falls back gracefully if no btc_price data available.
 */
export function detectRegimeShift(db) {
  // Need at least 2 time points: current (last 24h) and ~7d ago
  const recentRows = db.prepare(`
    SELECT ts.btc_price, sc.overall_score
    FROM token_snapshots ts
    JOIN token_scores sc ON sc.snapshot_id = ts.id
    WHERE datetime(ts.snapshot_at) >= datetime('now', '-24 hours')
      AND ts.btc_price IS NOT NULL
      AND sc.overall_score IS NOT NULL
  `).all();

  const oldRows = db.prepare(`
    SELECT ts.btc_price, sc.overall_score
    FROM token_snapshots ts
    JOIN token_scores sc ON sc.snapshot_id = ts.id
    WHERE datetime(ts.snapshot_at) <= datetime('now', '-6 days')
      AND datetime(ts.snapshot_at) >= datetime('now', '-8 days')
      AND ts.btc_price IS NOT NULL
      AND sc.overall_score IS NOT NULL
  `).all();

  // Need at least 3 data points in each window for meaningful stats
  if (recentRows.length < 3 || oldRows.length < 3) return [];

  const median = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const stddev = (arr, mean) => Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length);

  const recentBtcPrices = recentRows.map(r => r.btc_price);
  const oldBtcPrices = oldRows.map(r => r.btc_price);
  const recentScores = recentRows.map(r => r.overall_score);
  const oldScores = oldRows.map(r => r.overall_score);

  const recentBtcMedian = median(recentBtcPrices);
  const oldBtcMedian = median(oldBtcPrices);
  const btcChangePct = oldBtcMedian > 0 ? ((recentBtcMedian - oldBtcMedian) / oldBtcMedian) * 100 : 0;

  const recentAvgScore = avg(recentScores);
  const oldAvgScore = avg(oldScores);
  const scoreDelta = recentAvgScore - oldAvgScore;

  // Score dispersion: high stddev = rotation/uncertainty
  const recentMean = recentAvgScore;
  const recentStddev = stddev(recentScores, recentMean);
  const oldStddev = stddev(oldScores, oldAvgScore);
  const dispersionChange = recentStddev - oldStddev;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const signals = [];

  // Bear regime entering: BTC down >10% AND portfolio avg score declining
  if (btcChangePct < -10 && scoreDelta < -0.3) {
    const severity = btcChangePct < -20 && scoreDelta < -0.8 ? 'critical' : 'high';
    signals.push({
      signal_type: 'REGIME_SHIFT',
      token_id: null,
      severity,
      title: `REGIME SHIFT: Bear market signal — BTC ${btcChangePct.toFixed(1)}% / avg score ${scoreDelta > 0 ? '+' : ''}${scoreDelta.toFixed(2)}`,
      detail: `BTC fell ${Math.abs(btcChangePct).toFixed(1)}% over 7d (median: $${recentBtcMedian.toFixed(0)} vs $${oldBtcMedian.toFixed(0)}). Portfolio avg score declined ${Math.abs(scoreDelta).toFixed(2)} pts (${oldAvgScore.toFixed(2)} → ${recentAvgScore.toFixed(2)}). Risk-off regime signals: reduce exposure, tighten stops.`,
      data_json: JSON.stringify({
        regime: 'bear_entering',
        btc_change_pct: parseFloat(btcChangePct.toFixed(2)),
        score_delta: parseFloat(scoreDelta.toFixed(3)),
        recent_btc_median: parseFloat(recentBtcMedian.toFixed(2)),
        old_btc_median: parseFloat(oldBtcMedian.toFixed(2)),
        recent_avg_score: parseFloat(recentAvgScore.toFixed(3)),
        old_avg_score: parseFloat(oldAvgScore.toFixed(3)),
        dispersion_change: parseFloat(dispersionChange.toFixed(3)),
        sample_size_recent: recentRows.length,
        sample_size_old: oldRows.length,
      }),
      expires_at: expiresAt,
    });
  }

  // Bull regime entering: BTC up >10% AND portfolio avg score improving
  if (btcChangePct > 10 && scoreDelta > 0.3) {
    const severity = btcChangePct > 25 && scoreDelta > 0.8 ? 'critical' : 'high';
    signals.push({
      signal_type: 'REGIME_SHIFT',
      token_id: null,
      severity,
      title: `REGIME SHIFT: Bull market signal — BTC +${btcChangePct.toFixed(1)}% / avg score +${scoreDelta.toFixed(2)}`,
      detail: `BTC rose ${btcChangePct.toFixed(1)}% over 7d (median: $${recentBtcMedian.toFixed(0)} vs $${oldBtcMedian.toFixed(0)}). Portfolio avg score improved ${scoreDelta.toFixed(2)} pts (${oldAvgScore.toFixed(2)} → ${recentAvgScore.toFixed(2)}). Risk-on regime: increase conviction positions, extend TP targets.`,
      data_json: JSON.stringify({
        regime: 'bull_entering',
        btc_change_pct: parseFloat(btcChangePct.toFixed(2)),
        score_delta: parseFloat(scoreDelta.toFixed(3)),
        recent_btc_median: parseFloat(recentBtcMedian.toFixed(2)),
        old_btc_median: parseFloat(oldBtcMedian.toFixed(2)),
        recent_avg_score: parseFloat(recentAvgScore.toFixed(3)),
        old_avg_score: parseFloat(oldAvgScore.toFixed(3)),
        dispersion_change: parseFloat(dispersionChange.toFixed(3)),
        sample_size_recent: recentRows.length,
        sample_size_old: oldRows.length,
      }),
      expires_at: expiresAt,
    });
  }

  // Rotation regime: dispersion increased significantly → narrative rotation in progress
  if (Math.abs(dispersionChange) > 0.5 && Math.abs(btcChangePct) < 10) {
    const direction = dispersionChange > 0 ? 'increasing' : 'decreasing';
    signals.push({
      signal_type: 'REGIME_SHIFT',
      token_id: null,
      severity: 'medium',
      title: `REGIME SHIFT: Score dispersion ${direction} — rotation signal (BTC flat, divergence ${dispersionChange > 0 ? '+' : ''}${dispersionChange.toFixed(2)})`,
      detail: `Score standard deviation ${dispersionChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(dispersionChange).toFixed(2)} pts while BTC changed only ${btcChangePct.toFixed(1)}%. ${dispersionChange > 0 ? 'Winners and losers diverging — rotation between sectors underway.' : 'Scores converging — market consensus forming.'}`,
      data_json: JSON.stringify({
        regime: dispersionChange > 0 ? 'rotation' : 'convergence',
        btc_change_pct: parseFloat(btcChangePct.toFixed(2)),
        score_delta: parseFloat(scoreDelta.toFixed(3)),
        dispersion_change: parseFloat(dispersionChange.toFixed(3)),
        recent_stddev: parseFloat(recentStddev.toFixed(3)),
        old_stddev: parseFloat(oldStddev.toFixed(3)),
        sample_size_recent: recentRows.length,
        sample_size_old: oldRows.length,
      }),
      expires_at: expiresAt,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// SAVE SIGNALS (con dedup)
// ---------------------------------------------------------------------------

/**
 * Salva segnali nel DB con deduplicazione:
 * Non salva se esiste già un segnale non scaduto con stesso signal_type + token_id.
 * @returns {Array} segnali salvati con id
 */
export function saveSignals(db, signals) {
  if (!signals.length) return [];

  const checkExisting = db.prepare(`
    SELECT id FROM oracle_signals
    WHERE signal_type = ?
      AND (token_id IS ? OR (token_id IS NULL AND ? IS NULL))
      AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    LIMIT 1
  `);

  const insertSignal = db.prepare(`
    INSERT INTO oracle_signals (signal_type, token_id, severity, title, detail, data_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const saved = [];

  for (const signal of signals) {
    const tokenIdForCheck = signal.token_id ?? null;
    const existing = checkExisting.get(signal.signal_type, tokenIdForCheck, tokenIdForCheck);
    if (existing) continue; // dedup

    const result = insertSignal.run(
      signal.signal_type,
      signal.token_id ?? null,
      signal.severity ?? null,
      signal.title ?? null,
      signal.detail ?? null,
      signal.data_json ?? null,
      signal.expires_at ?? null,
    );
    saved.push({
      ...signal,
      id: Number(result.lastInsertRowid),
      generated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
  }

  return saved;
}
