'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./config');
const authRoutes = require('./routes/auth');
const setupRoutes = require('./routes/setup');
const hrRoutes = require('./routes/hr');
const staffRoutes = require('./routes/staff');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Behind a TLS-terminating proxy in production (needed for secure cookies).
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Baseline security headers (PRD section 7 transport/XSS hardening).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' https://cdn.tailwindcss.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; " +
      "connect-src 'self'; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self'"
  );
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  next();
});

// Static front-end assets.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    index: false,
    extensions: ['html']
  })
);

// API surface.
app.use('/api/auth', authRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/staff', staffRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', env: config.env }));

// Friendly page routes.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/register', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'register.html'))
);
app.get('/setup', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'setup.html'))
);
app.get('/hr', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'hr-dashboard.html'))
);
app.get('/staff', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'staff-dashboard.html'))
);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
