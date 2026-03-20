import express from "express";
import { Payments } from "@nevermined-io/payments";
import { paymentMiddleware } from "@nevermined-io/payments/express";

const app = express();
const PORT = process.env.PORT || 4021;

// Config
const NVM_API_KEY = process.env.NVM_API_KEY;
const NVM_PLAN_ID = process.env.NVM_PLAN_ID;
const NVM_AGENT_ID = process.env.NVM_AGENT_ID;
const NVM_ENV = process.env.NVM_ENV || "sandbox";
const PAY_TO = "0x4bDE6B11Df6C0F0f5351e6fB0E7Bdc40eAa0cb4D";
const EXA_API_KEY = process.env.EXA_API_KEY || "9275664f-b823-4699-ab44-137bae9d0de4";

// Initialize Nevermined
let payments;
if (NVM_API_KEY) {
  payments = Payments.getInstance({
    nvmApiKey: NVM_API_KEY,
    environment: NVM_ENV,
  });
  console.log(`Nevermined initialized (${NVM_ENV})`);

  // Official payment middleware — handles 402, verify, settle automatically
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
        onBeforeVerify: (req) => {
          console.log(`[NVM] Verifying ${req.method} ${req.path}`);
        },
        onAfterSettle: (req, credits) => {
          console.log(`[NVM] Settled ${credits} credits for ${req.path}`);
        },
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

// Health check (free — not in payment routes)
app.get("/", (req, res) => {
  res.json({
    service: "Clawnkers Crypto Research",
    version: "3.1.0",
    pricing: "$0.01/query via Nevermined (100 queries = $1 USDC)",
    checkout: NVM_PLAN_ID
      ? `https://nevermined.app/checkout/plan/${NVM_PLAN_ID}`
      : "not configured",
    endpoints: {
      "/research?q=your+query": "$0.01 — AI web research (Exa neural search)",
      "/fetch?url=https://...": "$0.01 — URL content extraction",
    },
    payTo: PAY_TO,
    environment: NVM_ENV,
  });
});

// Research endpoint — Exa neural search
app.get("/research", async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: "Missing ?q= parameter" });
  }
  try {
    const response = await fetch("https://api.exa.ai/search", {
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
    const data = await response.json();
    res.json({
      query,
      results: (data.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        highlights: r.highlights || [],
        publishedDate: r.publishedDate,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Search failed", details: err.message });
  }
});

// Fetch endpoint — URL content extraction
app.get("/fetch", async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: "Missing ?url= parameter" });
  }
  try {
    const response = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: {
        "x-api-key": EXA_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: [url],
        text: { maxCharacters: 5000 },
      }),
    });
    const data = await response.json();
    const result = data.results?.[0] || {};
    res.json({
      url,
      title: result.title,
      text: result.text,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Fetch failed", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Clawnkers Crypto Research v3.1.0 on port ${PORT}`);
  console.log(`Environment: ${NVM_ENV}`);
});
