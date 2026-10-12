'use strict';

process.on('unhandledRejection', (err) => {
  console.error('[fatal] Unhandled promise rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err);
  process.exit(1);
});

// Fail fast (with a clear message in the deploy logs) if boot-time setup such
// as opening the database throws, instead of leaving the platform to return 502.
let app;
let config;
try {
  config = require('./src/config');
  app = require('./src/app');
} catch (err) {
  console.error('[fatal] Failed to initialise the application:', err);
  process.exit(1);
}

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`HR & Payroll Portal [${config.env}] listening on http://0.0.0.0:${config.port}`);
  if (!config.isProduction) {
    console.log('TIP: run `npm run seed` to create demo HR and staff accounts.');
  }
});

server.on('error', (err) => {
  console.error('[fatal] HTTP server error:', err);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`\n${signal} received, closing server...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
