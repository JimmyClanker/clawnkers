/**
 * price-alerts.js — Round 47 (AutoResearch)
 * Detects notable price action events from market and DEX data.
 * Returns structured alert objects suitable for notifications/display.
 *
 * No external API calls — uses data already present in rawData.
 */

function safeN(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

const ALERT_TYPES = {
  BREAKOUT:       'price_breakout',
  BREAKDOWN:      'price_breakdown',
  FLASH_PUMP:     'flash_pump',
  FLASH_CRASH:    'flash_crash',
  ATH_PROXIMITY:  'ath_proximity',
  ATL_PROXIMITY:  'atl_proximity',
  RECOVERY:       'recovery_from_low',
  VOLUME_SURGE:   'volume_surge',
};

/**
 * Detect notable price action events.
 *
 * @param {object} rawData - raw collector output
 * @returns {Array<{type: string, severity: 'critical'|'warning'|'info', message: string, data: object}>}
 */
export function detectPriceAlerts(rawData = {}) {
  const alerts = [];
  const market = rawData.market ?? {};
  const dex    = rawData.dex   ?? {};

  const price   = safeN(market.current_price ?? market.price);
  const ath     = safeN(market.ath);
  const atl     = safeN(market.atl);
  const c1h     = safeN(market.price_change_pct_1h);
  const c24h    = safeN(market.price_change_pct_24h);
  const c7d     = safeN(market.price_change_pct_7d);
  const c30d    = safeN(market.price_change_pct_30d);
  const volume  = safeN(market.total_volume);
  const mcap    = safeN(market.market_cap);
  const athDist = safeN(market.ath_distance_pct);
  const atlDist = safeN(market.atl_distance_pct);

  // Flash pump: 1h > +15%
  if (c1h !== null && c1h >= 15) {
    alerts.push({
      type: ALERT_TYPES.FLASH_PUMP,
      severity: c1h >= 30 ? 'critical' : 'warning',
      message: `Flash pump detected: +${c1h.toFixed(1)}% in 1h. Potential FOMO trap — wait for consolidation before entering.`,
      data: { change_1h: c1h, price },
    });
  }

  // Flash crash: 1h < -15%
  if (c1h !== null && c1h <= -15) {
    alerts.push({
      type: ALERT_TYPES.FLASH_CRASH,
      severity: c1h <= -30 ? 'critical' : 'warning',
      message: `Flash crash: ${c1h.toFixed(1)}% in 1h. Possible forced selling, exploit, or panic — verify cause before buying dip.`,
      data: { change_1h: c1h, price },
    });
  }

  // ATH proximity (within 5%)
  if (athDist !== null && athDist >= -5 && athDist < 0) {
    alerts.push({
      type: ALERT_TYPES.ATH_PROXIMITY,
      severity: 'info',
      message: `Price is ${Math.abs(athDist).toFixed(1)}% below ATH ($${ath?.toFixed ? ath.toFixed(4) : ath}) — potential breakout zone, but also resistance.`,
      data: { ath_distance_pct: athDist, ath, price },
    });
  }

  // ATH breakout: price at or above ATH
  if (athDist !== null && athDist >= 0) {
    alerts.push({
      type: ALERT_TYPES.BREAKOUT,
      severity: 'info',
      message: `Price is at/above ATH ($${ath?.toFixed ? ath.toFixed(4) : ath}) — confirmed breakout into price discovery territory.`,
      data: { ath_distance_pct: athDist, ath, price },
    });
  }

  // ATL proximity (within 10% above ATL)
  if (atlDist !== null && atlDist <= 10 && atlDist >= 0) {
    alerts.push({
      type: ALERT_TYPES.ATL_PROXIMITY,
      severity: atlDist <= 3 ? 'critical' : 'warning',
      message: `Price is only ${atlDist.toFixed(1)}% above ATL ($${atl?.toFixed ? atl.toFixed(6) : atl}) — extreme downside risk, near capitulation zone.`,
      data: { atl_distance_pct: atlDist, atl, price },
    });
  }

  // Recovery from prolonged downtrend: 7d positive after 30d negative
  if (c7d !== null && c30d !== null && c7d >= 10 && c30d <= -20) {
    alerts.push({
      type: ALERT_TYPES.RECOVERY,
      severity: 'info',
      message: `Recovery signal: +${c7d.toFixed(1)}% this week despite ${c30d.toFixed(1)}% monthly drawdown — potential trend reversal forming.`,
      data: { change_7d: c7d, change_30d: c30d },
    });
  }

  // Volume surge: volume > 50% of market cap
  if (volume !== null && mcap !== null && mcap > 0) {
    const volRatio = volume / mcap;
    if (volRatio >= 0.5) {
      alerts.push({
        type: ALERT_TYPES.VOLUME_SURGE,
        severity: volRatio >= 1.0 ? 'warning' : 'info',
        message: `Extraordinary volume: $${(volume / 1e6).toFixed(1)}M (${(volRatio * 100).toFixed(0)}% of market cap in 24h) — unusually high trading interest.`,
        data: { volume, market_cap: mcap, vol_mcap_ratio: volRatio },
      });
    }
  }

  return alerts;
}
