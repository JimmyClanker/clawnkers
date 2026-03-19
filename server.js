import express from "express";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();
const PORT = process.env.PORT || 4021;

// Cast Trading Wallet — receives payments
const PAY_TO = "0x4bDE6B11Df6C0F0f5351e6fB0E7Bdc40eAa0cb4D";

// Exa API for research
const EXA_API_KEY = "9275664f-b823-4699-ab44-137bae9d0de4";

// Payment middleware — protects /research and /fetch endpoints
app.use(
  paymentMiddlewareFromConfig(
    {
      "GET /research": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.01",
            network: "eip155:84532", // Base Sepolia (testnet)
            payTo: PAY_TO,
          },
        ],
        description: "AI-powered web research via Exa neural search",
        mimeType: "application/json",
      },
      "GET /fetch": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.005",
            network: "eip155:84532",
            payTo: PAY_TO,
          },
        ],
        description: "Fetch and extract content from any URL",
        mimeType: "application/json",
      },
    },
    [new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" })],
    [{ network: "eip155:84532", server: new ExactEvmScheme() }],
  )
);

// Health check (free)
app.get("/", (req, res) => {
  res.json({
    service: "x402-research",
    version: "1.0.0",
    endpoints: {
      "/research?q=your+query": "$0.01 — AI web research (Exa neural search)",
      "/fetch?url=https://...": "$0.005 — URL content extraction",
    },
    payTo: PAY_TO,
    network: "Base (EVM)",
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
  console.log(`x402-research listening on port ${PORT}`);
  console.log(`Payments go to: ${PAY_TO}`);
  console.log(`Network: Base mainnet`);
});
