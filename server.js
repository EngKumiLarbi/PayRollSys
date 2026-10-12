'use strict';

const app = require('./src/app');
const config = require('./src/config');

const server = app.listen(config.port, () => {
  console.log(`HR & Payroll Portal [${config.env}] listening on http://localhost:${config.port}`);
  if (!config.isProduction) {
    console.log('TIP: run `npm run seed` to create demo HR and staff accounts.');
  }
});

function shutdown(signal) {
  console.log(`\n${signal} received, closing server...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
