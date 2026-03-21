import express from "express";
import { Payments } from "@nevermined-io/payments";
import { paymentMiddleware } from "@nevermined-io/payments/express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
// JSON parsing for all routes EXCEPT /mcp (MCP transport handles its own parsing)
app.use((req, res, next) => {
  if (req.path === "/mcp") return next();
  express.json()(req, res, next);
});
const PORT = process.env.PORT || 4021;

// Config
const NVM_API_KEY = process.env.NVM_API_KEY;
const NVM_PLAN_ID = process.env.NVM_PLAN_ID;
const NVM_AGENT_ID = process.env.NVM_AGENT_ID;
const NVM_ENV = process.env.NVM_ENV || "sandbox";
const PAY_TO = "0x4bDE6B11Df6C0F0f5351e6fB0E7Bdc40eAa0cb4D";
const EXA_API_KEY =
  process.env.EXA_API_KEY || "9275664f-b823-4699-ab44-137bae9d0de4";

// ─── Exa helpers ───────────────────────────────────────────
async function exaSearch(query) {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": EXA_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: 5,
      highlights: { maxCharacters: 500 },
      useAutoprompt: true,
    }),
  });
  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    highlights: r.highlights || [],
    publishedDate: r.publishedDate,
  }));
}

async function exaFetch(url) {
  const res = await fetch("https://api.exa.ai/contents", {
    method: "POST",
    headers: {
      "x-api-key": EXA_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ urls: [url], text: { maxCharacters: 5000 } }),
  });
  const data = await res.json();
  const result = data.results?.[0] || {};
  return { url, title: result.title, text: result.text };
}

// ─── Nevermined payment middleware ──────────────────────────
let payments;
if (NVM_API_KEY) {
  payments = Payments.getInstance({
    nvmApiKey: NVM_API_KEY,
    environment: NVM_ENV,
  });
  console.log(`Nevermined initialized (${NVM_ENV})`);

  if (NVM_PLAN_ID) {
    const routes = {
      "GET /research": {
        planId: NVM_PLAN_ID,
        ...(NVM_AGENT_ID && { agentId: NVM_AGENT_ID }),
        credits: 1,
      },
      "GET /fetch": {
        planId: NVM_PLAN_ID,
        ...(NVM_AGENT_ID && { agentId: NVM_AGENT_ID }),
        credits: 1,
      },
    };
    app.use(
      paymentMiddleware(payments, routes, {
        onBeforeVerify: (req) =>
          console.log(`[NVM] Verifying ${req.method} ${req.path}`),
        onAfterSettle: (req, credits) =>
          console.log(`[NVM] Settled ${credits} credits for ${req.path}`),
        onPaymentError: (error, req, res) => {
          console.error(`[NVM] Payment error: ${error.message}`);
          res.status(402).json({
            error: "Payment failed",
            message: error.message,
            checkout: `https://nevermined.app/checkout/plan/${NVM_PLAN_ID}`,
          });
        },
      })
    );
    console.log("Payment middleware active for /research and /fetch");
  }
} else {
  console.warn("NVM_API_KEY not set — endpoints OPEN (dev mode)");
}

// ─── Signal Storage (in-memory ring buffer, persists across requests) ────
const SIGNAL_INGEST_KEY = process.env.SIGNAL_INGEST_KEY || "clawnkers-ingest-2026";
const MAX_SIGNALS = 2000; // keep last 2000 signals in memory
const signals = []; // ring buffer: [{timestamp, symbol, direction, strategy, entry, sl, tp, rr, context}]

// ─── Static files + REST endpoints ─────────────────────────
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));

// Serve landing page
app.use(express.static(join(__dirname, "public")));

// Health / API info
app.get("/api/health", (req, res) => {
  res.json({
    service: "Clawnkers Crypto Research",
    version: "5.0.0",
    pricing: "$0.01/query via Nevermined (100 queries = $1 USDC)",
    checkout: NVM_PLAN_ID
      ? `https://nevermined.app/checkout/plan/${NVM_PLAN_ID}`
      : "not configured",
    endpoints: {
      "/research?q=your+query": "$0.01 — AI web research (Exa neural search)",
      "/fetch?url=https://...": "$0.01 — URL content extraction",
      "/mcp": "MCP server (Streamable HTTP) — tool discovery for AI agents",
    },
    signals: {
      "/api/signals": "GET — query trading signals (free)",
      "/api/signals/stats": "GET — signal statistics",
      "/api/signals/ingest": "POST — ingest from scanner (key required)",
    },
    mcp: {
      endpoint: "/mcp",
      transport: "Streamable HTTP (POST + GET with SSE)",
      tools: ["crypto_research", "url_extract", "trading_signals"],
    },
    payTo: PAY_TO,
    environment: NVM_ENV,
  });
});

app.get("/research", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing ?q= parameter" });
  try {
    const results = await exaSearch(query);
    res.json({ query, results, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Search failed", details: err.message });
  }
});

app.get("/fetch", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url= parameter" });
  try {
    const result = await exaFetch(url);
    res.json({ ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Fetch failed", details: err.message });
  }
});

// ─── Signal API endpoints ──────────────────────────────────

// Ingest signals from scanner (API key protected)
app.post("/api/signals/ingest", (req, res) => {
  const key = req.headers["x-ingest-key"] || req.query.key;
  if (key !== SIGNAL_INGEST_KEY) {
    return res.status(401).json({ error: "Invalid ingest key" });
  }
  const body = req.body;
  if (!body) return res.status(400).json({ error: "Missing body" });

  // Accept single signal or array
  const incoming = Array.isArray(body) ? body : [body];
  const now = new Date().toISOString();

  for (const sig of incoming) {
    signals.push({
      timestamp: sig.timestamp || now,
      symbol: sig.symbol || "UNKNOWN",
      direction: sig.direction || "UNKNOWN",
      strategy: sig.strategy || "UNKNOWN",
      entry: sig.entry || 0,
      sl: sig.sl || 0,
      tp: sig.tp || 0,
      rr: sig.rr || 0,
      context: sig.context || {},
    });
  }

  // Trim to MAX_SIGNALS
  while (signals.length > MAX_SIGNALS) signals.shift();

  res.json({ ok: true, ingested: incoming.length, total: signals.length });
});

// Query signals (free for now — can add Nevermined later)
app.get("/api/signals", (req, res) => {
  const { coin, type, hours = "168" } = req.query; // default 7 days
  const hoursNum = Math.min(parseInt(hours) || 168, 720); // max 30 days
  const cutoff = new Date(Date.now() - hoursNum * 3600 * 1000).toISOString();

  let filtered = signals.filter((s) => s.timestamp >= cutoff);
  if (coin) filtered = filtered.filter((s) => s.symbol.toUpperCase() === coin.toUpperCase());
  if (type && type !== "all") filtered = filtered.filter((s) => s.strategy.toUpperCase() === type.toUpperCase());

  // Sort newest first
  filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  res.json({
    signals: filtered,
    count: filtered.length,
    total_stored: signals.length,
    query: { coin: coin || null, type: type || "all", hours: hoursNum },
    timestamp: new Date().toISOString(),
  });
});

// Signal stats
app.get("/api/signals/stats", (req, res) => {
  const now = Date.now();
  const h24 = new Date(now - 24 * 3600 * 1000).toISOString();
  const h7d = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

  const last24h = signals.filter((s) => s.timestamp >= h24);
  const last7d = signals.filter((s) => s.timestamp >= h7d);

  const byStrategy = {};
  const bySymbol = {};
  for (const s of last7d) {
    byStrategy[s.strategy] = (byStrategy[s.strategy] || 0) + 1;
    bySymbol[s.symbol] = (bySymbol[s.symbol] || 0) + 1;
  }

  res.json({
    total_stored: signals.length,
    last_24h: last24h.length,
    last_7d: last7d.length,
    last_signal: signals.length > 0 ? signals[signals.length - 1].timestamp : null,
    by_strategy_7d: byStrategy,
    top_symbols_7d: Object.entries(bySymbol).sort((a, b) => b[1] - a[1]).slice(0, 10),
    timestamp: new Date().toISOString(),
  });
});

// ─── MCP Server (Streamable HTTP) ──────────────────────────

// Session management for stateful MCP connections
const transports = {};

function createMcpServer() {
  const server = new McpServer({
    name: "clawnkers-crypto-research",
    version: "5.0.0",
  });

  // Tool: crypto_research
  server.tool(
    "crypto_research",
    "Search the web for crypto, blockchain, and AI research using neural search. Returns 5 relevant results with highlights.",
    { query: z.string().describe("Search query (e.g. 'bitcoin etf 2026', 'solana defi trends')") },
    async ({ query }) => {
      try {
        const results = await exaSearch(query);
        const text = results
          .map(
            (r, i) =>
              `${i + 1}. **${r.title}**\n   ${r.url}\n   ${(r.highlights || []).join(" ").slice(0, 300)}`
          )
          .join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: text || "No results found.",
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Search error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: url_extract
  server.tool(
    "url_extract",
    "Extract readable text content from any URL. Returns title and cleaned text (up to 5000 chars).",
    { url: z.string().url().describe("URL to extract content from") },
    async ({ url }) => {
      try {
        const result = await exaFetch(url);
        return {
          content: [
            {
              type: "text",
              text: `# ${result.title || "Untitled"}\n\n${result.text || "No content extracted."}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Fetch error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: trading_signals
  server.tool(
    "trading_signals",
    "Get recent crypto trading signals from the Clawnkers Divergence & Convergence scanner. Returns signals with entry, SL, TP, and R:R ratio.",
    {
      coin: z.string().optional().describe("Filter by coin symbol (e.g. 'BTC', 'ETH', 'SOL')"),
      type: z.enum(["div", "convergence", "all"]).optional().default("all").describe("Signal type: div (divergence), convergence, or all"),
      hours: z.number().optional().default(24).describe("Lookback period in hours (default 24, max 720)"),
    },
    async ({ coin, type, hours }) => {
      try {
        const hoursNum = Math.min(hours || 24, 720);
        const cutoff = new Date(Date.now() - hoursNum * 3600 * 1000).toISOString();

        let filtered = signals.filter((s) => s.timestamp >= cutoff);
        if (coin) filtered = filtered.filter((s) => s.symbol.toUpperCase() === coin.toUpperCase());
        if (type && type !== "all") {
          const typeMap = { div: "DIVERGENCE", convergence: "CONVERGENCE" };
          const mapped = typeMap[type] || type.toUpperCase();
          filtered = filtered.filter((s) => s.strategy.toUpperCase() === mapped);
        }

        filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        if (filtered.length === 0) {
          return {
            content: [{ type: "text", text: `No signals found in the last ${hoursNum}h${coin ? ` for ${coin}` : ""}.` }],
          };
        }

        const text = filtered
          .map((s, i) =>
            `${i + 1}. **${s.symbol} ${s.direction}** [${s.strategy}] — ${s.timestamp}\n` +
            `   Entry: ${s.entry} | SL: ${s.sl} | TP: ${s.tp} | R:R: ${s.rr}`
          )
          .join("\n\n");

        return {
          content: [{ type: "text", text: `Found ${filtered.length} signal(s) in the last ${hoursNum}h:\n\n${text}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Signal query error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// MCP endpoint — Streamable HTTP transport
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  let transport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } else {
    // New session
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
        console.log(`[MCP] Session created: ${id}`);
      },
    });

    transport.onclose = () => {
      const id = Object.keys(transports).find((k) => transports[k] === transport);
      if (id) {
        delete transports[id];
        console.log(`[MCP] Session closed: ${id}`);
      }
    };

    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }
});

// MCP GET for SSE streams (server-to-client notifications)
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({ error: "No active MCP session. Send initialize first via POST." });
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

// MCP DELETE for session cleanup
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res);
    delete transports[sessionId];
  } else {
    res.status(404).json({ error: "Session not found" });
  }
});

// ─── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Clawnkers Crypto Research v5.0.0 on port ${PORT}`);
  console.log(`REST: /research, /fetch`);
  console.log(`MCP:  /mcp (Streamable HTTP)`);
  console.log(`Environment: ${NVM_ENV}`);
});
