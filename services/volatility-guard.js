/**
 * volatility-guard.js — Round 35 (AutoResearch)
 * Detects when market volatility is so extreme that scores and trade setups
 * should be treated with extra caution. Also computes a "caution multiplier"
 * that callers can use to dampen confidence in high-volatility environments.
 *
 * Uses only data already present in rawData — no extra API calls.
 */

function safeN(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

const VOLATILITY_THRESHOLDS = {
  EXTREME: 40,   // >40% 24h move
  HIGH:    20,   // >20% 24h move
  ELEVATED: 10,  // >10% 24h move
};

/**
 * Assess overall market volatility for a given project.
 *
 * @param {object} rawData - raw collector output
 * @returns {{
 *   regime: 'calm'|'elevated'|'high'|'extreme',
 *   caution_multiplier: number,  // 0.5 (extreme) → 1.0 (calm)
 *   volatility_pct_24h: number|null,
 *   volatility_pct_7d: number|null,
 *   notes: string[]
 * }}
 */
export function assessVolatility(rawData = {}) {
  const market = rawData.market ?? {};
  const dex    = rawData.dex   ?? {};

  const change24h = safeN(market.price_change_pct_24h);
  const change7d  = safeN(market.price_change_pct_7d);
  const dexChange24h = safeN(dex.dex_price_change_h24);

  // Use absolute values for regime detection
  const abs24h = change24h != null ? Math.abs(change24h) : (dexChange24h != null ? Math.abs(dexChange24h) : null);
  const abs7d  = change7d  != null ? Math.abs(change7d)  : null;

  const notes = [];
  let regime = 'calm';

  if (abs24h != null) {
    if (abs24h >= VOLATILITY_THRESHOLDS.EXTREME) {
      regime = 'extreme';
      notes.push(`Extreme 24h price move: ${change24h?.toFixed(1)}% — scoring confidence significantly reduced.`);
    } else if (abs24h >= VOLATILITY_THRESHOLDS.HIGH) {
      regime = 'high';
      notes.push(`High 24h price move: ${change24h?.toFixed(1)}% — treat scores with caution.`);
    } else if (abs24h >= VOLATILITY_THRESHOLDS.ELEVATED) {
      regime = 'elevated';
      notes.push(`Elevated 24h volatility: ${change24h?.toFixed(1)}%.`);
    }
  }

  // Check weekly volatility as secondary signal
  if (abs7d != null && abs7d >= 50 && regime !== 'extreme') {
    if (regime === 'calm') regime = 'elevated';
    notes.push(`Weekly price swing of ${change7d?.toFixed(1)}% adds to volatility concern.`);
  }

  // Buy/sell imbalance amplifies regime
  const buySellRatio = safeN(dex.buy_sell_ratio);
  if (buySellRatio != null && (buySellRatio > 1.8 || buySellRatio < 0.5)) {
    if (regime === 'calm') regime = 'elevated';
    notes.push(`Extreme DEX buy/sell imbalance (ratio: ${buySellRatio}) indicates panic or FOMO conditions.`);
  }

  // Caution multiplier: reduce TP probability and EV estimates in high-vol regimes
  const cautionMap = { calm: 1.0, elevated: 0.85, high: 0.70, extreme: 0.50 };
  const caution_multiplier = cautionMap[regime];

  // Round 62: 7d volatility classification for historical context
  let weekly_class = 'normal';
  if (abs7d !== null) {
    if (abs7d >= 60) weekly_class = 'extreme';
    else if (abs7d >= 30) weekly_class = 'high';
    else if (abs7d >= 15) weekly_class = 'elevated';
  }

  // Round 62: Suggested position sizing multiplier based on regime
  const positionSizeMultiplier = {
    calm: 1.0,
    elevated: 0.75,
    high: 0.5,
    extreme: 0.25,
  }[regime];

  return {
    regime,
    caution_multiplier,
    position_size_multiplier: positionSizeMultiplier,
    weekly_class,
    volatility_pct_24h: change24h,
    volatility_pct_7d: change7d,
    notes,
  };
}
