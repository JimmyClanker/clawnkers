/**
 * Per-collector cache with stale-while-revalidate semantics.
 *
 * Stores each collector's result independently so a single slow/failing
 * collector doesn't invalidate the whole scan. Fresh data is served when
 * available; stale data is returned immediately while a background refresh runs.
 *
 * TTLs are tuned per data freshness requirements:
 *   market:     5 min  (prices move fast)
 *   onchain:   15 min  (TVL/fees update ~hourly on DeFiLlama)
 *   social:    10 min  (narratives shift throughout the day)
 *   github:    30 min  (commit stats rarely change within minutes)
 *   tokenomics:30 min  (supply data is slow-moving)
 */

const COLLECTOR_TTLS_MS = {
  market: 5 * 60 * 1000,       // Prices move fast
  onchain: 15 * 60 * 1000,     // TVL/fees update ~hourly
  social: 10 * 60 * 1000,      // Narratives shift throughout the day
  github: 30 * 60 * 1000,      // Commit stats rarely change within minutes
  tokenomics: 30 * 60 * 1000,  // Supply data is slow-moving
  dex: 3 * 60 * 1000,          // Round 16: DEX data refreshes very quickly (3 min)
  reddit: 20 * 60 * 1000,      // Round 16: Reddit posts update every ~20 min
  holders: 60 * 60 * 1000,     // Round 16: Holder data is very slow-moving (1h)
  ecosystem: 15 * 60 * 1000,   // Round 16: Ecosystem derived from onchain/dex
  contract: 60 * 60 * 1000,    // Round 16: Contract status rarely changes (1h)
  // Round 384 (AutoResearch batch): x_social TTL — X/Twitter social data changes frequently
  x_social: 10 * 60 * 1000,    // X social mirrors social TTL (10 min)
  fear_greed: 60 * 60 * 1000,  // Fear/greed index updates once per hour
};

const STALE_GRACE_MS = 60 * 60 * 1000; // Serve stale for up to 1h while refreshing

// Round 16: Cache TTL override via environment variables
// Format: CACHE_TTL_<COLLECTOR>=<seconds>
// e.g., CACHE_TTL_MARKET=120 to set market cache to 2 minutes
function applyEnvTtlOverrides() {
  for (const collector of Object.keys(COLLECTOR_TTLS_MS)) {
    const envKey = `CACHE_TTL_${collector.toUpperCase()}`;
    const envVal = process.env[envKey];
    if (envVal && Number.isFinite(Number(envVal)) && Number(envVal) > 0) {
      COLLECTOR_TTLS_MS[collector] = Number(envVal) * 1000;
    }
  }
}
applyEnvTtlOverrides();

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collector_cache (
      cache_key TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      collector TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cc_collector_key ON collector_cache(collector, cache_key);
    CREATE INDEX IF NOT EXISTS idx_cc_created_at ON collector_cache(created_at);
  `);
}

export function createCollectorCache(db) {
  ensureSchema(db);

  const inflightRefreshes = new Map();
  const getStmt = db.prepare('SELECT data_json, created_at FROM collector_cache WHERE cache_key = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO collector_cache (cache_key, data_json, created_at, collector)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      data_json = excluded.data_json,
      created_at = excluded.created_at
  `);
  const cleanupStmt = db.prepare(
    'DELETE FROM collector_cache WHERE created_at < ?'
  );

  // Schedule cleanup every hour
  const cleanupTimer = setInterval(() => {
    try {
      const cutoff = Date.now() - STALE_GRACE_MS * 2;
      cleanupStmt.run(cutoff);
    } catch (_) { /* ignore */ }
  }, 60 * 60 * 1000);
  cleanupTimer.unref?.();

  return {
    /**
     * Read cached collector data.
     * Returns: { data, stale: boolean } or null if not cached / too old.
     */
    read(collectorName, projectName) {
      const key = `${collectorName}:${projectName.trim().toLowerCase()}`;
      const row = getStmt.get(key);
      if (!row) return null;

      const ttlMs = COLLECTOR_TTLS_MS[collectorName] ?? 15 * 60 * 1000;
      const ageMs = Date.now() - Number(row.created_at);

      // Too old even for stale-while-revalidate
      if (ageMs > ttlMs + STALE_GRACE_MS) return null;

      try {
        const data = JSON.parse(row.data_json);
        return { data, stale: ageMs > ttlMs, age_ms: ageMs };
      } catch {
        return null;
      }
    },

    /**
     * Round 233 (AutoResearch nightly): Cache stats — per-collector TTL info for health endpoint.
     */
    getCacheTtlInfo() {
      return Object.entries(COLLECTOR_TTLS_MS).reduce((acc, [name, ttlMs]) => {
        acc[name] = { ttl_seconds: Math.round(ttlMs / 1000), stale_grace_seconds: Math.round(STALE_GRACE_MS / 1000) };
        return acc;
      }, {});
    },

    /**
     * Write collector result to cache.
     */
    write(collectorName, projectName, data) {
      const key = `${collectorName}:${projectName.trim().toLowerCase()}`;
      if (data?.error && Object.values(data).every((value) => value == null || value === false || value === '' || value === data.error || Array.isArray(value) && value.length === 0 || typeof value === 'object' && value && Object.keys(value).length === 0 || value === projectName)) {
        return;
      }
      try {
        upsertStmt.run(key, JSON.stringify(data), Date.now(), collectorName);
      } catch (_) { /* never block on cache write */ }
    },

    /**
     * Wrap a collector function with caching + stale-while-revalidate.
     * @param {string} collectorName
     * @param {string} projectName
     * @param {() => Promise<any>} fetchFn - the actual collector call
     * @returns {Promise<{ data: any, fromCache: boolean, stale: boolean }>}
     */
    async withCache(collectorName, projectName, fetchFn) {
      const cacheKey = `${collectorName}:${projectName.trim().toLowerCase()}`;
      const cached = this.read(collectorName, projectName);

      if (cached && !cached.stale) {
        // Fresh cache hit — return immediately
        return { data: cached.data, fromCache: true, stale: false };
      }

      if (cached && cached.stale) {
        // Stale — return stale data immediately, refresh in background.
        if (!inflightRefreshes.has(cacheKey)) {
          inflightRefreshes.set(cacheKey, (async () => {
            try {
              const fresh = await fetchFn();
              this.write(collectorName, projectName, fresh);
            } catch (_) { /* background refresh failure is non-fatal */ }
            finally { inflightRefreshes.delete(cacheKey); }
          })());
        }
        return { data: cached.data, fromCache: true, stale: true };
      }

      // No cache — fetch fresh, but dedupe concurrent misses.
      try {
        if (!inflightRefreshes.has(cacheKey)) {
          inflightRefreshes.set(cacheKey, (async () => {
            try {
              const fresh = await fetchFn();
              this.write(collectorName, projectName, fresh);
              return fresh;
            } finally {
              inflightRefreshes.delete(cacheKey);
            }
          })());
        }
        const fresh = await inflightRefreshes.get(cacheKey);
        return { data: fresh, fromCache: false, stale: false };
      } catch (err) {
        // On failure, check for any stale data (even beyond grace period) as last resort
        const lastResort = getStmt.get(cacheKey);
        if (lastResort) {
          try {
            return { data: JSON.parse(lastResort.data_json), fromCache: true, stale: true, lastResort: true };
          } catch (_) { /* ignore parse error */ }
        }
        throw err;
      }
    },
  };
}
