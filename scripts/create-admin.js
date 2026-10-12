'use strict';

/**
 * Creates (or repairs) the first HR administrator from environment variables.
 * Use this on production instead of `npm run seed` (which ships public
 * demo passwords).
 *
 * Required env vars:
 *   ADMIN_EMAIL        email of the HR admin
 *   ADMIN_PASSWORD     strong password (same complexity rules as sign-up)
 * Optional:
 *   ADMIN_NAME         full name (default "HR Administrator")
 *   ADMIN_EMPLOYEE_ID  employee id  (default "HR-0001")
 *
 * Example (Render Shell):
 *   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='...' npm run create-admin
 */

const usersRepo = require('../src/db/users');
const { hashPassword } = require('../src/services/password');
const { validateEmail, validatePassword, validateEmployeeId, sanitizeString } = require('../src/utils/validators');

async function main() {
  const email = sanitizeString(process.env.ADMIN_EMAIL).toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const fullName = sanitizeString(process.env.ADMIN_NAME) || 'HR Administrator';
  const employeeId = (sanitizeString(process.env.ADMIN_EMPLOYEE_ID) || 'HR-0001').toUpperCase();

  const problems = [validateEmail(email), validatePassword(password), validateEmployeeId(employeeId)].filter(Boolean);
  if (problems.length) {
    console.error('[create-admin] Invalid configuration:');
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }

  const existing = usersRepo.findByEmail(email);
  if (existing) {
    // Ensure the account is an active, verified HR admin.
    if (existing.role !== 'hr') {
      console.error(`[create-admin] ${email} already exists but is not an HR account. Aborting.`);
      process.exit(1);
    }
    usersRepo.setEmailVerified(existing.id);
    usersRepo.setStatus(existing.id, 'active');
    console.log(`[create-admin] Existing HR admin ${email} ensured active + email verified.`);
    return;
  }

  const { hash, salt } = await hashPassword(password);
  const user = usersRepo.create({
    employeeId,
    email,
    fullName,
    passwordHash: hash,
    passwordSalt: salt,
    role: 'hr'
  });
  usersRepo.setEmailVerified(user.id);
  usersRepo.setStatus(user.id, 'active');

  console.log(`[create-admin] Created HR admin: ${email} (${employeeId}). You can now sign in.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[create-admin] Failed:', err.message);
    process.exit(1);
  });
