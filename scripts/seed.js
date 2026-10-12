'use strict';

/**
 * Seeds demo data so the portal can be explored immediately.
 *    HR admin : hr@company.com     / SuperSecure#2026
 *    Staff    : jane@company.com   / Employee#2026!
 *    Pending  : mike@company.com   / Pending#2026!
 *
 * Safe to re-run: existing accounts (by email) are left untouched.
 */

const db = require('../src/db');
const usersRepo = require('../src/db/users');
const payrollRepo = require('../src/db/payroll');
const auditRepo = require('../src/db/audit');
const { hashPassword } = require('../src/services/password');

async function ensureUser({ employeeId, email, fullName, password, role, status }) {
  const existing = usersRepo.findByEmail(email);
  if (existing) {
    if (!existing.emailVerified) usersRepo.setEmailVerified(existing.id);
    console.log(`= exists: ${email} (${role}, ${existing.status})`);
    return existing;
  }
  const { hash, salt } = await hashPassword(password);
  const user = usersRepo.create({ employeeId, email, fullName, passwordHash: hash, passwordSalt: salt, role });
  usersRepo.upsertProfile(user.id, {});
  usersRepo.setEmailVerified(user.id); // seeded accounts skip the email OTP step
  if (status !== 'pending') usersRepo.setStatus(user.id, status, null);
  console.log(`+ created: ${email} (${role}, ${status}, email verified)`);
  return usersRepo.findById(user.id);
}

async function main() {
  const hr = await ensureUser({
    employeeId: 'HR-0001',
    email: 'hr@company.com',
    fullName: 'Alex HR Admin',
    password: 'SuperSecure#2026',
    role: 'hr',
    status: 'active'
  });

  const jane = await ensureUser({
    employeeId: 'EMP-1001',
    email: 'jane@company.com',
    fullName: 'Jane Doe',
    password: 'Employee#2026!',
    role: 'staff',
    status: 'active'
  });

  await ensureUser({
    employeeId: 'EMP-1002',
    email: 'mike@company.com',
    fullName: 'Mike Pending',
    password: 'Pending#2026!',
    role: 'staff',
    status: 'pending'
  });

  usersRepo.upsertProfile(jane.id, {
    department: 'Engineering',
    position: 'Software Engineer',
    baseSalary: 8500,
    bankAccount: '****-4821',
    currency: 'USD'
  });

  if (payrollRepo.listForUser(jane.id).length === 0) {
    payrollRepo.create({ userId: jane.id, period: '2026-09', amount: 8500, eta: '2026-09-28' });
    const sep = payrollRepo.listForUser(jane.id)[0];
    if (sep) payrollRepo.markPaid(sep.id);
    payrollRepo.create({ userId: jane.id, period: '2026-10', amount: 8500, eta: '2026-10-28' });
    console.log('+ created demo payroll records for jane@company.com');
  }

  auditRepo.log({ actorId: hr.id, action: 'seed', targetType: 'system', detail: 'Demo data seeded' });

  console.log('\nSeed complete. Sign in with:');
  console.log('  HR    -> hr@company.com    / SuperSecure#2026');
  console.log('  Staff -> jane@company.com  / Employee#2026!');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
