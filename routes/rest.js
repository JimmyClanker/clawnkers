import express from 'express';
import { APP_NAME } from '../config.js';

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
    });
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
