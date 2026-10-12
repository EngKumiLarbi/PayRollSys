'use strict';

const crypto = require('crypto');
const config = require('../config');
const otpRepo = require('../db/otp');

/**
 * One-Time Password service.
 *
 * Codes are short-lived, single-use, rate-limited and stored ONLY as an
 * HMAC-SHA256 digest keyed by the server-side pepper, so a database leak does
 * not expose usable codes.
 */

function hashCode(code) {
  return crypto.createHmac('sha256', config.pepper).update(String(code), 'utf8').digest('hex');
}

function generateCode(length) {
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, '0');
}

function sqliteUtc(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

function parseSqliteUtc(value) {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime();
}

/**
 * Issues a fresh code, invalidating any previous outstanding code.
 * Returns the plaintext code so the caller can deliver it; it is never stored.
 */
function issueOtp(userId, purpose) {
  otpRepo.invalidateActive(userId, purpose);
  const code = generateCode(config.otp.length);
  const expiresAt = sqliteUtc(new Date(Date.now() + config.otp.ttlMinutes * 60 * 1000));
  otpRepo.create({ userId, purpose, codeHash: hashCode(code), expiresAt });
  return { code, expiresAt };
}

/**
 * Verifies a submitted code. Returns { ok } or { ok:false, reason }.
 * Reasons: no_code | locked | invalid | expired
 */
function verifyOtp(userId, purpose, submitted) {
  const record = otpRepo.findActive(userId, purpose);
  if (!record) return { ok: false, reason: 'expired' };

  if (record.attempts >= config.otp.maxAttempts) {
    otpRepo.consume(record.id);
    return { ok: false, reason: 'locked' };
  }

  const expected = Buffer.from(record.codeHash, 'hex');
  const provided = Buffer.from(hashCode(String(submitted).padStart(config.otp.length, '0')), 'hex');
  const match = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

  if (!match) {
    otpRepo.incrementAttempts(record.id);
    if (record.attempts + 1 >= config.otp.maxAttempts) otpRepo.consume(record.id);
    return { ok: false, reason: 'invalid' };
  }

  otpRepo.consume(record.id);
  return { ok: true };
}

/** Seconds the caller must wait before requesting another code (0 = ready). */
function resendCooldownRemaining(userId, purpose) {
  const last = otpRepo.lastCreatedAt(userId, purpose);
  if (!last) return 0;
  const elapsed = (Date.now() - parseSqliteUtc(last)) / 1000;
  return Math.max(0, Math.ceil(config.otp.resendCooldownSeconds - elapsed));
}

module.exports = { issueOtp, verifyOtp, resendCooldownRemaining };
