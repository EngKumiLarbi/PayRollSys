'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Session token helpers. Tokens are short-lived (PRD section 7) and are only
 * ever transmitted inside hardened, HttpOnly + SameSite=Strict cookies.
 */

function signSession(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      name: user.fullName,
      employeeId: user.employeeId
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function verifySession(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  res.cookie(config.cookie.name, token, {
    httpOnly: config.cookie.httpOnly,
    sameSite: config.cookie.sameSite,
    secure: config.cookie.secure,
    maxAge: config.cookie.maxAge,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.cookie.name, {
    httpOnly: config.cookie.httpOnly,
    sameSite: config.cookie.sameSite,
    secure: config.cookie.secure,
    path: '/'
  });
}

module.exports = { signSession, verifySession, setSessionCookie, clearSessionCookie };
