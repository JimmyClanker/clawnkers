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

  router.get('/api/health', (req, res) => {
    res.json({
      service: APP_NAME,
      version: config.version,
      status: 'ok',
      storage: 'sqlite',
      signals_stored: signalsService.countSignals(),
      pricing: '$0.01/query via Nevermined (100 queries = $1 USDC)',
      checkout: config.nvmPlanId
        ? `https://nevermined.app/checkout/plan/${config.nvmPlanId}`
        : 'not configured',
      endpoints: {
        '/research?q=your+query': '$0.01 — AI web research (Exa neural search)',
        '/fetch?url=https://...': '$0.01 — URL content extraction',
        '/mcp': 'MCP server (Streamable HTTP) — tool discovery for AI agents',
      },
      signals: {
        '/api/signals': 'GET — query trading signals (free)',
        '/api/signals/stats': 'GET — signal statistics',
        '/api/signals/ingest': 'POST — ingest from scanner (key required)',
      },
      mcp: {
        endpoint: '/mcp',
        transport: 'Streamable HTTP (POST + GET with SSE)',
        tools: ['crypto_research', 'url_extract', 'trading_signals'],
        auth: config.mcpAuthKey ? 'key required (x-mcp-key header)' : 'open',
      },
      cache: exaService.getCacheStats(),
      payTo: config.payTo,
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
    const key = req.headers['x-ingest-key'] || req.query.key;
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

  return router;
}
