'use strict';

const express = require('express');
const usersRepo = require('../db/users');
const auditRepo = require('../db/audit');
const { validateRegistration, validateLogin, sanitizeString, validateEmail } = require('../utils/validators');
const { hashPassword, verifyPassword } = require('../services/password');
const { signSession, setSessionCookie, clearSessionCookie } = require('../services/token');
const { issueOtp, verifyOtp, resendCooldownRemaining } = require('../services/otp');
const { sendOtpEmail } = require('../services/mailer');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Delivers an OTP without letting a mail outage break the request flow.
// The email is sent fire-and-forget so a slow or unreachable mail server never
// stalls the HTTP response (which would surface as a 502 behind a proxy).
function deliverOtp(user, purpose) {
  const { code } = issueOtp(user.id, purpose);
  Promise.resolve()
    .then(() => sendOtpEmail(user.email, code, purpose))
    .catch((err) => console.error('[mail] failed to deliver OTP:', err.message));
  return code;
}

// In local development (no SMTP configured) the freshly issued code is echoed
// back so the browser console can display it. Never active in production.
function devOtpFields(code) {
  return config.otp.devEcho && code ? { devOtp: code } : {};
}

const OTP_ERRORS = {
  expired: 'That code has expired. Request a new one.',
  locked: 'Too many incorrect attempts. Request a new code.',
  invalid: 'Incorrect verification code.',
  no_code: 'No active code found. Request a new one.'
};

function otpErrorResponse(res, reason) {
  return res.status(401).json({ error: OTP_ERRORS[reason] || 'Verification failed.', reason });
}

// POST /api/auth/register - identity binding + onboarding (PRD section 3)
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { valid, errors, sanitized } = validateRegistration(req.body);
    if (!valid) {
      return res.status(422).json({ error: 'Validation failed.', fields: errors });
    }

    if (usersRepo.findByEmail(sanitized.email)) {
      return res.status(409).json({ error: 'That email is already registered.' });
    }
    if (usersRepo.findByEmployeeId(sanitized.employeeId)) {
      return res.status(409).json({ error: 'That employee ID is already registered.' });
    }

    // Salt + pepper + adaptive hashing (PRD section 4).
    const { hash, salt } = await hashPassword(sanitized.password);

    const user = usersRepo.create({
      employeeId: sanitized.employeeId,
      email: sanitized.email,
      fullName: sanitized.fullName,
      passwordHash: hash,
      passwordSalt: salt,
      role: sanitized.role
    });

    usersRepo.upsertProfile(user.id, {});

    auditRepo.log({
      actorId: user.id,
      action: 'register',
      targetType: 'user',
      targetId: user.id,
      detail: `Registration submitted for role=${user.role}`
    });

    if (config.otp.enabled) {
      const devCode = await deliverOtp(user, 'email_verify');
      // Account cannot log in until the email OTP is confirmed AND an HR admin
      // verifies employment (PRD section 3).
      return res.status(201).json({
        message: 'Registration received. Enter the code we emailed you to confirm your address.',
        user: { id: user.id, email: user.email, status: user.status, role: user.role },
        otpRequired: true,
        otpPurpose: 'email_verify',
        ...devOtpFields(devCode)
      });
    }

    return res.status(201).json({
      message:
        'Registration received. An HR administrator must verify your employment before you can sign in.',
      user: { id: user.id, email: user.email, status: user.status, role: user.role },
      otpRequired: false,
      otpPurpose: null
    });
  })
);

// POST /api/auth/verify-email - confirms ownership of the email address
router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const email = sanitizeString(req.body && req.body.email).toLowerCase();
    const code = sanitizeString(req.body && req.body.code);
    const emailErr = validateEmail(email);
    if (emailErr || !/^\d+$/.test(code)) {
      return res.status(422).json({ error: 'Enter the code we sent to your email.' });
    }

    const user = usersRepo.findByEmail(email);
    if (!user) return res.status(400).json({ error: 'Verification failed.' });

    if (user.emailVerified) {
      return res.json({ message: 'Email already verified.', emailVerified: true });
    }

    const result = verifyOtp(user.id, 'email_verify', code);
    if (!result.ok) return otpErrorResponse(res, result.reason);

    usersRepo.setEmailVerified(user.id);
    auditRepo.log({ actorId: user.id, action: 'verify_email', targetType: 'user', targetId: user.id });

    const stillPending = user.status === 'pending';
    return res.json({
      message: stillPending
        ? 'Email verified. Your account is now awaiting HR employment verification.'
        : 'Email verified. You can now sign in.',
      emailVerified: true,
      awaitingHr: stillPending
    });
  })
);

// POST /api/auth/login - verifies credentials against active DB state
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { valid, errors } = validateLogin(req.body);
    if (!valid) {
      return res.status(422).json({ error: 'Validation failed.', fields: errors });
    }

    const email = String(req.body.email).trim().toLowerCase();
    const user = usersRepo.findByEmail(email);

    // Constant-ish response regardless of whether the email exists.
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const ok = await verifyPassword(req.body.password, user.passwordHash, user.passwordSalt);
    if (!ok) {
      auditRepo.log({ actorId: user.id, action: 'login_failed', targetType: 'user', targetId: user.id });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Please verify your email address first.',
        otpRequired: true,
        otpPurpose: 'email_verify',
        email: user.email
      });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is awaiting HR verification.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Your account is not active. Contact HR.' });
    }

    // Second factor: email OTP before the session is granted.
    if (config.otp.enabled) {
      const devCode = await deliverOtp(user, 'login');
      return res.json({
        message: 'Enter the verification code sent to your email to finish signing in.',
        otpRequired: true,
        otpPurpose: 'login',
        email: user.email,
        ...devOtpFields(devCode)
      });
    }

    const token = signSession(user);
    setSessionCookie(res, token);
    auditRepo.log({ actorId: user.id, action: 'login', targetType: 'user', targetId: user.id });

    return res.json({
      message: 'Signed in.',
      user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName }
    });
  })
);

// POST /api/auth/login/verify - completes the 2FA step and issues a session
router.post(
  '/login/verify',
  asyncHandler(async (req, res) => {
    const email = sanitizeString(req.body && req.body.email).toLowerCase();
    const code = sanitizeString(req.body && req.body.code);
    if (validateEmail(email) || !/^\d+$/.test(code)) {
      return res.status(422).json({ error: 'Enter the verification code.' });
    }

    const user = usersRepo.findByEmail(email);
    if (!user || !user.emailVerified) {
      return res.status(401).json({ error: 'Verification failed.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Your account is not active.' });
    }

    const result = verifyOtp(user.id, 'login', code);
    if (!result.ok) return otpErrorResponse(res, result.reason);

    const token = signSession(user);
    setSessionCookie(res, token);
    auditRepo.log({ actorId: user.id, action: 'login', targetType: 'user', targetId: user.id });

    return res.json({
      message: 'Signed in.',
      user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName }
    });
  })
);

// POST /api/auth/otp/resend - re-issues an email-verify or login code
router.post(
  '/otp/resend',
  asyncHandler(async (req, res) => {
    const email = sanitizeString(req.body && req.body.email).toLowerCase();
    const purpose = req.body && req.body.purpose === 'email_verify' ? 'email_verify' : 'login';

    // Always reply generically to avoid leaking which emails are registered.
    const generic = {
      message: 'If that account exists, a new verification code has been sent.'
    };

    const user = usersRepo.findByEmail(email);
    if (!user) return res.json(generic);

    if (purpose === 'email_verify' && user.emailVerified) {
      return res.json({ message: 'Email already verified.' });
    }
    if (purpose === 'login' && (!user.emailVerified || user.status !== 'active')) {
      return res.json(generic);
    }

    const retryAfter = resendCooldownRemaining(user.id, purpose);
    if (retryAfter > 0) {
      return res.status(429).json({
        error: `Please wait ${retryAfter}s before requesting another code.`,
        retryAfter
      });
    }

    const devCode = await deliverOtp(user, purpose);
    return res.json({
      message: generic.message,
      retryAfter: config.otp.resendCooldownSeconds,
      ...devOtpFields(devCode)
    });
  })
);

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  if (req.user) {
    auditRepo.log({ actorId: req.user.id, action: 'logout', targetType: 'user', targetId: req.user.id });
  }
  clearSessionCookie(res);
  res.json({ message: 'Signed out.' });
});

// GET /api/auth/me - resolve current session (used by dashboards on load)
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        fullName: req.user.fullName,
        employeeId: req.user.employeeId
      }
    });
  })
);

module.exports = router;
