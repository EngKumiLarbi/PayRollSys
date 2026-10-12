'use strict';

/**
 * End-to-end smoke test. Boots the real app on an ephemeral port and exercises
 * registration -> email OTP -> HR verification -> login OTP 2FA -> RBAC ->
 * payroll flow using the public HTTP API.
 * Run: npm run smoke
 */

const assert = require('assert');
const app = require('../src/app');
const config = require('../src/config');
const usersRepo = require('../src/db/users');
const { hashPassword } = require('../src/services/password');
const { issueOtp } = require('../src/services/otp');

const stamp = Date.now();

function makeJar() {
  let cookie = '';
  return {
    set(res) {
      const raw = res.headers.get('set-cookie');
      if (raw) cookie = raw.split(';')[0];
    },
    get() {
      return cookie;
    }
  };
}

async function call(base, path, { method = 'GET', body, jar } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (jar && jar.get()) headers.Cookie = jar.get();
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (jar) jar.set(res);
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}

async function main() {
  // Provision a dedicated, already-verified HR admin directly.
  const { hash, salt } = await hashPassword('SmokeHR#2026!');
  const hr = usersRepo.create({
    employeeId: `SMK-HR-${stamp}`,
    email: `smoke.hr.${stamp}@company.com`,
    fullName: 'Smoke HR',
    passwordHash: hash,
    passwordSalt: salt,
    role: 'hr'
  });
  usersRepo.setEmailVerified(hr.id);
  usersRepo.setStatus(hr.id, 'active');

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const hrJar = makeJar();
  const staffJar = makeJar();
  const staffEmail = `smoke.staff.${stamp}@company.com`;
  const staffEmpId = `SMK-${stamp}`;
  const staffPassword = 'StaffSmoke#2026!';

  try {
    // 1. Register staff -> pending + email OTP issued.
    let r = await call(base, '/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Smoke Staff',
        employeeId: staffEmpId,
        email: staffEmail,
        password: staffPassword,
        role: 'staff'
      }
    });
    assert.strictEqual(r.status, 201, 'register should return 201');
    assert.strictEqual(r.data.user.status, 'pending');
    assert.strictEqual(r.data.otpRequired, true, 'registration should require email OTP');
    if (config.otp.devEcho) {
      assert.match(r.data.devOtp, /^\d{6}$/, 'dev OTP should be echoed when SMTP is unconfigured');
      console.log('PASS dev OTP echoed to client (SMTP unconfigured)');
    }
    const staffId = r.data.user.id;
    console.log('PASS register -> pending + OTP issued');

    // 2. Login before email verification is blocked and flags email OTP.
    r = await call(base, '/api/auth/login', {
      method: 'POST',
      body: { email: staffEmail, password: staffPassword }
    });
    assert.strictEqual(r.status, 403, 'unverified email login should be blocked');
    assert.strictEqual(r.data.otpPurpose, 'email_verify');
    console.log('PASS login blocked until email verified');

    // 3. Weak password rejected by server-side validation.
    r = await call(base, '/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Weak',
        employeeId: `WEAK-${stamp}`,
        email: `weak.${stamp}@company.com`,
        password: 'password',
        role: 'staff'
      }
    });
    assert.strictEqual(r.status, 422, 'weak password should be rejected');
    console.log('PASS back-end rejects weak password');

    // 4. Wrong OTP is rejected.
    r = await call(base, '/api/auth/verify-email', {
      method: 'POST',
      body: { email: staffEmail, code: '000000' }
    });
    assert.ok([401, 422].includes(r.status), 'wrong OTP should fail');
    console.log('PASS wrong OTP rejected');

    // 5. Correct email OTP verifies the address.
    const emailCode = issueOtp(staffId, 'email_verify').code;
    r = await call(base, '/api/auth/verify-email', {
      method: 'POST',
      body: { email: staffEmail, code: emailCode }
    });
    assert.strictEqual(r.status, 200, 'email verification should succeed');
    assert.strictEqual(r.data.emailVerified, true);
    assert.strictEqual(r.data.awaitingHr, true);
    console.log('PASS email OTP verifies address');

    // 6. HR logs in through credential step + login OTP 2FA.
    r = await call(base, '/api/auth/login', {
      method: 'POST',
      body: { email: `smoke.hr.${stamp}@company.com`, password: 'SmokeHR#2026!' }
    });
    assert.strictEqual(r.status, 200, 'HR credentials should be accepted');
    assert.strictEqual(r.data.otpRequired, true, 'HR login should require OTP 2FA');
    assert.strictEqual(hrJar.get(), '', 'no session cookie before OTP');
    const hrLoginCode = issueOtp(hr.id, 'login').code;
    r = await call(base, '/api/auth/login/verify', {
      method: 'POST',
      body: { email: `smoke.hr.${stamp}@company.com`, code: hrLoginCode },
      jar: hrJar
    });
    assert.strictEqual(r.status, 200, 'HR OTP should complete login');
    assert.ok(hrJar.get().startsWith('hrp_session='), 'session cookie should be set');
    console.log('PASS HR two-step login + hardened session cookie');

    // 7. HR route requires auth.
    r = await call(base, '/api/hr/summary', { jar: staffJar });
    assert.strictEqual(r.status, 401, 'unauthenticated jar blocked');
    console.log('PASS HR route requires auth');

    // 8. HR approves the staff registration.
    r = await call(base, '/api/hr/registrations', { jar: hrJar });
    assert.strictEqual(r.status, 200);
    const pending = r.data.registrations.find((u) => u.email === staffEmail);
    assert.ok(pending, 'pending registration should be listed');
    r = await call(base, `/api/hr/registrations/${pending.id}/approve`, { method: 'POST', jar: hrJar });
    assert.strictEqual(r.status, 200);
    console.log('PASS HR verifies registration');

    // 9. Staff two-step login now that the account is active + verified.
    r = await call(base, '/api/auth/login', {
      method: 'POST',
      body: { email: staffEmail, password: staffPassword }
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.otpRequired, true);
    const staffLoginCode = issueOtp(staffId, 'login').code;
    r = await call(base, '/api/auth/login/verify', {
      method: 'POST',
      body: { email: staffEmail, code: staffLoginCode },
      jar: staffJar
    });
    assert.strictEqual(r.status, 200, 'staff OTP should complete login');
    console.log('PASS staff two-step login after verification');

    // 10. Staff must NOT access HR endpoints.
    r = await call(base, '/api/hr/summary', { jar: staffJar });
    assert.strictEqual(r.status, 403, 'staff hitting HR route should be forbidden');
    console.log('PASS least-privilege RBAC enforced');

    // 11. HR initiates a payroll cycle.
    r = await call(base, '/api/hr/payroll', {
      method: 'POST',
      jar: hrJar,
      body: { userId: pending.id, period: '2026-10', amount: 5000, eta: '2026-10-30' }
    });
    assert.strictEqual(r.status, 201, 'payroll creation should return 201');
    const payrollId = r.data.payroll.id;
    console.log('PASS HR initiates payment cycle');

    // 12. Staff sees their own pending payment + ETA.
    r = await call(base, '/api/staff/payroll', { jar: staffJar });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.pendingCount, 1);
    assert.strictEqual(r.data.nextEta, '2026-10-30');
    console.log('PASS staff sees pending payment + ETA');

    // 13. HR disburses; summary reflects completed disbursement.
    r = await call(base, `/api/hr/payroll/${payrollId}/pay`, { method: 'POST', jar: hrJar });
    assert.strictEqual(r.status, 200);
    r = await call(base, '/api/hr/summary', { jar: hrJar });
    assert.ok(r.data.summary.completedDisbursement >= 5000);
    console.log('PASS HR disburses + liability summary updates');

    console.log('\nAll smoke tests passed.');
  } finally {
    server.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SMOKE TEST FAILED:', err.message);
    process.exit(1);
  });
