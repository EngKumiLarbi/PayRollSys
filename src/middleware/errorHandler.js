'use strict';

const config = require('../config');

// Wraps async route handlers so rejected promises reach the error handler.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function notFound(req, res) {
  res.status(404).json({ error: 'Resource not found.' });
}

// Centralized error handler - never leaks stack traces in production.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('[error]', err);
  }
  res.status(status).json({
    error: err.expose ? err.message : 'Internal server error.',
    ...(config.isProduction ? {} : { detail: err.message })
  });
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

module.exports = { asyncHandler, notFound, errorHandler, httpError };
