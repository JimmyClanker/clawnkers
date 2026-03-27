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
          // Round 407 (AutoResearch): richer MCP response with tl_dr, risk_profile, and data quality
          const scoreFmt = scores?.overall?.score != null ? `${Number(scores.overall.score).toFixed(1)}/10` : 'n/a';
          const alphaLabel = agentJson.alpha_index_label ? ` (${agentJson.alpha_index_label})` : '';
          const preamble = [
            `## Alpha Research: ${project}`,
            `**TL;DR:** ${agentJson.tl_dr ?? `${project}: ${analysis?.verdict || 'HOLD'} (${scoreFmt})`}`,
            `**Score:** ${scoreFmt} | **Alpha Index:** ${agentJson.composite_alpha_index ?? 'n/a'}/100${alphaLabel}`,
            agentJson.conviction ? `**Conviction:** ${agentJson.conviction.score}/100 (${agentJson.conviction.label})` : null,
            agentJson.risk_profile ? `**Risk:** ${agentJson.risk_profile.risk_level?.toUpperCase()} | Volatility: ${agentJson.risk_profile.volatility_regime} | Flags: ${agentJson.risk_profile.critical_flags} critical` : null,
            agentJson.data_quality ? `**Data Quality:** ${agentJson.data_quality.quality_tier} (${agentJson.data_quality.coverage_pct ?? 'n/a'}% coverage)` : null,
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
        // Round 409 (AutoResearch): emoji sentiment score bar + structured sections
        const sentimentEmoji = { bullish: '🟢', bearish: '🔴', neutral: '🟡', mixed: '🟠' };
        const sentimentIcon = sentimentEmoji[data.sentiment?.toLowerCase()] ?? '⚪';
        const scoreBar = (() => {
          const s = Number(data.sentiment_score);
          if (!Number.isFinite(s)) return '';
          const normalized = Math.max(0, Math.min(10, s));
          const filled = Math.round(normalized);
          return ' [' + '█'.repeat(filled) + '░'.repeat(10 - filled) + ']';
        })();
        const lines = [
          `## 🐦 X/Twitter Sentiment: ${project}`,
          `${sentimentIcon} **${data.sentiment?.toUpperCase() ?? 'N/A'}** (score: ${data.sentiment_score ?? 'n/a'}/10)${scoreBar}`,
          `📊 Mentions: ${data.mention_volume ?? 'n/a'} | KOL: ${data.kol_sentiment ?? 'n/a'} | Engagement: ${data.engagement_level ?? 'n/a'}`,
          data.fear_greed_signal ? `⚡ Fear/Greed: ${data.fear_greed_signal}` : null,
          '',
          data.key_narratives?.length ? `**Key Narratives:** ${data.key_narratives.slice(0, 4).join(' · ')}` : null,
          data.notable_accounts?.length ? `**Notable Accounts:** ${data.notable_accounts.slice(0, 5).map((a) => `@${a}`).join(', ')}` : null,
          data.trending_topics?.length ? `**Trending:** ${data.trending_topics.slice(0, 4).join(', ')}` : null,
          data.summary ? `\n> ${data.summary}` : null,
        ].filter(l => l != null).join('\n');
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
        if (!signals.length) return { content: [{ type: 'text', text: 'No active Oracle signals at this time.' }] };

        // Round 408 (AutoResearch): severity emoji + structured grouping for better readability
        const severityEmoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' };
        const grouped = {};
        for (const s of signals) {
          const g = s.severity ?? 'low';
          if (!grouped[g]) grouped[g] = [];
          grouped[g].push(s);
        }
        const order = ['critical', 'high', 'medium', 'low'];
        const sections = [];
        for (const sev of order) {
          if (!grouped[sev]?.length) continue;
          sections.push(`### ${severityEmoji[sev] ?? '⚪'} ${sev.toUpperCase()} (${grouped[sev].length})`);
          for (const s of grouped[sev]) {
            sections.push(`**${s.signal_type}**: ${s.title}`);
            if (s.detail) sections.push(`  ${s.detail}`);
          }
        }
        const header = `## Oracle Signals (${signals.length} active)\n`;
        return { content: [{ type: 'text', text: header + sections.join('\n') }] };
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
