'use strict';

const express = require('express');
const usersRepo = require('../db/users');
const auditRepo = require('../db/audit');
const {
  validateFullName,
  validateEmployeeId,
  validateEmail,
  validatePassword,
  sanitizeString
} = require('../utils/validators');
const { hashPassword } = require('../services/password');
const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// The setup gate is open only while there is no active HR administrator. As
// soon as one exists, /setup (and its API) self-disable, so this can never be
// used to mint extra privileged accounts later.
function setupOpen() {
  return usersRepo.countActiveHr() === 0;
}

function tokenOk(provided) {
  if (!config.setupToken) return true;
  return sanitizeString(provided) === config.setupToken;
}

// GET /api/setup/status - lets the bootstrap page know whether it is available.
router.get('/status', (req, res) => {
  res.json({
    needsSetup: setupOpen(),
    tokenRequired: Boolean(config.setupToken)
  });
});

// POST /api/setup - create the first HR administrator (active + email verified).
router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!setupOpen()) {
      return res.status(403).json({
        error: 'Setup already completed. Please sign in instead.'
      });
    }
    if (!tokenOk(req.body && req.body.setupToken)) {
      return res.status(403).json({ error: 'Invalid setup token.' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const errors = {};
    const emailErr = validateEmail(body.email);
    if (emailErr) errors.email = emailErr;
    const empErr = validateEmployeeId(body.employeeId);
    if (empErr) errors.employeeId = empErr;
    const nameErr = validateFullName(body.fullName);
    if (nameErr) errors.fullName = nameErr;
    const pwErr = validatePassword(body.password);
    if (pwErr) errors.password = pwErr;
    if (Object.keys(errors).length) {
      return res.status(422).json({ error: 'Validation failed.', fields: errors });
    }

    const email = sanitizeString(body.email).toLowerCase();
    const employeeId = sanitizeString(body.employeeId).toUpperCase();

    if (usersRepo.findByEmail(email)) {
      return res.status(409).json({ error: 'That email is already registered.' });
    }
    if (usersRepo.findByEmployeeId(employeeId)) {
      return res.status(409).json({ error: 'That employee ID is already registered.' });
    }

    // Re-check just before insert to narrow the concurrent-setup window.
    if (!setupOpen()) {
      return res.status(403).json({ error: 'Setup already completed. Please sign in instead.' });
    }

    const { hash, salt } = await hashPassword(body.password);
    const user = usersRepo.create({
      employeeId,
      email,
      fullName: sanitizeString(body.fullName),
      passwordHash: hash,
      passwordSalt: salt,
      role: 'hr'
    });
    usersRepo.setEmailVerified(user.id);
    usersRepo.setStatus(user.id, 'active', user.id);

    auditRepo.log({
      actorId: user.id,
      action: 'bootstrap_hr',
      targetType: 'user',
      targetId: user.id,
      detail: `First HR administrator created via setup: ${email}`
    });

    return res.status(201).json({
      message: 'HR administrator created. You can now sign in.',
      user: { id: user.id, email: user.email, role: user.role }
    });
  })
);

module.exports = router;
