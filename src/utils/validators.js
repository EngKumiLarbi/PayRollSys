'use strict';

const config = require('../config');

/**
 * Back-end verification helpers (PRD section 5). The server NEVER trusts
 * front-end checks; every payload is independently validated and sanitized.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPLOYEE_ID_RE = /^[A-Z0-9][A-Z0-9-]{3,19}$/;
const PASSWORD_MIN = 12;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Strip control characters and trim; keeps payloads safe for storage.
function sanitizeString(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function validateEmail(email) {
  if (!isNonEmptyString(email)) return 'Email is required.';
  const value = email.trim().toLowerCase();
  if (!EMAIL_RE.test(value)) return 'Email address is not a valid format.';
  // Domain restriction is OPTIONAL. When CORPORATE_EMAIL_DOMAIN is unset
  // (the default) any valid email address is accepted.
  if (config.corporateEmailDomain) {
    const domain = value.split('@')[1];
    if (domain !== config.corporateEmailDomain) {
      return `Email must use the @${config.corporateEmailDomain} domain.`;
    }
  }
  return null;
}

function validateEmployeeId(employeeId) {
  if (!isNonEmptyString(employeeId)) return 'Employee ID is required.';
  if (!EMPLOYEE_ID_RE.test(employeeId.trim().toUpperCase())) {
    return 'Employee ID must be 4-20 characters (letters, digits, hyphens).';
  }
  return null;
}

function validateFullName(name) {
  if (!isNonEmptyString(name)) return 'Full name is required.';
  const value = name.trim();
  if (value.length < 2 || value.length > 120) return 'Full name must be 2-120 characters.';
  return null;
}

// Password complexity: length + upper/lower/digit/special (PRD section 5).
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain a digit.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain a special character.';
  return null;
}

function validateRegistration(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const errors = {};

  const emailErr = validateEmail(body.email);
  if (emailErr) errors.email = emailErr;

  const empErr = validateEmployeeId(body.employeeId);
  if (empErr) errors.employeeId = empErr;

  const nameErr = validateFullName(body.fullName);
  if (nameErr) errors.fullName = nameErr;

  const pwErr = validatePassword(body.password);
  if (pwErr) errors.password = pwErr;

  if (body.role !== undefined && !['hr', 'staff'].includes(body.role)) {
    errors.role = 'Role must be either "hr" or "staff".';
  }

  return { valid: Object.keys(errors).length === 0, errors, sanitized: {
    email: sanitizeString(body.email).toLowerCase(),
    employeeId: sanitizeString(body.employeeId).toUpperCase(),
    fullName: sanitizeString(body.fullName),
    password: typeof body.password === 'string' ? body.password : '',
    role: body.role === 'hr' ? 'hr' : 'staff'
  } };
}

function validateLogin(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const errors = {};
  if (!isNonEmptyString(body.email)) errors.email = 'Email is required.';
  if (!isNonEmptyString(body.password)) errors.password = 'Password is required.';
  return { valid: Object.keys(errors).length === 0, errors };
}

module.exports = {
  sanitizeString,
  validateEmail,
  validateEmployeeId,
  validateFullName,
  validatePassword,
  validateRegistration,
  validateLogin
};
