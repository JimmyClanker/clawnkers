import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';

test('loadConfig validates required env vars', () => {
  assert.throws(() => loadConfig({}), /EXA_API_KEY/);
  assert.throws(
    () => loadConfig({ EXA_API_KEY: 'exa', SIGNAL_INGEST_KEY: 'short' }),
    /SIGNAL_INGEST_KEY/
  );
});

test('loadConfig requires MCP_AUTH_KEY in production', () => {
  assert.throws(
    () => loadConfig({ EXA_API_KEY: 'exa', SIGNAL_INGEST_KEY: 'x'.repeat(32) }),
    /MCP_AUTH_KEY/
  );
});

test('loadConfig keeps defaults and compatibility', () => {
  const config = loadConfig({
    EXA_API_KEY: 'exa',
    SIGNAL_INGEST_KEY: 'x'.repeat(32),
    MCP_AUTH_KEY: 'test-mcp-key',
  });

  assert.equal(config.port, 4021);
  assert.equal(config.nvmEnv, 'production');
  assert.equal(config.version, '6.0.0');
  assert.equal(config.alphaAuthKey, null);
});

test('loadConfig allows missing MCP_AUTH_KEY in dev', () => {
  const config = loadConfig({
    EXA_API_KEY: 'exa',
    SIGNAL_INGEST_KEY: 'x'.repeat(32),
    NVM_ENV: 'development',
  });

  assert.equal(config.mcpAuthKey, undefined);
  assert.equal(config.nvmEnv, 'development');
});
