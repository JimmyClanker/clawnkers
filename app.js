import express from 'express';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadConfig } from './config.js';
import { createExaService } from './services/exa.js';
import { createSignalsService } from './services/signals.js';
import { createPaymentsService } from './services/payments.js';
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

  app.use('/research', apiLimiter);
  app.use('/fetch', apiLimiter);
  app.use('/alpha/quick', alphaQuickLimiter);
  app.use('/alpha', alphaFullLimiter);
  app.use('/api/signals/ingest', ingestLimiter);
  app.use('/mcp', mcpLimiter);

  app.use((req, res, next) => {
    if (req.path === '/mcp') return next();
    return express.json({ limit: '100kb' })(req, res, next);
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

  // x402 payment gating for /alpha full ($1.00 USDC on Base)
  const X402_PAY_TO = config.x402PayTo || '0x4bDE6B11Df6C0F0f5351e6fB0E7Bdc40eAa0cb4D';
  const X402_ENABLED = config.x402Enabled !== false;

  if (X402_ENABLED) {
    try {
      const facilitatorClient = new HTTPFacilitatorClient({ url: 'https://x402.org/facilitator' });
      // Base Sepolia testnet (eip155:84532) — x402 public facilitator only supports testnet for now
      // Switch to eip155:8453 (Base mainnet) when facilitator adds mainnet support
      const X402_NETWORK = config.x402Network || 'eip155:84532';
      const resourceServer = new x402ResourceServer(facilitatorClient)
        .register(X402_NETWORK, new ExactEvmScheme());

      app.use(
        paymentMiddleware(
          {
            'GET /alpha': {
              accepts: {
                scheme: 'exact',
                price: '$1.00',
                network: X402_NETWORK,
                payTo: X402_PAY_TO,
              },
              description: 'Deep alpha analysis — 5 data sources + Grok 4.20 AI synthesis with live X and web search',
            },
          },
          resourceServer,
        ),
      );
      console.log(`x402 payment gating active: /alpha → $1.00 USDC on ${X402_NETWORK} → ${X402_PAY_TO}`);
    } catch (err) {
      console.warn(`⚠️ x402 init failed (endpoints open): ${err.message}`);
    }
  } else {
    console.log('x402 disabled — /alpha open');
  }

  app.use(createRestRouter({ config, exaService: exa, signalsService: signals }));
  app.use(createAlphaRouter({ config, exaService: exa, signalsService: signals, collectAllFn }));
  app.use(createMcpRouter({ config, exaService: exa, signalsService: signals }));

  return { app, config, services: { exa, signals, payments } };
}
