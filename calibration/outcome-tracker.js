/**
 * outcome-tracker.js — Aggiorna i forward returns per snapshot passati
 *
 * Calcola return assoluto e relativo vs BTC per checkpoint 7/14/30/60/90 giorni.
 * Tolleranza: ±1 giorno.
 *
 * Usage: node calibration/outcome-tracker.js
 * Exports: trackOutcomes()
 */

import { getCalibrationDb } from './db.js';

const CHECKPOINT_DAYS = [7, 14, 30, 60, 90];
const TOLERANCE_DAYS = 1;

// Cache BTC price to avoid repeated calls
let btcPriceCache = { price: null, ts: 0 };
const BTC_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch current price for a token from CoinGecko simple/price.
 * @param {string} coingeckoId
 * @returns {Promise<number|null>}
 */
export async function fetchCurrentPrice(coingeckoId) {
  if (!coingeckoId) return null;
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    return data?.[coingeckoId]?.usd ?? null;
  } catch (err) {
    console.warn(`[outcome-tracker] fetchCurrentPrice(${coingeckoId}) failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetch current BTC price (cached 5min).
 * @returns {Promise<number|null>}
 */
export async function fetchBtcPrice() {
  if (Date.now() - btcPriceCache.ts < BTC_CACHE_TTL_MS && btcPriceCache.price != null) {
    return btcPriceCache.price;
  }
  const price = await fetchCurrentPrice('bitcoin');
  if (price != null) {
    btcPriceCache = { price, ts: Date.now() };
  }
  return price;
}

/**
 * Calculate percentage return.
 * @param {number} priceThen
 * @param {number} priceNow
 * @returns {number|null}
 */
function calcReturn(priceThen, priceNow) {
  if (!priceThen || !priceNow || priceThen === 0) return null;
  return ((priceNow - priceThen) / priceThen) * 100;
}

/**
 * Get age of a snapshot in days.
 * @param {string} snapshotAt - ISO datetime string
 * @returns {number}
 */
function getAgeDays(snapshotAt) {
  const snapshotMs = new Date(snapshotAt).getTime();
  if (isNaN(snapshotMs)) return -1;
  return (Date.now() - snapshotMs) / (1000 * 60 * 60 * 24);
}

/**
 * Which checkpoints match this age (within ±1 day tolerance)?
 * @param {number} ageDays
 * @returns {number[]}
 */
export function matchingCheckpoints(ageDays) {
  return CHECKPOINT_DAYS.filter(
    (cp) => ageDays >= cp - TOLERANCE_DAYS && ageDays <= cp + TOLERANCE_DAYS
  );
}

/**
 * Track forward returns for snapshots nearing checkpoint ages.
 *
 * @param {object} opts
 * @param {number} [opts.maxAgeDays=91] - max snapshot age to consider
 * @param {object} [opts.db] - optional DB instance (for testing)
 * @param {Function} [opts.fetchPriceFn] - optional price fetch override (for testing)
 * @param {Function} [opts.fetchBtcFn] - optional BTC price fetch override (for testing)
 * @returns {Promise<{ updated: number, skipped: number, errors: number }>}
 */
export async function trackOutcomes({
  maxAgeDays = 91,
  db: injectedDb,
  fetchPriceFn,
  fetchBtcFn,
} = {}) {
  const db = injectedDb || getCalibrationDb();

  const fetchPrice = fetchPriceFn || fetchCurrentPrice;
  const fetchBtc = fetchBtcFn || fetchBtcPrice;

  // Get all snapshots within the age window
  const snapshots = db.prepare(`
    SELECT
      s.id AS snapshot_id,
      s.project_name,
      s.snapshot_at,
      s.price AS price_then,
      s.btc_price AS btc_price_then,
      u.coingecko_id
    FROM token_snapshots s
    LEFT JOIN token_universe u ON u.id = s.token_id
    WHERE datetime(s.snapshot_at) >= datetime('now', ?)
    ORDER BY datetime(s.snapshot_at) ASC
  `).all(`-${maxAgeDays} days`);

  if (snapshots.length === 0) {
    console.log('[outcome-tracker] No snapshots found within age window');
    return { updated: 0, skipped: 0, errors: 0 };
  }

  console.log(`[outcome-tracker] Found ${snapshots.length} snapshots to check`);

  // Check which outcomes already exist
  const existingOutcomesStmt = db.prepare(`
    SELECT snapshot_id, days_forward FROM token_outcomes
    WHERE snapshot_id = ? AND days_forward = ?
  `);

  const insertOutcome = db.prepare(`
    INSERT OR IGNORE INTO token_outcomes
      (snapshot_id, days_forward, checked_at, price_then, price_now, btc_price_then, btc_price_now, return_pct, btc_return_pct, relative_return_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const snap of snapshots) {
    const ageDays = getAgeDays(snap.snapshot_at);
    if (ageDays < 0) continue;

    const checkpoints = matchingCheckpoints(ageDays);
    if (checkpoints.length === 0) continue;

    for (const checkpoint of checkpoints) {
      // Check if already recorded
      const existing = existingOutcomesStmt.get(snap.snapshot_id, checkpoint);
      if (existing) {
        skipped++;
        continue;
      }

      try {
        // Fetch current prices
        const coingeckoId = snap.coingecko_id || snap.project_name;
        const [priceNow, btcNow] = await Promise.all([
          fetchPrice(coingeckoId),
          fetchBtc(),
        ]);

        if (priceNow == null) {
          console.warn(`[outcome-tracker] No current price for ${snap.project_name} — skipping`);
          errors++;
          continue;
        }

        const returnPct = calcReturn(snap.price_then, priceNow);
        const btcReturnPct = calcReturn(snap.btc_price_then, btcNow);
        const relativeReturnPct =
          returnPct != null && btcReturnPct != null ? returnPct - btcReturnPct : null;

        insertOutcome.run(
          snap.snapshot_id,
          checkpoint,
          new Date().toISOString(),
          snap.price_then,
          priceNow,
          snap.btc_price_then,
          btcNow,
          returnPct,
          btcReturnPct,
          relativeReturnPct,
        );

        console.log(
          `[outcome-tracker] ✓ ${snap.project_name} snapshot #${snap.snapshot_id} — ` +
          `${checkpoint}d: ${returnPct != null ? returnPct.toFixed(1) + '%' : 'n/a'} ` +
          `(vs BTC: ${relativeReturnPct != null ? relativeReturnPct.toFixed(1) + '%' : 'n/a'})`
        );
        updated++;
      } catch (err) {
        console.error(`[outcome-tracker] Error for snapshot #${snap.snapshot_id} checkpoint ${checkpoint}d: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`[outcome-tracker] Done — updated: ${updated}, skipped: ${skipped}, errors: ${errors}`);
  return { updated, skipped, errors };
}

// Reset BTC cache (for tests)
export function __resetBtcCacheForTests() {
  btcPriceCache = { price: null, ts: 0 };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('outcome-tracker.js')) {
  const args = process.argv.slice(2);
  const getArg = (flag, def) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
  };
  const maxAgeDays = parseInt(getArg('--max-age-days', '91'), 10);

  trackOutcomes({ maxAgeDays })
    .then(({ updated, skipped, errors }) => {
      console.log(`\n✅ Outcome tracking done: ${updated} updated, ${skipped} skipped, ${errors} errors`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[outcome-tracker] Fatal error:', err);
      process.exit(1);
    });
}
