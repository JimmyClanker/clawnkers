import { createApp } from './app.js';

const { app, config, services } = createApp();

function shutdown() {
  console.log('Shutting down...');
  services.signals.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(config.port, () => {
  console.log(`${config.appName} v${config.version} on port ${config.port}`);
  console.log('REST: /research, /fetch (rate limited: 30/min)');
  console.log(`MCP:  /mcp (Streamable HTTP, ${config.mcpAuthKey ? 'auth required' : 'open'})`);
  console.log(`Storage: SQLite (${config.dbPath})`);
  console.log(`Environment: ${config.nvmEnv}`);
});
