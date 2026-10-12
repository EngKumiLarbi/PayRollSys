'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

/**
 * SMTP transport for OTP delivery.
 *
 * When SMTP_HOST is not configured (typical in development) we fall back to a
 * "console" transport: the OTP is printed to the server log instead of being
 * emailed, so the flow can be exercised locally without a mail server.
 */

let transporter = null;
let consoleFallback = false;

function getTransporter() {
  if (transporter) return transporter;

  if (config.smtp.host) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
    });
    console.log(`[mail] SMTP transport configured (${config.smtp.host}:${config.smtp.port})`);
  } else {
    transporter = nodemailer.createTransport({ jsonTransport: true });
    consoleFallback = true;
    console.warn('[mail] SMTP not configured - OTP codes will be printed to this console.');
  }
  return transporter;
}

function subjectFor(purpose) {
  return purpose === 'email_verify'
    ? 'Verify your email address'
    : 'Your sign-in verification code';
}

function textFor(code, purpose, ttlMinutes) {
  const reason =
    purpose === 'email_verify'
      ? 'confirm your corporate email during registration'
      : 'complete your sign-in';
  return [
    `Your verification code to ${reason} is: ${code}`,
    '',
    `This code expires in ${ttlMinutes} minutes. If you did not request it, ignore this email.`,
    '',
    'Corporate HR & Payroll Portal'
  ].join('\n');
}

async function sendMail({ to, subject, text }) {
  const transport = getTransporter();
  const info = await transport.sendMail({ from: config.smtp.from, to, subject, text });
  if (consoleFallback) {
    console.log(`\n[mail:dev] To: ${to}\n[mail:dev] Subject: ${subject}\n`);
  }
  return info;
}

async function sendOtpEmail(to, code, purpose) {
  const subject = subjectFor(purpose);
  if (consoleFallback || !config.smtp.host) {
    // Ensure fallback warning is emitted even before first real send.
    getTransporter();
    console.log(
      `\n================ DEV OTP ================\n` +
        ` To      : ${to}\n` +
        ` Purpose : ${purpose}\n` +
        ` Code    : ${code}\n` +
        ` Expires : ${config.otp.ttlMinutes} minutes\n` +
        `=========================================\n`
    );
    return { dev: true };
  }
  return sendMail({ to, subject, text: textFor(code, purpose, config.otp.ttlMinutes) });
}

module.exports = { sendOtpEmail };
