'use strict';

const db = require('./index');

const otpRepo = {
  // Invalidate any outstanding codes for a user/purpose before issuing a new one.
  invalidateActive(userId, purpose) {
    db.prepare(
      `UPDATE otp_codes
       SET consumed_at = datetime('now')
       WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`
    ).run(userId, purpose);
  },

  create({ userId, purpose, codeHash, expiresAt }) {
    const info = db
      .prepare(
        `INSERT INTO otp_codes (user_id, purpose, code_hash, expires_at)
         VALUES (@userId, @purpose, @codeHash, @expiresAt)`
      )
      .run({ userId, purpose, codeHash, expiresAt });
    return Number(info.lastInsertRowid);
  },

  // The most recent, still-usable code for a user/purpose.
  findActive(userId, purpose) {
    return db
      .prepare(
        `SELECT id, user_id AS userId, purpose, code_hash AS codeHash,
                attempts, expires_at AS expiresAt, created_at AS createdAt
         FROM otp_codes
         WHERE user_id = ? AND purpose = ?
           AND consumed_at IS NULL
           AND datetime('now') < expires_at
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(userId, purpose);
  },

  incrementAttempts(id) {
    db.prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`).run(id);
  },

  consume(id) {
    db.prepare(`UPDATE otp_codes SET consumed_at = datetime('now') WHERE id = ?`).run(id);
  },

  lastCreatedAt(userId, purpose) {
    const row = db
      .prepare(
        `SELECT created_at AS createdAt FROM otp_codes
         WHERE user_id = ? AND purpose = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(userId, purpose);
    return row ? row.createdAt : null;
  }
};

module.exports = otpRepo;
