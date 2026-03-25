import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createSignalsService } from '../services/signals.js';
import { calculateScores } from '../synthesis/scoring.js';

function createMockExaService() {
  return {
    async exaSearch() {
      return { results: [], freshness: { state: 'live', ageSeconds: 0 } };
    },
    async exaFetch(url) {
      return { url, title: 'mock', text: 'mock', freshness: { state: 'live', ageSeconds: 0 } };
    },
    getCacheStats() {
      return { hits: 0, misses: 0, size: 0, maxEntries: 200, ttlMs: 300000 };
    },
  };
}

function createRawData(overrides = {}) {
  return {
    project_name: 'Bitcoin',
    market: {
      total_volume: 50000000,
      market_cap: 200000000,
      price_change_pct_1h: 1,
      price_change_pct_24h: 4,
      price_change_pct_7d: 8,
      price_change_pct_30d: 12,
      ...overrides.market,
    },
    onchain: {
      tvl: 100000000,
      tvl_change_7d: 8,
      tvl_change_30d: 15,
      fees_7d: 200000,
      revenue_7d: 50000,
      ...overrides.onchain,
    },
    social: {
      mentions: 12,
      sentiment: 'bullish',
      sentiment_counts: { bullish: 8, bearish: 2 },
      key_narratives: ['institutional demand', 'ETF flows'],
      ...overrides.social,
    },
    github: {
      contributors: 18,
      commits_90d: 120,
      stars: 9000,
      ...overrides.github,
    },
    tokenomics: {
      pct_circulating: 82,
      inflation_rate: 1.5,
      token_distribution: { community: 50, treasury: 20 },
      ...overrides.tokenomics,
    },
    metadata: {
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 5,
      collectors: {
        market: { ok: true, error: null },
        onchain: { ok: true, error: null },
        social: { ok: true, error: null },
        github: { ok: true, error: null },
        tokenomics: { ok: true, error: null },
      },
      ...overrides.metadata,
    },
  };
}

function createTestApp({ configOverrides = {}, collectAllFn } = {}) {
  const signalsService = createSignalsService({
    dbPath: ':memory:',
    maxBatchSignals: 100,
    ingestKey: 'x'.repeat(32),
  });

  const config = {
    appName: 'test',
    version: 'test',
    port: 0,
    exaApiKey: 'exa',
    xaiApiKey: null,
    alphaAuthKey: null,
    signalIngestKey: 'x'.repeat(32),
    nvmApiKey: null,
    nvmPlanId: null,
    nvmAgentId: null,
    nvmEnv: 'development',
    mcpAuthKey: 'test-mcp-key',
    payTo: '0x0',
    dbPath: ':memory:',
    exaCacheTtlMs: 300000,
    exaCacheMaxEntries: 200,
    maxBatchSignals: 100,
    maxMcpSessions: 50,
    x402Enabled: false,
    ...configOverrides,
  };

  const created = createApp({
    config,
    exaService: createMockExaService(),
    signalsService,
    collectAllFn,
  });

  return created;
}

test('alpha route caches first miss then second hit', async () => {
  let calls = 0;
  const { app, services } = createTestApp({
    collectAllFn: async (projectName) => {
      calls += 1;
      return createRawData({ project_name: projectName });
    },
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const firstResponse = await fetch(`${baseUrl}/alpha?project=Bitcoin`);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.cache.hit, false);

    const secondResponse = await fetch(`${baseUrl}/alpha?project=Bitcoin`);
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.equal(second.cache.hit, true);
    assert.equal(calls, 1);
  } finally {
    server.close();
    services.signals.close();
  }
});

test('alpha full falls back when XAI_API_KEY is missing instead of erroring', async () => {
  const { app, services } = createTestApp({
    collectAllFn: async (projectName) => createRawData({ project_name: projectName }),
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/alpha?project=Bitcoin`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.llm_analysis.verdict);
    assert.equal(payload.llm_analysis.analysis_text, null);
    assert.equal(payload.llm_analysis.project_summary, null);
    assert.equal(payload.llm_analysis.project_category, null);
    assert.equal(payload.score, payload.scores.overall.score);
    assert.equal(payload.headline, null);
    assert.deepEqual(payload.validation_warnings, []);
  } finally {
    server.close();
    services.signals.close();
  }
});

test('alpha route validates missing and too long project inputs', async () => {
  const { app, services } = createTestApp({
    collectAllFn: async (projectName) => createRawData({ project_name: projectName }),
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const missingResponse = await fetch(`${baseUrl}/alpha`);
    assert.equal(missingResponse.status, 400);

    const longProject = 'a'.repeat(101);
    const longResponse = await fetch(`${baseUrl}/alpha?project=${longProject}`);
    assert.equal(longResponse.status, 400);
  } finally {
    server.close();
    services.signals.close();
  }
});

test('alpha quick works without xAI key and remains free when full alpha is gated', async () => {
  const { app, services } = createTestApp({
    configOverrides: {
      xaiApiKey: 'test-xai-key',
      alphaAuthKey: 'paid-key',
    },
    collectAllFn: async (projectName) => createRawData({ project_name: projectName }),
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const unauthorizedFull = await fetch(`${baseUrl}/alpha?project=Bitcoin`);
    assert.equal(unauthorizedFull.status, 401);
    const unauthorizedPayload = await unauthorizedFull.json();
    assert.match(unauthorizedPayload.error, /x-alpha-key/i);

    const quickResponse = await fetch(`${baseUrl}/alpha/quick?project=Bitcoin`);
    assert.equal(quickResponse.status, 200);
    const quickPayload = await quickResponse.json();
    assert.equal(quickPayload.mode, 'quick');
    assert.ok(quickPayload.llm_analysis);
  } finally {
    server.close();
    services.signals.close();
  }
});

test('scoring penalizes empty collector data below 5 overall', () => {
  const emptyData = {
    project_name: 'Empty',
    market: null,
    onchain: null,
    social: null,
    github: null,
    tokenomics: null,
    metadata: {
      collectors: {
        market: { ok: false, error: 'missing' },
        onchain: { ok: false, error: 'missing' },
        social: { ok: false, error: 'missing' },
        github: { ok: false, error: 'missing' },
        tokenomics: { ok: false, error: 'missing' },
      },
    },
  };

  const scores = calculateScores(emptyData);
  assert.ok(scores.overall.score < 5, `expected degraded score < 5, got ${scores.overall.score}`);
  assert.equal(scores.overall.completeness, 0);
});
