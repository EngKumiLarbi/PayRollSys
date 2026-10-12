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
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      // Keep these short so a blocked/unreachable mail server (e.g. Render's
      // free tier blocks outbound SMTP) fails fast instead of hanging a request.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
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
      ? 'confirm your email address during registration'
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

function printConsoleOtp(to, code, purpose) {
  console.log(
    `\n================ DEV OTP ================\n` +
      ` To      : ${to}\n` +
      ` Purpose : ${purpose}\n` +
      ` Code    : ${code}\n` +
      ` Expires : ${config.otp.ttlMinutes} minutes\n` +
      `=========================================\n`
  );
}

async function sendOtpEmail(to, code, purpose) {
  const subject = subjectFor(purpose);
  if (!config.smtp.host) {
    // No mail server configured: print the code so local/dev flows work.
    getTransporter();
    printConsoleOtp(to, code, purpose);
    return { dev: true };
  }
  try {
    return await sendMail({ to, subject, text: textFor(code, purpose, config.otp.ttlMinutes) });
  } catch (err) {
    // Delivery failed (bad credentials, or outbound SMTP blocked by the host
    // such as Render's free tier). Fall back to the server log so the code is
    // still retrievable instead of leaving the account locked out.
    console.error(`[mail] OTP delivery failed (${err.message}). Falling back to server log.`);
    printConsoleOtp(to, code, purpose);
    return { fallback: true };
  }
}

module.exports = { sendOtpEmail };
