'use strict';

const usersRepo = require('../db/users');
const { verifySession } = require('../services/token');
const config = require('../config');

/**
 * Session authentication + Role-Based Access Control (PRD sections 6 & 7).
 *
 * requireAuth  - resolves the session cookie into a live, ACTIVE user.
 * requireRole  - enforces least-privilege dashboard access by role.
 */

function requireAuth(req, res, next) {
  const token = req.cookies ? req.cookies[config.cookie.name] : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const payload = verifySession(token);
  if (!payload) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }

  // Re-verify against the live database: a suspended/rejected account must lose
  // access immediately even if its token has not yet expired.
  const user = usersRepo.findById(payload.sub);
  if (!user || user.status !== 'active') {
    return res.status(403).json({ error: 'Account is not active.' });
  }

  req.user = user;
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient privileges for this resource.' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
