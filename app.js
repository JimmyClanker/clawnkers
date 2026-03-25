import express from 'express';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadConfig } from './config.js';
import { createExaService } from './services/exa.js';
import { createSignalsService } from './services/signals.js';
import { createPaymentsService } from './services/payments.js';
import { createCollectorCache } from './services/collector-cache.js';
import { createRestRouter } from './routes/rest.js';
import { createMcpRouter } from './routes/mcp.js';
import { createAlphaRouter } from './routes/alpha.js';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp({
  env = process.env,
  exaService,
  signalsService,
  paymentsService,
  config: providedConfig,
  collectAllFn,
} = {}) {
  const config = providedConfig || loadConfig(env);
  const app = express();

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', retryAfterMs: 60000 },
  });

  const ingestLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const mcpLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many MCP requests' },
  });

  const alphaFullLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many full alpha scans', retryAfterMs: 60000 },
  });

  const alphaQuickLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many alpha scans', retryAfterMs: 60000 },
  });

  const exa =
    exaService ||
    createExaService({
      apiKey: config.exaApiKey,
      cache: undefined,
    });

  const signals =
    signalsService ||
    createSignalsService({
      dbPath: config.dbPath,
      maxBatchSignals: config.maxBatchSignals,
      ingestKey: config.signalIngestKey,
    });

  const payments = paymentsService || createPaymentsService(config);

  // Per-collector cache (stale-while-revalidate)
  const collectorCache = createCollectorCache(signals.db);

  // ── Round 6: Security headers ────────────────────────────────────
  app.use((req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Referrer policy — only send origin, no path
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Permissions policy — disable unnecessary browser features
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    // Cross-Origin Embedder Policy
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    // Cross-Origin Resource Policy
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    // Remove X-Powered-By
    res.removeHeader('X-Powered-By');
    next();
  });

  // Block HTML pages on api.clawnkers.com — serve API only
  app.use((req, res, next) => {
    const host = (req.hostname || req.headers.host || req.headers[':authority'] || '').toLowerCase().replace(/:\d+$/, '');
    if (host.startsWith('api.')) {
      const p = req.path.toLowerCase();
      if (p === '/' || p === '/alphascan' || p === '/alphascanner') {
        return res.status(404).json({ error: 'Not found. API docs: GET /api/health' });
      }
    }
    next();
  });

  app.use('/research', apiLimiter);
  app.use('/fetch', apiLimiter);
  app.use('/alpha/quick', alphaQuickLimiter);
  app.use('/alpha/pay-verify', alphaFullLimiter);
  app.use(/^\/alpha(?!\/quick|\/pay)/, alphaFullLimiter);
  app.use('/api/signals/ingest', ingestLimiter);
  app.use('/mcp', mcpLimiter);

  app.use((req, res, next) => {
    if (req.path === '/mcp') return next();
    return express.json({ limit: '100kb' })(req, res, next);
  });

  // Route /alphascan → serve alphascan.html
  app.get('/alphascan', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'alphascan.html'));
  });

  // Route /alphascanner → redirect 302 to /alphascan
  app.get('/alphascanner', (req, res) => {
    const qs = Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '';
    res.redirect(302, '/alphascan' + qs);
  });

  app.use(express.static(join(__dirname, 'public')));

  if (!config.nvmApiKey) {
    console.warn('NVM_API_KEY not set — endpoints OPEN (dev mode)');
  } else {
    console.log(`Nevermined initialized (${config.nvmEnv})`);
  }

  if (payments.middleware) {
    app.use(payments.middleware);
    console.log('Payment middleware active for /research and /fetch');
  } else if (!config.nvmApiKey) {
    console.warn('⚠️  NVM_API_KEY not set — payment gating DISABLED (dev mode)');
  }

  // x402 payment gating DISABLED — using direct on-chain USDC verification via /alpha/pay-verify
  // (x402 facilitator was unreliable; replaced with direct Base mainnet tx verification)
  if (false) { // eslint-disable-line no-constant-condition
    const X402_PAY_TO = config.x402PayTo || '0x4bDE6B11Df6C0F0f5351e6fB0E7Bdc40eAa0cb4D';
    try {
      const facilitatorClient = new HTTPFacilitatorClient({ url: 'https://x402.org/facilitator' });
      const X402_NETWORK = config.x402Network || 'eip155:84532';
      const resourceServer = new x402ResourceServer(facilitatorClient)
        .register(X402_NETWORK, new ExactEvmScheme());
      app.use(
        paymentMiddleware(
          {
            'GET /alpha': {
              accepts: { scheme: 'exact', price: '$1.00', network: X402_NETWORK, payTo: X402_PAY_TO },
              description: 'Deep alpha analysis — 5 data sources + Grok AI synthesis',
            },
          },
          resourceServer,
        ),
      );
    } catch (err) {
      console.warn(`⚠️ x402 init failed: ${err.message}`);
    }
  }
  console.log('Payment: direct on-chain USDC verification active (POST /alpha/pay-verify)');

  app.use(createRestRouter({ config, exaService: exa, signalsService: signals }));
  app.use(createAlphaRouter({ config, exaService: exa, signalsService: signals, collectAllFn, collectorCache }));
  app.use(createMcpRouter({ config, exaService: exa, signalsService: signals }));

  return { app, config, services: { exa, signals, payments } };
}
