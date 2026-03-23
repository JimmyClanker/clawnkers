import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';

function createMockExaService() {
  let searchHits = 0;
  return {
    async exaSearch(query) {
      searchHits += 1;
      return {
        results: [
          {
            title: 'Solana DeFi Overview',
            url: 'https://example.com/solana',
            highlights: ['Solana and JUP are active in DeFi.', 'BTC liquidity rotates to Solana.'],
            publishedDate: '2026-03-23',
          },
          {
            title: 'Sei ecosystem update',
            url: 'https://example.com/sei',
            highlights: ['SEI and Hyperliquid are expanding.'],
            publishedDate: '2026-03-22',
          },
        ],
        freshness: { state: searchHits === 1 ? 'live' : 'cached', ageSeconds: searchHits === 1 ? 0 : 12 },
      };
    },
    async exaFetch(url) {
      return {
        url,
        title: 'Fetched page',
        text: 'Long form content',
        freshness: { state: 'live', ageSeconds: 0 },
      };
    },
    getCacheStats() {
      return { hits: 1, misses: 1, size: 1, maxEntries: 200, ttlMs: 300000 };
    },
  };
}

test('research route returns structured output and health includes cache stats', async () => {
  const { app, services } = createApp({
    env: {
      EXA_API_KEY: 'exa',
      SIGNAL_INGEST_KEY: 'x'.repeat(32),
    },
    exaService: createMockExaService(),
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const researchResponse = await fetch(`${baseUrl}/research?q=solana%20jup%20sei`);
    assert.equal(researchResponse.status, 200);
    const research = await researchResponse.json();
    assert.equal(research.freshness.state, 'live');
    assert.equal(research.confidence, 'medium');
    assert.ok(research.summary.includes('Solana'));
    assert.ok(research.entities.includes('JUP'));
    assert.equal(research.sources.length, 2);

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.cache.hits, 1);
  } finally {
    server.close();
    services.signals.close();
  }
});

test('signals ingest and query routes work with auth and sqlite storage', async () => {
  const { app, services } = createApp({
    env: {
      EXA_API_KEY: 'exa',
      SIGNAL_INGEST_KEY: 'x'.repeat(32),
      DB_PATH: ':memory:',
    },
    exaService: createMockExaService(),
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const ingestResponse = await fetch(`${baseUrl}/api/signals/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ingest-key': 'x'.repeat(32),
      },
      body: JSON.stringify({
        symbol: 'btc',
        direction: 'LONG',
        strategy: 'DIVERGENCE',
        entry: 1,
      }),
    });
    assert.equal(ingestResponse.status, 200);

    const listResponse = await fetch(`${baseUrl}/api/signals?coin=BTC&type=div&hours=24`);
    assert.equal(listResponse.status, 200);
    const payload = await listResponse.json();
    assert.equal(payload.count, 1);
    assert.equal(payload.signals[0].symbol, 'BTC');
  } finally {
    server.close();
    services.signals.close();
  }
});
