'use strict';

const db = require('./index');

const baseFields = `
  id, employee_id AS employeeId, email, full_name AS fullName,
  password_hash AS passwordHash, password_salt AS passwordSalt,
  email_verified AS emailVerified, role, status,
  created_at AS createdAt, verified_at AS verifiedAt, verified_by AS verifiedBy
`;

const usersRepo = {
  findByEmail(email) {
    return db
      .prepare(`SELECT ${baseFields} FROM users WHERE email = ?`)
      .get(email.toLowerCase());
  },

  findById(id) {
    return db
      .prepare(`SELECT ${baseFields} FROM users WHERE id = ?`)
      .get(id);
  },

  findByEmployeeId(employeeId) {
    return db
      .prepare(`SELECT ${baseFields} FROM users WHERE employee_id = ?`)
      .get(employeeId);
  },

  create({ employeeId, email, fullName, passwordHash, passwordSalt, role }) {
    const info = db
      .prepare(
        `INSERT INTO users (employee_id, email, full_name, password_hash, password_salt, role, status)
         VALUES (@employeeId, @email, @fullName, @passwordHash, @passwordSalt, @role, 'pending')`
      )
      .run({
        employeeId,
        email: email.toLowerCase(),
        fullName,
        passwordHash,
        passwordSalt,
        role
      });
    return this.findById(Number(info.lastInsertRowid));
  },

  listPending() {
    return db
      .prepare(
        `SELECT ${baseFields} FROM users WHERE status = 'pending' ORDER BY created_at ASC`
      )
      .all();
  },

  listStaff() {
    return db
      .prepare(
        `SELECT u.id, u.employee_id AS employeeId, u.email, u.full_name AS fullName,
                u.role, u.status, u.created_at AS createdAt,
                p.department, p.position, p.base_salary AS baseSalary,
                p.currency, p.bank_account AS bankAccount
         FROM users u
         LEFT JOIN staff_profiles p ON p.user_id = u.id
         WHERE u.role = 'staff'
         ORDER BY u.full_name ASC`
      )
      .all();
  },

  setStatus(id, status, verifiedBy = null) {
    if (status === 'active') {
      db.prepare(
        `UPDATE users SET status = ?, verified_at = datetime('now'), verified_by = ? WHERE id = ?`
      ).run(status, verifiedBy, id);
    } else {
      db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, id);
    }
    return this.findById(id);
  },

  setEmailVerified(id) {
    db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(id);
    return this.findById(id);
  },

  upsertProfile(userId, { department, position, baseSalary, bankAccount, currency }) {
    db.prepare(
      `INSERT INTO staff_profiles (user_id, department, position, base_salary, bank_account, currency)
       VALUES (@userId, @department, @position, @baseSalary, @bankAccount, @currency)
       ON CONFLICT(user_id) DO UPDATE SET
         department = excluded.department,
         position   = excluded.position,
         base_salary = excluded.base_salary,
         bank_account = excluded.bank_account,
         currency   = excluded.currency`
    ).run({
      userId,
      department: department || 'Unassigned',
      position: position || 'Employee',
      baseSalary: Number(baseSalary) || 0,
      bankAccount: bankAccount || null,
      currency: currency || 'USD'
    });
    return db.prepare('SELECT * FROM staff_profiles WHERE user_id = ?').get(userId);
  },

  getProfile(userId) {
    return db.prepare('SELECT * FROM staff_profiles WHERE user_id = ?').get(userId);
  }
};

module.exports = usersRepo;
