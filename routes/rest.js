import crypto from 'crypto';
import express from 'express';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { APP_NAME } from '../config.js';
import { getDomainFailStats } from '../collectors/fetch.js';

const ENTITY_PATTERNS = [
  /\b(BTC|ETH|SOL|SEI|ATOM|TIA|INJ|AVAX|SUI|APT|ARB|OP|MATIC|POL|BNB|XRP|DOGE|LINK|UNI|AAVE|MKR|ENA|JUP|PYTH|WIF|FET|TAO|RENDER|RNDR|NEAR)\b/gi,
  /\b(Bitcoin|Ethereum|Solana|Sei|Cosmos|Celestia|Injective|Avalanche|Sui|Aptos|Arbitrum|Optimism|Polygon|Base|Hyperliquid|Uniswap|Aave|Maker|Chainlink|Polkadot|Berachain|Monad)\b/gi,
  /\b(DeFi|DEX|L2|Layer\s?2|Rollup|Restaking|Stablecoin|MEV|NFT|MCP|AI agent|Agentic|RWA)\b/gi,
];

function buildSummary(results) {
  const highlights = results
    .flatMap((item) => item.highlights || [])
    .filter(Boolean)
    .slice(0, 3)
    .map((text) => text.trim());

  return highlights.join(' ').slice(0, 600);
}

function buildSources(results) {
  return results.map((item, index) => ({
    title: item.title || 'Untitled',
    url: item.url,
    date: item.publishedDate || null,
    relevance: Math.max(1, 100 - index * 10),
  }));
}

function extractEntities({ query, results }) {
  const corpus = [query, ...results.map((item) => [item.title, ...(item.highlights || [])].join(' '))].join(' ');
  const entities = new Set();

  for (const pattern of ENTITY_PATTERNS) {
    for (const match of corpus.matchAll(pattern)) {
      entities.add(match[0]);
    }
  }

  return Array.from(entities).sort((a, b) => a.localeCompare(b));
}

function calculateConfidence(results) {
  const withHighlights = results.filter((item) => (item.highlights || []).length > 0).length;
  if (withHighlights > 3) return 'high';
  if (withHighlights >= 1) return 'medium';
  return 'low';
}

function normalizeMoltifyTask(body = {}) {
  const data = getMoltifyData(body);
  const requestor = data.requestor && typeof data.requestor === 'object' ? data.requestor : null;
  return {
    received_at: new Date().toISOString(),
    source: 'moltify',
    status: 'received',
    event: body.event ? String(body.event) : 'task.submitted',
    task_id: String(data.task_id || data.taskId || '').trim(),
    title: String(data.title || '').trim(),
    description: String(data.description || '').trim(),
    requirements: data.requirements ? String(data.requirements).trim() : null,
    deliverable_type: data.deliverable_type ? String(data.deliverable_type).trim() : null,
    project: data.project ? String(data.project).trim() : null,
    price_usd: Number(data.price_usd ?? data.priceUsd ?? data.agreedPrice),
    priority: data.priority ? String(data.priority).trim() : 'normal',
    buyer: body.buyer && typeof body.buyer === 'object' ? {
      id: body.buyer.id ? String(body.buyer.id) : null,
      name: body.buyer.name ? String(body.buyer.name) : null,
    } : requestor ? {
      id: requestor.id ? String(requestor.id) : null,
      name: requestor.name ? String(requestor.name) : null,
      type: requestor.type ? String(requestor.type) : null,
      trust_tier: requestor.trustTier ? String(requestor.trustTier) : null,
    } : null,
    callback_url: data.callback_url ? String(data.callback_url).trim() : (data.callbackUrl ? String(data.callbackUrl).trim() : null),
    raw: body,
  };
}

function validateMoltifyPayload(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be a JSON object';
  const data = body?.data && typeof body.data === 'object' ? body.data : body;
  const taskId = data.task_id || data.taskId;
  const title = data.title;
  const description = data.description;
  const price = data.price_usd ?? data.priceUsd ?? data.agreedPrice;
  if (!String(taskId || '').trim()) return 'task_id/taskId is required';
  if (!String(title || '').trim()) return 'title is required';
  if (!String(description || '').trim()) return 'description is required';
  if (!Number.isFinite(Number(price))) return 'price_usd/agreedPrice must be a number';
  return null;
}

function getMoltifyData(body = {}) {
  return body?.data && typeof body.data === 'object' ? body.data : body;
}

function normalizeHeaderValue(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function timingSafeEqualHex(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifyMoltifyAuth(req, secret) {
  const auth = normalizeHeaderValue(req.headers.authorization);
  if (auth && auth === `Bearer ${secret}`) {
    return { ok: true, mode: 'bearer' };
  }

  const rawBody = String(req.rawBody || '');
  const signatureHeader =
    normalizeHeaderValue(req.headers['x-moltify-signature']) ||
    normalizeHeaderValue(req.headers['x-webhook-signature']) ||
    normalizeHeaderValue(req.headers['x-signature']);

  if (!signatureHeader || !rawBody) {
    return { ok: false, mode: 'missing' };
  }

  const provided = signatureHeader.replace(/^sha256=/i, '').trim();
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (timingSafeEqualHex(provided, expected)) {
    return { ok: true, mode: 'hmac' };
  }

  return { ok: false, mode: 'invalid' };
}

export function createRestRouter({ config, exaService, signalsService }) {
  const router = express.Router();

  // ── Round 9: Improved /api/health with richer docs and examples ──
  router.get('/api/health', (req, res) => {
    const totalScans = (() => {
      try {
        const db = signalsService.db;
        db.exec("CREATE TABLE IF NOT EXISTS scan_counter (id INTEGER PRIMARY KEY, count INTEGER DEFAULT 0)");
        db.exec("INSERT OR IGNORE INTO scan_counter (id, count) VALUES (1, 0)");
        return db.prepare('SELECT count FROM scan_counter WHERE id=1').get()?.count || 0;
      } catch { return 0; }
    })();

    res.json({
      service: APP_NAME,
      version: config.version,
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      storage: 'sqlite',
      signals_stored: signalsService.countSignals(),
      total_scans: totalScans,

      // ── Round 236 (AutoResearch): Feature registry — documents key capabilities for API consumers ──
      features: {
        scoring_dimensions: 7,
        collectors: 10,
        circuit_breakers: true,
        price_vs_52w_range: true,       // 52-week high/low context
        realized_vol_90d: true,         // 90-day realized volatility
        ptvl_ratio: true,               // Price-to-TVL ratio
        narrative_detection: true,      // 20+ macro narrative clusters
        sector_benchmarking: true,      // DeFiLlama sector comparisons
        cross_dimensional_analysis: true,
        conviction_scoring: true,
        trade_setup_generation: true,
        kelly_criterion_sizing: true,
        anti_hallucination_validation: true,
        llm_models: ['claude-opus-4-6', 'grok-4-fast'],
      },

      // ── Alpha Scanner ────────────────────────────────────────────
      alpha: {
        description: 'Deep alpha analysis for any crypto project',
        xai_configured: Boolean(config.xaiApiKey),
        payment: 'direct USDC on Base — $1.00 per full scan',
        quick_scan: 'free — algorithmic scoring, no AI synthesis',
        rate_limits: {
          full_scan: '3 requests / minute',
          quick_scan: '10 requests / minute',
        },
        cache: {
          full_scan_ttl: '1 hour',
          quick_scan_ttl: '15 minutes',
        },
        pay_to: config.payTo,
        examples: {
          quick_scan: 'GET /alpha/quick?project=solana',
          full_scan_verify: 'POST /alpha/pay-verify { txHash, project }',
          search: 'GET /search?q=ethereum',
        },
      },

      // ── MCP Server ───────────────────────────────────────────────
      mcp: {
        description: 'Model Context Protocol server for AI agent integration',
        endpoint: 'POST /mcp',
        transport: 'Streamable HTTP (MCP 2025-03-26)',
        auth: config.mcpAuthKey ? 'x-mcp-key header required' : 'open (no auth)',
        tools: [
          { name: 'crypto_research', description: 'Full alpha scan — 5 sources + Grok verdict', cost: '$1.00 USDC on Base' },
          { name: 'url_extract', description: 'Extract readable content from any URL', cost: 'free' },
          { name: 'trading_signals', description: 'Query stored trading signals', cost: 'free' },
        ],
        example: {
          method: 'POST',
          url: '/mcp',
          body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'crypto_research', arguments: { query: 'solana' } } },
        },
      },

      // ── REST API ─────────────────────────────────────────────────
      endpoints: {
        'GET /alpha/quick?project=<name>': 'Free algorithmic alpha scan — no AI, no payment',
        'POST /alpha/pay-verify': 'Full scan after USDC payment verification',
        'POST /alpha/batch': 'Batch quick-scan up to 5 projects simultaneously',
        'GET /alpha/history?project=<name>': 'Scan history for a project with score trend',
        'GET /alpha/compare?a=<name>&b=<name>': 'Side-by-side score comparison',
        'GET /alpha/leaderboard?limit=10': 'Top projects by overall score',
        'GET /alpha/trending?window_hours=24': 'Recently scanned projects',
        'GET /alpha/stats': 'Scan statistics and verdict distribution',
        'GET /alpha/export?project=<name>': 'Machine-readable compact export (agent-friendly)',
        'GET /alpha/digest?window_hours=24': 'Human-readable daily digest of all recent scans',
        'GET /alpha/sparkline?project=<name>&limit=20': 'Score history for chart rendering (all 7 dimensions)',
        'GET /alpha/watchlist?projects=btc,eth,sol': 'Portfolio watchlist — scan up to 8 projects, ranked by score',
        'GET /search?q=<query>': 'Token search via CoinGecko + DexScreener fallback',
        'GET /research?q=<query>': 'AI web research via Exa neural search',
        'GET /fetch?url=<url>': 'URL content extraction',
        'POST /mcp': 'MCP server — tool discovery and invocation',
        'GET /api/health': 'This endpoint — service status and API reference',
        'GET /api/signals': 'Query stored trading signals',
      },

      // ── Error codes ──────────────────────────────────────────────
      error_codes: {
        400: 'Bad request — missing or invalid parameters',
        402: 'Payment required (x402 protocol)',
        403: 'Forbidden — invalid API key or MCP key',
        404: 'Not found — endpoint does not exist',
        429: 'Rate limited — slow down and retry after 60s',
        500: 'Internal server error — temporary, please retry',
      },

      // ── Diagnostics ──────────────────────────────────────────────
      cache: exaService.getCacheStats(),
      environment: config.nvmEnv,
      // Round 233 (AutoResearch nightly): domain fail stats for collector health monitoring
      domain_fail_stats: (() => {
        try { return getDomainFailStats(); } catch (_) { return {}; }
      })(),
      // Round 233 (AutoResearch nightly): surface scan engine version and latest features
      engine: {
        scoring_version: 'v3.238',
        features: [
          'P/TVL valuation scoring (R233)',
          'Sentiment credibility score (R233)',
          'Issue health score (R233)',
          'Momentum divergence signal (R233)',
          'Volume velocity anomaly detection (R233)',
          'Payments category weights (R233)',
          'P/TVL alpha signal (R233)',
          'Score tier labels in calibration (R233)',
          'Social credibility circuit breaker (R233)',
          // Round 238 (AutoResearch nightly)
          'DEX 5m price change momentum (R238)',
          'Airdrop catalyst alpha signal (R238)',
          'Hack/exploit circuit breaker (R238)',
          'Revenue collapse circuit breaker (R238)',
          'Mercenary TVL trap breaker (R238)',
          'Community score propagation market→social (R238)',
          'GitHub test suite signal (R238)',
          'Reddit expanded keyword coverage (R238)',
          'Near-ATH breakout detector (R238)',
          'P/TVL deep value alpha signal (R238)',
          'Slow request performance monitoring (R238)',
          'Social price divergence red flag (R238)',
          'SEO aggregate rating schema (R238)',
        ],
      },
    });
  });

  router.post('/webhook/moltify', (req, res) => {
    if (!config.moltifyWebhookSecret) {
      return res.status(503).json({ ok: false, error: 'webhook_not_configured' });
    }

    const authCheck = verifyMoltifyAuth(req, config.moltifyWebhookSecret);
    if (!authCheck.ok) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const validationError = validateMoltifyPayload(req.body);
    if (validationError) {
      return res.status(400).json({ ok: false, error: 'invalid_payload', detail: validationError });
    }

    try {
      const normalized = normalizeMoltifyTask(req.body);
      if (req.body?.data?.test === true || req.body?.test === true) {
        return res.json({ ok: true, source: 'moltify', task_id: normalized.task_id, status: 'test_ok', auth_mode: authCheck.mode });
      }
      const logPath = join(process.cwd(), 'ops', 'moltify-task-log.jsonl');
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, JSON.stringify(normalized) + '\n');
      return res.json({ ok: true, source: 'moltify', task_id: normalized.task_id, status: normalized.status, auth_mode: authCheck.mode });
    } catch (error) {
      console.error('[moltify-webhook]', error.message);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  router.get('/research', async (req, res) => {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: 'Missing ?q= parameter' });
    }

    try {
      const { results, freshness } = await exaService.exaSearch(String(query));
      return res.json({
        query,
        results,
        summary: buildSummary(results),
        sources: buildSources(results),
        entities: extractEntities({ query: String(query), results }),
        freshness,
        confidence: calculateConfidence(results),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[research] ${error.message}`);
      return res.status(502).json({ error: 'Search upstream failed' });
    }
  });

  router.get('/fetch', async (req, res) => {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ error: 'Missing ?url= parameter' });
    }

    try {
      new URL(String(url));
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
      const result = await exaService.exaFetch(String(url));
      return res.json({
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[fetch] ${error.message}`);
      return res.status(502).json({ error: 'Fetch upstream failed' });
    }
  });

  router.post('/api/signals/ingest', (req, res) => {
    const key = req.headers['x-ingest-key'];
    if (!signalsService.authorizeIngestKey(key)) {
      return res.status(401).json({ error: 'Invalid ingest key' });
    }

    try {
      const result = signalsService.ingestSignals(req.body);
      return res.json({ ok: true, ...result });
    } catch (error) {
      if (error.message === 'Missing body' || error.message.startsWith('Max ')) {
        return res.status(400).json({ error: error.message });
      }
      console.error(`[ingest] ${error.message}`);
      return res.status(500).json({ error: 'Storage error' });
    }
  });

  router.get('/api/signals', (req, res) => {
    const result = signalsService.getSignals(req.query);
    res.json({ ...result, timestamp: new Date().toISOString() });
  });

  // ── Round 23: Top scanned projects ──────────────────────────
  router.get('/api/top-scanned', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    try {
      const db = signalsService.db;
      // Ensure table exists
      db.exec(`CREATE TABLE IF NOT EXISTS scan_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        scores_json TEXT,
        report_json TEXT,
        scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      const rows = db.prepare(`
        SELECT project_name, COUNT(*) as scan_count, MAX(scanned_at) as last_scanned
        FROM scan_history
        GROUP BY project_name
        ORDER BY scan_count DESC
        LIMIT ?
      `).all(limit);
      return res.json({ projects: rows, timestamp: new Date().toISOString() });
    } catch (err) {
      console.error('[top-scanned]', err.message);
      return res.status(500).json({ error: 'Failed to retrieve top scanned projects' });
    }
  });

  router.get('/api/signals/stats', (req, res) => {
    const stats = signalsService.getStats();
    res.json({
      total_stored: stats.totalStored,
      last_24h: stats.last24h,
      last_7d: stats.last7d,
      last_signal: stats.lastSignal,
      by_strategy_7d: stats.byStrategy7d,
      top_symbols_7d: stats.topSymbols7d,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Round 234 (AutoResearch): Signal Summary Endpoint ─────────────────────
  // Lightweight endpoint returning just verdict + top signals + red flags for a cached scan
  // Perfect for agents and bots that need quick structured data without the full report
  router.get('/api/signal-summary', (req, res) => {
    const project = (req.query.project || '').trim().toLowerCase().slice(0, 100);
    if (!project) return res.status(400).json({ error: 'Missing ?project= parameter' });

    try {
      const db = signalsService.db;
      // Look for recent scan in alpha_reports cache
      const row = db.prepare(`
        SELECT payload_json, created_at FROM alpha_reports
        WHERE cache_key LIKE ?
        ORDER BY created_at DESC LIMIT 1
      `).get(`%${project}%`);

      if (!row) {
        return res.status(404).json({ error: 'No cached scan found. Run a full scan first via /api/alpha/full.' });
      }

      let payload;
      try { payload = JSON.parse(row.payload_json); } catch { return res.status(500).json({ error: 'Corrupt cache entry' }); }

      const summary = {
        project_name: payload.project_name,
        verdict: payload.verdict,
        score: payload.scores?.overall?.score ?? null,
        scanned_at: row.created_at,
        data_age_minutes: Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000),
        alpha_signals: (payload.alpha_signals || []).slice(0, 5).map(s => ({ signal: s.signal, strength: s.strength, detail: s.detail })),
        red_flags: (payload.red_flags || []).filter(f => f.severity === 'critical' || f.severity === 'warning').slice(0, 5),
        narrative_strength: payload.narrative_strength ?? null,
        supply_unlock_risk: payload.supply_unlock_risk ? { risk_level: payload.supply_unlock_risk.risk_level, unlock_overhang_pct: payload.supply_unlock_risk.unlock_overhang_pct } : null,
        key_metrics: {
          price: payload.raw_data?.market?.current_price ?? null,
          market_cap: payload.raw_data?.market?.market_cap ?? null,
          tvl: payload.raw_data?.onchain?.tvl ?? null,
          change_24h: payload.raw_data?.market?.price_change_pct_24h ?? null,
          change_7d: payload.raw_data?.market?.price_change_pct_7d ?? null,
          volume_trend_7d: payload.raw_data?.market?.volume_trend_7d ?? null,
        },
        circuit_breakers_active: payload.scores?.overall?.circuit_breakers?.capped ?? false,
        data_completeness: payload.scores?.overall?.completeness ?? null,
      };

      res.json(summary);
    } catch (err) {
      console.error('[signal-summary]', err.message);
      res.status(500).json({ error: 'Failed to retrieve signal summary' });
    }
  });

  // ── Token Search Proxy (CoinGecko + DexScreener fallback) ──
  router.get('/search', async (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query || query.length < 2) return res.json({ coins: [] });
    
    try {
      const cgRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
      if (cgRes.ok) {
        const data = await cgRes.json();
        const coins = (data.coins || []).slice(0, 10).map(c => ({
          symbol: (c.symbol || '').toUpperCase(),
          name: c.name || '',
          rank: c.market_cap_rank || null,
          thumb: c.thumb || null,
          id: c.id
        }));
        if (coins.length > 0) return res.json({ coins, source: 'coingecko' });
      }
    } catch {}
    
    try {
      const dxRes = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
      if (dxRes.ok) {
        const data = await dxRes.json();
        const seen = new Map();
        for (const pair of (data.pairs || [])) {
          const sym = pair.baseToken?.symbol?.toUpperCase();
          if (!sym || seen.has(sym)) continue;
          const liq = Number(pair.liquidity?.usd || 0);
          if (!seen.has(sym) || liq > seen.get(sym).liq) {
            seen.set(sym, {
              symbol: sym,
              name: pair.baseToken?.name || '',
              chain: pair.chainId || '',
              price: pair.priceUsd,
              volume: pair.volume?.h24,
              thumb: pair.info?.imageUrl || null,
              liq
            });
          }
        }
        return res.json({ pairs: Array.from(seen.values()).slice(0, 10), source: 'dexscreener' });
      }
    } catch {}
    
    res.json({ coins: [], pairs: [] });
  });

  return router;
}
