import crypto from 'crypto';

function hashKey(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export class LruTtlCache {
  constructor({ maxEntries = 200, ttlMs = 300000 } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      this.misses += 1;
      return null;
    }

    clearTimeout(entry.timeout);
    entry.timeout = this.scheduleCleanup(key, entry.expiresAt - Date.now());
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;

    return {
      value: entry.value,
      ageSeconds: Math.floor((Date.now() - entry.createdAt) / 1000),
    };
  }

  set(key, value) {
    if (this.store.has(key)) {
      this.delete(key);
    }

    const createdAt = Date.now();
    const expiresAt = createdAt + this.ttlMs;
    const entry = {
      value,
      createdAt,
      expiresAt,
      timeout: this.scheduleCleanup(key, this.ttlMs),
    };

    this.store.set(key, entry);

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.delete(oldestKey);
    }

    return entry;
  }

  delete(key) {
    const entry = this.store.get(key);
    if (entry?.timeout) {
      clearTimeout(entry.timeout);
    }
    this.store.delete(key);
  }

  scheduleCleanup(key, delayMs) {
    return setTimeout(() => {
      this.delete(key);
    }, Math.max(delayMs, 0));
  }

  stats() {
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
    };
  }

  clear() {
    for (const key of this.store.keys()) {
      this.delete(key);
    }
  }
}

async function withTimeout(timeoutMs, callback) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await callback(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export function createExaService({ apiKey, cache, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!apiKey) {
    throw new Error('Missing Exa API key');
  }

  const exaCache = cache || new LruTtlCache();

  async function exaSearch(query) {
    const cacheKey = hashKey(`search:${query}`);
    const cached = exaCache.get(cacheKey);
    if (cached) {
      return {
        results: cached.value,
        freshness: { state: 'cached', ageSeconds: cached.ageSeconds },
      };
    }

    const results = await withTimeout(timeoutMs, async (signal) => {
      const res = await fetchImpl('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          type: 'auto',
          numResults: 5,
          highlights: { maxCharacters: 500 },
          useAutoprompt: true,
        }),
        signal,
      });

      if (!res.ok) {
        throw new Error(`Exa returned ${res.status}`);
      }

      const data = await res.json();
      return (data.results || []).map((item) => ({
        title: item.title,
        url: item.url,
        highlights: item.highlights || [],
        publishedDate: item.publishedDate || null,
      }));
    });

    exaCache.set(cacheKey, results);
    return {
      results,
      freshness: { state: 'live', ageSeconds: 0 },
    };
  }

  async function exaFetch(url) {
    const cacheKey = hashKey(`fetch:${url}`);
    const cached = exaCache.get(cacheKey);
    if (cached) {
      return {
        ...cached.value,
        freshness: { state: 'cached', ageSeconds: cached.ageSeconds },
      };
    }

    const result = await withTimeout(timeoutMs, async (signal) => {
      const res = await fetchImpl('https://api.exa.ai/contents', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ urls: [url], text: { maxCharacters: 5000 } }),
        signal,
      });

      if (!res.ok) {
        throw new Error(`Exa returned ${res.status}`);
      }

      const data = await res.json();
      const item = data.results?.[0] || {};
      return {
        url,
        title: item.title,
        text: item.text,
      };
    });

    exaCache.set(cacheKey, result);
    return {
      ...result,
      freshness: { state: 'live', ageSeconds: 0 },
    };
  }

  return {
    exaSearch,
    exaFetch,
    getCacheStats: () => exaCache.stats(),
    cache: exaCache,
  };
}
