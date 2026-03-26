# Clawnkers Crypto Research 🦊

Neural web search API for crypto, blockchain, and AI research. Pay per query with USDC.

**Live**: [clawnkers.com](https://clawnkers.com)

## Features

- 🔍 **Neural Search** — Exa AI-powered semantic search across the web
- 📄 **URL Extraction** — Extract clean text from any URL (up to 5000 chars)
- 🤖 **MCP Compatible** — Streamable HTTP server for AI agent tool discovery
- 💰 **USDC Payments** — Pay with crypto via Nevermined ($0.01/query)

## Quick Start

### MCP (for AI Agents)

Add to your MCP client config:

```json
{
  "mcpServers": {
    "clawnkers-research": {
      "type": "streamableHttp",
      "url": "https://clawnkers.com/mcp"
    }
  }
}
```

Tools: `crypto_research`, `url_extract`

### REST API

```bash
# Search
curl -H "payment-signature: YOUR_TOKEN" \
  "https://clawnkers.com/research?q=bitcoin+etf+2026"

# Extract URL
curl -H "payment-signature: YOUR_TOKEN" \
  "https://clawnkers.com/fetch?url=https://example.com"
```

### Python SDK

```python
from payments_py import Payments, PaymentOptions

payments = Payments.get_instance(
    PaymentOptions(nvm_api_key="YOUR_KEY", environment="live")
)

PLAN_ID = "54250839092590488094557289937292598069305499079785004548382308387019941581147"
AGENT_ID = "19184742741465230596906933670651041789552219348391678650178832122066125642637"

token = payments.x402.get_x402_access_token(PLAN_ID, AGENT_ID)

import requests
r = requests.get(
    "https://clawnkers.com/research",
    params={"q": "defi yields 2026"},
    headers={"payment-signature": token.access_token}
)
print(r.json())
```

## Pricing

| Plan | Price | Credits | Per Query |
|------|-------|---------|-----------|
| Pay Per Query | 1 USDC | 100 | $0.01 |

[Buy Credits →](https://nevermined.app/checkout/plan/54250839092590488094557289937292598069305499079785004548382308387019941581147)

## Endpoints

| Endpoint | Method | Description | Cost |
|----------|--------|-------------|------|
| `/` | GET | Landing page | Free |
| `/api/health` | GET | Service health & info | Free |
| `/research?q=...` | GET | Neural web search | 1 credit |
| `/fetch?url=...` | GET | URL content extraction | 1 credit |
| `/mcp` | POST/GET | MCP server (Streamable HTTP) | Free |

## Stack

- **Runtime**: Node.js + Express on local Mac mini + Cloudflare Tunnel
- **Search**: [Exa AI](https://exa.ai) neural search
- **Payments**: [Nevermined](https://nevermined.io) USDC credits
- **Protocol**: [MCP](https://modelcontextprotocol.io) Streamable HTTP

## License

MIT

---

Built by [Clawnkers](https://github.com/JimmyClanker) 🦊
