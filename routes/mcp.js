import express from 'express';
import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { secureCompare } from '../utils/security.js';
import { collectAll } from '../collectors/index.js';
import { calculateScores } from '../synthesis/scoring.js';
import { generateReport } from '../synthesis/llm.js';
import { formatReport, formatAgentJSON } from '../synthesis/templates.js';
import { getSignals } from '../oracle/index.js';

const MCP_SESSION_TTL_MS = 30 * 60 * 1000; // 30 min idle timeout

export function createMcpRouter({ config, exaService, signalsService }) {
  const router = express.Router();
  const transports = new Map(); // sessionId -> { transport, lastActivity, timer }

  function mcpAuthMiddleware(req, res, next) {
    if (!config.mcpAuthKey) return next();
    const clientKey = req.headers['x-mcp-key'];
    if (!secureCompare(clientKey, config.mcpAuthKey)) {
      return res.status(401).json({ error: 'MCP auth required. Set x-mcp-key header.' });
    }
    return next();
  }

  function touchSession(sessionId) {
    const entry = transports.get(sessionId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.lastActivity = Date.now();
    entry.timer = setTimeout(() => {
      transports.delete(sessionId);
      console.log(`[MCP] Session expired (idle): ${sessionId}`);
    }, MCP_SESSION_TTL_MS);
  }

  function registerSession(sessionId, transport) {
    const timer = setTimeout(() => {
      transports.delete(sessionId);
      console.log(`[MCP] Session expired (idle): ${sessionId}`);
    }, MCP_SESSION_TTL_MS);
    transports.set(sessionId, { transport, lastActivity: Date.now(), timer });
  }

  function getTransport(sessionId) {
    const entry = transports.get(sessionId);
    return entry?.transport || null;
  }

  function createMcpServer() {
    const server = new McpServer({
      name: 'clawnkers-crypto-research',
      version: config.version,
    });

    server.tool(
      'crypto_research',
      'Search the web for crypto, blockchain, and AI research using neural search. Returns 5 relevant results with highlights.',
      {
        query: z
          .string()
          .describe("Search query (e.g. 'bitcoin etf 2026', 'solana defi trends')"),
      },
      async ({ query }) => {
        try {
          const { results } = await exaService.exaSearch(query);
          const text = results
            .map(
              (item, index) =>
                `${index + 1}. **${item.title}**\n   ${item.url}\n   ${
                  (item.highlights || []).join(' ').slice(0, 300)
                }`
            )
            .join('\n\n');
          return { content: [{ type: 'text', text: text || 'No results found.' }] };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Search error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    server.tool(
      'url_extract',
      'Extract readable text content from any URL. Returns title and cleaned text (up to 5000 chars).',
      { url: z.string().url().describe('URL to extract content from') },
      async ({ url }) => {
        try {
          const result = await exaService.exaFetch(url);
          return {
            content: [
              {
                type: 'text',
                text: `# ${result.title || 'Untitled'}\n\n${
                  result.text || 'No content extracted.'
                }`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Fetch error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    server.tool(
      'trading_signals',
      'Get recent crypto trading signals from the Clawnkers scanner. Returns signals with entry, SL, TP, and R:R ratio.',
      {
        coin: z.string().optional().describe("Filter by coin symbol (e.g. 'BTC', 'ETH', 'SOL')"),
        type: z.enum(['div', 'convergence', 'all']).optional().default('all').describe('Signal type'),
        hours: z.number().optional().default(24).describe('Lookback period in hours (default 24, max 720)'),
      },
      async ({ coin, type, hours }) => {
        try {
          const result = signalsService.getSignals({ coin, type, hours });
          if (result.signals.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `No signals found in the last ${result.query.hours}h${
                    coin ? ` for ${coin}` : ''
                  }.`,
                },
              ],
            };
          }

          const bullish = result.signals.filter(s => ['LONG','BUY'].includes(s.direction?.toUpperCase())).length;
          const bearish = result.signals.filter(s => ['SHORT','SELL'].includes(s.direction?.toUpperCase())).length;
          const header = `Found ${result.signals.length} signal(s) | ${bullish} bullish / ${bearish} bearish | last ${result.query.hours}h${coin ? ` | filter: ${coin}` : ''}\n\n`;

          const text = result.signals
            .map(
              (signal, index) =>
                `${index + 1}. **${signal.symbol} ${signal.direction}** [${signal.strategy}] — ${signal.timestamp}\n` +
                `   Entry: ${signal.entry} | SL: ${signal.sl} | TP: ${signal.tp} | R:R: ${signal.rr}`
            )
            .join('\n\n');

          return {
            content: [{ type: 'text', text: header + text }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Signal query error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    server.tool(
      'alpha_research',
      'Deep alpha analysis for a crypto project using local collectors, algorithmic scoring, and Grok-backed synthesis when available.',
      { project: z.string().describe("Project name or ticker (e.g. 'solana', 'sei', 'jup')") },
      async ({ project }) => {
        try {
          const rawData = await collectAll(project, exaService);
          const scores = calculateScores(rawData);
          const analysis = await generateReport(project, rawData, scores);
          const formatted = formatReport(project, rawData, scores, analysis);
          const agentJson = formatAgentJSON(project, rawData, scores, analysis);
          const preamble = [
            `## Alpha Research: ${project}`,
            `**Verdict:** ${analysis?.verdict || 'HOLD'} | **Score:** ${scores?.overall?.score != null ? Number(scores.overall.score).toFixed(1) : 'n/a'}/10 | **Alpha Index:** ${agentJson.composite_alpha_index ?? 'n/a'}/100`,
            agentJson.conviction ? `**Conviction:** ${agentJson.conviction.score}/100 (${agentJson.conviction.label})` : null,
            '',
          ].filter(l => l != null).join('\n');
          return {
            content: [{ type: 'text', text: preamble + '\n' + formatted.text }],
            structuredContent: agentJson,
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Alpha research error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // Round 40 (AutoResearch): New MCP tool — x_sentiment for quick X/Twitter sentiment lookup
    server.tool(
      'x_sentiment',
      'Get real-time X/Twitter sentiment for a crypto project using Grok Fast. Returns KOL sentiment, mention volume, and key narratives.',
      { project: z.string().describe("Project name (e.g. 'Bitcoin', 'Solana', 'Uniswap')") },
      async ({ project }) => {
        const { collectXSocial } = await import('../collectors/x-social.js');
        const data = await collectXSocial(project);
        if (data.error) {
          return { content: [{ type: 'text', text: `X sentiment unavailable: ${data.error}` }] };
        }
        const lines = [
          `## X/Twitter Sentiment: ${project}`,
          `**Sentiment:** ${data.sentiment ?? 'n/a'} (score: ${data.sentiment_score ?? 'n/a'})`,
          `**Mention volume:** ${data.mention_volume ?? 'n/a'}`,
          `**KOL sentiment:** ${data.kol_sentiment ?? 'n/a'}`,
          data.key_narratives?.length ? `**Key narratives:** ${data.key_narratives.join(', ')}` : null,
          data.notable_accounts?.length ? `**Notable accounts:** ${data.notable_accounts.map((a) => `@${a}`).join(', ')}` : null,
          data.trending_topics?.length ? `**Trending topics:** ${data.trending_topics.join(', ')}` : null,
          data.engagement_level ? `**Engagement:** ${data.engagement_level}` : null,
          data.fear_greed_signal ? `**Fear/Greed signal:** ${data.fear_greed_signal}` : null,
          data.summary ? `\n**Summary:** ${data.summary}` : null,
        ].filter(l => l != null && l !== '').join('\n');
        return { content: [{ type: 'text', text: lines }] };
      }
    );

    server.tool(
      'get_oracle_signals',
      'Get active Alpha Oracle signals — automated alerts about score momentum, category shifts, breaker events, and divergences',
      {
        type: z.enum(['SCORE_MOMENTUM', 'CATEGORY_LEADER_SHIFT', 'BREAKER_ALERT', 'DIVERGENCE', 'REGIME_SHIFT']).optional(),
        severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
        limit: z.number().min(1).max(50).default(20).optional(),
      },
      async ({ type, severity, limit }) => {
        const signals = getSignals({ type, severity, limit: limit || 20, activeOnly: true });
        if (!signals.length) return { content: [{ type: 'text', text: 'No active signals at this time.' }] };

        const formatted = signals.map(s =>
          `[${s.severity?.toUpperCase()}] ${s.signal_type}: ${s.title}\n${s.detail}`
        ).join('\n\n');

        return { content: [{ type: 'text', text: formatted }] };
      }
    );

    return server;
  }

  router.post('/mcp', mcpAuthMiddleware, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    let transport = sessionId ? getTransport(sessionId) : null;

    if (transport) {
      touchSession(sessionId);
      await transport.handleRequest(req, res);
      return;
    }

    if (transports.size >= config.maxMcpSessions) {
      return res.status(503).json({ error: 'Too many active MCP sessions' });
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        registerSession(id, transport);
        console.log(`[MCP] Session created: ${id}`);
      },
    });

    transport.onclose = () => {
      for (const [id, entry] of transports.entries()) {
        if (entry.transport === transport) {
          clearTimeout(entry.timer);
          transports.delete(id);
          console.log(`[MCP] Session closed: ${id}`);
          break;
        }
      }
    };

    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  router.get('/mcp', mcpAuthMiddleware, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = sessionId ? getTransport(sessionId) : null;
    if (!transport) {
      return res.status(400).json({ error: 'No active MCP session.' });
    }
    touchSession(sessionId);
    await transport.handleRequest(req, res);
  });

  router.delete('/mcp', mcpAuthMiddleware, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const entry = sessionId ? transports.get(sessionId) : null;
    if (!entry) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await entry.transport.handleRequest(req, res);
    clearTimeout(entry.timer);
    transports.delete(sessionId);
  });

  return router;
}
