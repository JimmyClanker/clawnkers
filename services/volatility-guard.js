import { safeNum } from '../utils/math.js';
/**
 * volatility-guard.js — Round 35 (AutoResearch)
 * Detects when market volatility is so extreme that scores and trade setups
 * should be treated with extra caution. Also computes a "caution multiplier"
 * that callers can use to dampen confidence in high-volatility environments.
 *
 * Uses only data already present in rawData — no extra API calls.
 */


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

  const change24h = safeNum(market.price_change_pct_24h);
  const change7d  = safeNum(market.price_change_pct_7d);
  const dexChange24h = safeNum(dex.dex_price_change_h24);

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

  // Round 156 (AutoResearch): 90-day realized annualized volatility — structural context
  // Helps distinguish high-vol regime that's normal for this asset vs truly unusual
  const realizedVol90d = safeNum(rawData?.market?.realized_vol_90d);
  if (realizedVol90d !== null && abs24h !== null) {
    // If realized vol is very low (<30%) but 24h move is high → unusual event, increase caution
    if (realizedVol90d < 30 && abs24h > 10 && regime === 'elevated') {
      regime = 'high';
      notes.push(`Realized 90d vol ${realizedVol90d}% (normally stable) but ${abs24h.toFixed(1)}% 24h move — unusual event, elevated caution.`);
    } else if (realizedVol90d > 200) {
      notes.push(`Asset has extremely high 90d realized volatility (${realizedVol90d}% annualized) — structural high-risk asset.`);
    }
  }

  // Buy/sell imbalance amplifies regime
  const buySellRatio = safeNum(dex.buy_sell_ratio);
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

  // Round 38 (AutoResearch): risk_tier — human-readable label combining regime + weekly class
  const RISK_TIER_MAP = {
    calm_normal: 'low_risk',
    calm_elevated: 'moderate_risk',
    calm_high: 'moderate_risk',
    calm_extreme: 'elevated_risk',
    elevated_normal: 'moderate_risk',
    elevated_elevated: 'elevated_risk',
    elevated_high: 'elevated_risk',
    elevated_extreme: 'high_risk',
    high_normal: 'elevated_risk',
    high_elevated: 'high_risk',
    high_high: 'high_risk',
    high_extreme: 'high_risk',
    extreme_normal: 'high_risk',
    extreme_elevated: 'high_risk',
    extreme_high: 'critical_risk',
    extreme_extreme: 'critical_risk',
  };
  const risk_tier = RISK_TIER_MAP[`${regime}_${weekly_class}`] ?? 'moderate_risk';

  // Round 381 (AutoResearch): ATH recency context for volatility interpretation
  // If token is near ATH, elevated volatility is "good" volatility (price discovery)
  // If token is far from ATH (>80% below), elevated volatility likely means continued decline
  const daysSinceAth = safeNum(rawData?.market?.days_since_ath);
  const athDistPct = safeNum(rawData?.market?.ath_distance_pct);
  let athVolatilityContext = null;
  if (daysSinceAth !== null && regime !== 'calm') {
    if (daysSinceAth <= 30) {
      athVolatilityContext = 'positive_discovery'; // near ATH + volatile = breakout phase
      notes.push(`Volatility near ATH set ${daysSinceAth}d ago — price discovery phase, volatility may be constructive.`);
    } else if (athDistPct !== null && athDistPct < -80 && daysSinceAth > 365) {
      athVolatilityContext = 'structural_decline'; // far from ATH + volatile = continued decay
      notes.push(`Volatility deep below ATH (${Math.abs(athDistPct).toFixed(0)}% from ATH set ${Math.round(daysSinceAth / 365 * 10) / 10}yr ago) — high-vol may signal continued downtrend.`);
    }
  }

  return {
    regime,
    risk_tier,
    caution_multiplier,
    position_size_multiplier: positionSizeMultiplier,
    weekly_class,
    volatility_pct_24h: change24h,
    volatility_pct_7d: change7d,
    // Round 381 (AutoResearch): ATH context for interpreting volatility direction
    ath_volatility_context: athVolatilityContext,
    notes,
  };
}
