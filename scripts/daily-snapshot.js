#!/usr/bin/env node
/**
 * Daily Snapshot — Score Calibration Pipeline (v2)
 *
 * Fetches top N assets from CoinGecko, runs collectors + algorithmic scoring,
 * stores in calibration.db via the canonical snapshot-store.
 *
 * Replaces the legacy version that used backtest.db + server quick-scan endpoint.
 *
 * Usage: node scripts/daily-snapshot.js [--limit 50]
 * Cost: $0 (all free APIs, no LLM)
 */

import { runBatchScan } from '../calibration/batch-scanner.js';

const LIMIT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--limit') || '50', 10);

async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[snapshot] ${today} — fetching top ${LIMIT} assets...`);

  // Use the canonical batch scanner with Tier A (top 100 by market cap)
  // Level 0 = market + dex only (fast, cheap), Level 1 = all collectors
  const result = await runBatchScan({
    tier: 'A',
    level: 1,
    limit: LIMIT,
    rateLimitMs: 1500,
  });

  console.log(`[snapshot] Done: ${result.succeeded} scanned, ${result.failed} failed`);
}

main().catch(err => {
  console.error(`[snapshot] Fatal: ${err.message}`);
  process.exit(1);
});
