'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

/**
 * Multi-tiered password hashing strategy (PRD section 4).
 *
 *   prepared  = password + per-user salt
 *   peppered  = HMAC-SHA256(pepper, prepared)   -> fixed-length hex
 *   stored    = bcrypt(peppered, cost=12)
 *
 * - The unique per-user `salt` (crypto.randomBytes) guarantees identical
 *   passwords produce different stored hashes.
 * - The server-side `pepper` lives only in .env; without it an attacker who
 *   steals the database cannot reproduce `peppered`.
 * - HMAC keeps the bcrypt input at a fixed 64 hex chars, avoiding bcrypt's
 *   72-byte truncation pitfall.
 * - Adaptive bcrypt cost makes automated brute-force attacks expensive.
 */

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function pepper(password, salt) {
  return crypto
    .createHmac('sha256', config.pepper)
    .update(`${password}${salt}`, 'utf8')
    .digest('hex');
}

async function hashPassword(password, salt = generateSalt()) {
  const hash = await bcrypt.hash(pepper(password, salt), config.bcryptRounds);
  return { hash, salt };
}

async function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  return bcrypt.compare(pepper(password, salt), hash);
}

module.exports = { generateSalt, hashPassword, verifyPassword };
