'use strict';

const db = require('./index');

const auditRepo = {
  log({ actorId, action, targetType = null, targetId = null, detail = null }) {
    db.prepare(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail)
       VALUES (?, ?, ?, ?, ?)`
    ).run(actorId ?? null, action, targetType, targetId, detail);
  },

  recent(limit = 50) {
    return db
      .prepare(
        `SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId,
                a.detail, a.created_at AS createdAt,
                u.full_name AS actorName
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.created_at DESC
         LIMIT ?`
      )
      .all(limit);
  }
};

module.exports = auditRepo;
