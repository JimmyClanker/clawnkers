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

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp({
  env = process.env,
  exaService,
  signalsService,
  paymentsService,
  config: providedConfig,
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

  app.use(createRestRouter({ config, exaService: exa, signalsService: signals }));
  app.use(createMcpRouter({ config, exaService: exa, signalsService: signals }));

  return { app, config, services: { exa, signals, payments } };
}
