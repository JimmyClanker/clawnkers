import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const packageJson = require('./package.json');

const __dirname = dirname(fileURLToPath(import.meta.url));

export const APP_NAME = 'Clawnkers Crypto Research';
export const PAY_TO = '0x4bDE6B11Df6C0F0f5351e6fB0E7Bdc40eAa0cb4D';
export const DEFAULT_PORT = 4021;
export const EXA_CACHE_TTL_MS = 5 * 60 * 1000;
export const EXA_CACHE_MAX_ENTRIES = 200;
export const MAX_BATCH_SIGNALS = 100;
export const MAX_MCP_SESSIONS = 50;
export const APP_VERSION = packageJson.version;

export function loadConfig(env = process.env) {
  const config = {
    appName: APP_NAME,
    version: APP_VERSION,
    port: Number(env.PORT) || DEFAULT_PORT,
    exaApiKey: env.EXA_API_KEY,
    xaiApiKey: env.XAI_API_KEY,
    alphaAuthKey: env.ALPHA_AUTH_KEY || null,
    signalIngestKey: env.SIGNAL_INGEST_KEY,
    nvmApiKey: env.NVM_API_KEY,
    nvmPlanId: env.NVM_PLAN_ID,
    nvmAgentId: env.NVM_AGENT_ID,
    nvmEnv: env.NVM_ENV || 'production',
    mcpAuthKey: env.MCP_AUTH_KEY,
    payTo: PAY_TO,
    dbPath: env.DB_PATH || join(__dirname, 'data', 'signals.db'),
    exaCacheTtlMs: EXA_CACHE_TTL_MS,
    exaCacheMaxEntries: EXA_CACHE_MAX_ENTRIES,
    maxBatchSignals: MAX_BATCH_SIGNALS,
    maxMcpSessions: MAX_MCP_SESSIONS,
  };

  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  if (!config.exaApiKey) {
    throw new Error('FATAL: EXA_API_KEY not set. Refusing to start.');
  }

  if (!config.signalIngestKey || config.signalIngestKey.length < 32) {
    throw new Error(
      'FATAL: SIGNAL_INGEST_KEY not set or too short (min 32 chars). Refusing to start.'
    );
  }

  if (!config.mcpAuthKey && config.nvmEnv === 'production') {
    throw new Error(
      'FATAL: MCP_AUTH_KEY not set in production. MCP endpoint would be open. Refusing to start.'
    );
  }

  return config;
}
