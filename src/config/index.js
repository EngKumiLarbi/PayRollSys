'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';

function requiredInProduction(name) {
  const value = process.env[name];
  if (!value && isProduction) {
    throw new Error(
      `[config] Missing required environment variable "${name}" in production.`
    );
  }
  return value;
}

// In development we fall back to random, process-lifetime secrets so the app
// still runs out-of-the-box, while clearly warning the operator.
function ephemeralSecret(bytes) {
  const generated = crypto.randomBytes(bytes).toString('hex');
  if (!isProduction) {
    console.warn(
      '[config] WARNING: using an ephemeral secret. Set JWT_SECRET/PEPPER in .env for stable sessions.'
    );
  }
  return generated;
}

const jwtSecret = requiredInProduction('JWT_SECRET') || ephemeralSecret(48);
const pepper = requiredInProduction('PEPPER') || ephemeralSecret(32);

module.exports = {
  env,
  isProduction,
  port: Number(process.env.PORT) || 3000,
  databaseFile: path.resolve(
    process.cwd(),
    process.env.DATABASE_FILE || path.join('data', 'payroll.db')
  ),
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m'
  },
  cookie: {
    name: process.env.COOKIE_NAME || 'hrp_session',
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    maxAge: 15 * 60 * 1000 // 15 minutes, mirrors JWT_EXPIRES_IN default
  },
  pepper,
  bcryptRounds: 12,
  corporateEmailDomain: (process.env.CORPORATE_EMAIL_DOMAIN || '').trim().toLowerCase(),

  // --- SMTP mail transport (OTP delivery) ---------------------------------
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'HR Payroll Portal <no-reply@company.com>'
  },

  // --- One-Time Password (email verification + login 2FA) -----------------
  otp: {
    enabled: String(process.env.OTP_ENABLED || 'true').toLowerCase() !== 'false',
    length: Number(process.env.OTP_LENGTH) || 6,
    ttlMinutes: Number(process.env.OTP_TTL_MINUTES) || 10,
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
    resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60,
    // Development convenience: when no mail server is configured we return the
    // OTP in the API response so it can be surfaced in the browser console.
    // Hard-disabled in production and whenever SMTP is configured.
    devEcho:
      !isProduction &&
      !(process.env.SMTP_HOST || '').trim() &&
      String(process.env.OTP_DEV_ECHO || 'true').toLowerCase() !== 'false'
  }
};
