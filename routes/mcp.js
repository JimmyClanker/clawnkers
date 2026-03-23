import express from 'express';
import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { secureCompare } from '../services/signals.js';

export function createMcpRouter({ config, exaService, signalsService }) {
  const router = express.Router();
  const transports = new Map();

  function mcpAuthMiddleware(req, res, next) {
    if (!config.mcpAuthKey) return next();
    const clientKey = req.headers['x-mcp-key'];
    if (!secureCompare(clientKey, config.mcpAuthKey)) {
      return res.status(401).json({ error: 'MCP auth required. Set x-mcp-key header.' });
    }
    return next();
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

          const text = result.signals
            .map(
              (signal, index) =>
                `${index + 1}. **${signal.symbol} ${signal.direction}** [${signal.strategy}] — ${signal.timestamp}\n` +
                `   Entry: ${signal.entry} | SL: ${signal.sl} | TP: ${signal.tp} | R:R: ${signal.rr}`
            )
            .join('\n\n');

          return {
            content: [{ type: 'text', text: `Found ${result.signals.length} signal(s):\n\n${text}` }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Signal query error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    return server;
  }

  router.post('/mcp', mcpAuthMiddleware, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    let transport = sessionId ? transports.get(sessionId) : null;

    if (transport) {
      await transport.handleRequest(req, res);
      return;
    }

    if (transports.size >= config.maxMcpSessions) {
      return res.status(503).json({ error: 'Too many active MCP sessions' });
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
        console.log(`[MCP] Session created: ${id}`);
      },
    });

    transport.onclose = () => {
      for (const [id, currentTransport] of transports.entries()) {
        if (currentTransport === transport) {
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
    const transport = sessionId ? transports.get(sessionId) : null;
    if (!transport) {
      return res.status(400).json({ error: 'No active MCP session.' });
    }
    await transport.handleRequest(req, res);
  });

  router.delete('/mcp', mcpAuthMiddleware, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = sessionId ? transports.get(sessionId) : null;
    if (!transport) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await transport.handleRequest(req, res);
    transports.delete(sessionId);
  });

  return router;
}
