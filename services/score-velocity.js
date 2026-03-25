/**
 * score-velocity.js — Round 52 (AutoResearch)
 * Computes the velocity (rate of change) of the overall score over time.
 * Uses scan_history data to measure how quickly scores are improving/declining.
 *
 * High positive velocity = momentum building → weight BUY verdict more
 * High negative velocity = deteriorating → weight AVOID verdict more
 */

function safeN(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/**
 * Compute score velocity for a project.
 *
 * @param {object} db          - better-sqlite3 database instance
 * @param {string} projectName
 * @returns {{
 *   velocity: number|null,        // score change per day (positive = improving)
 *   direction: 'improving'|'stable'|'declining',
 *   current_score: number|null,
 *   prev_score: number|null,
 *   days_between: number|null,
 *   sample_size: number,
 *   note: string
 * }}
 */
export function computeScoreVelocity(db, projectName) {
  if (!db || !projectName) {
    return { velocity: null, direction: 'stable', current_score: null, prev_score: null, days_between: null, sample_size: 0, note: 'No db or project name provided.' };
  }

  try {
    // Get up to 5 most recent scans
    const rows = db.prepare(`
      SELECT scanned_at, scores_json
      FROM scan_history
      WHERE project_name = ?
      ORDER BY scanned_at DESC
      LIMIT 5
    `).all(projectName);

    if (rows.length < 2) {
      return {
        velocity: null,
        direction: 'stable',
        current_score: rows[0] ? safeN(JSON.parse(rows[0].scores_json ?? '{}')?.overall?.score) : null,
        prev_score: null,
        days_between: null,
        sample_size: rows.length,
        note: 'Insufficient history for velocity calculation (need ≥2 scans).',
      };
    }

    const current = rows[0];
    const previous = rows[rows.length - 1]; // Oldest of the set

    const currentScore = safeN(JSON.parse(current.scores_json ?? '{}')?.overall?.score);
    const prevScore = safeN(JSON.parse(previous.scores_json ?? '{}')?.overall?.score);

    if (currentScore === null || prevScore === null) {
      return { velocity: null, direction: 'stable', current_score: currentScore, prev_score: prevScore, days_between: null, sample_size: rows.length, note: 'Score data missing in history rows.' };
    }

    const msPerDay = 1000 * 60 * 60 * 24;
    const daysBetween = Math.max(0.1, (new Date(current.scanned_at).getTime() - new Date(previous.scanned_at).getTime()) / msPerDay);
    const velocity = (currentScore - prevScore) / daysBetween;

    let direction;
    if (velocity > 0.2) direction = 'improving';
    else if (velocity < -0.2) direction = 'declining';
    else direction = 'stable';

    return {
      velocity: parseFloat(velocity.toFixed(3)),
      direction,
      current_score: currentScore,
      prev_score: prevScore,
      days_between: parseFloat(daysBetween.toFixed(1)),
      sample_size: rows.length,
      note: `Score ${prevScore.toFixed(1)} → ${currentScore.toFixed(1)} over ${daysBetween.toFixed(1)} days (${velocity >= 0 ? '+' : ''}${velocity.toFixed(3)}/day).`,
    };
  } catch (err) {
    return { velocity: null, direction: 'stable', current_score: null, prev_score: null, days_between: null, sample_size: 0, note: `Error: ${err.message}` };
  }
}
