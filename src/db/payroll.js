'use strict';

const db = require('./index');

const payrollRepo = {
  create({ userId, period, amount, eta }) {
    const info = db
      .prepare(
        `INSERT INTO payroll_records (user_id, period, amount, eta)
         VALUES (@userId, @period, @amount, @eta)`
      )
      .run({ userId, period, amount, eta: eta || null });
    return this.findById(Number(info.lastInsertRowid));
  },

  findById(id) {
    return db
      .prepare(
        `SELECT pr.id, pr.user_id AS userId, u.full_name AS fullName,
                u.employee_id AS employeeId, pr.period, pr.amount, pr.status,
                pr.eta, pr.created_at AS createdAt, pr.paid_at AS paidAt
         FROM payroll_records pr
         JOIN users u ON u.id = pr.user_id
         WHERE pr.id = ?`
      )
      .get(id);
  },

  listAll() {
    return db
      .prepare(
        `SELECT pr.id, pr.user_id AS userId, u.full_name AS fullName,
                u.employee_id AS employeeId, p.department, p.position,
                pr.period, pr.amount, pr.status, pr.eta,
                pr.created_at AS createdAt, pr.paid_at AS paidAt
         FROM payroll_records pr
         JOIN users u ON u.id = pr.user_id
         LEFT JOIN staff_profiles p ON p.user_id = u.id
         ORDER BY pr.period DESC, u.full_name ASC`
      )
      .all();
  },

  listForUser(userId) {
    return db
      .prepare(
        `SELECT id, period, amount, status, eta,
                created_at AS createdAt, paid_at AS paidAt
         FROM payroll_records
         WHERE user_id = ?
         ORDER BY period DESC`
      )
      .all(userId);
  },

  markPaid(id) {
    db.prepare(
      `UPDATE payroll_records
       SET status = 'paid', paid_at = datetime('now')
       WHERE id = ? AND status = 'pending'`
    ).run(id);
    return this.findById(id);
  },

  // Real-time liability vs disbursement tracking (PRD 6 - HR dashboard).
  summary() {
    return db
      .prepare(
        `SELECT
           COUNT(*)                                                   AS totalRecords,
           COALESCE(SUM(amount), 0)                                   AS totalAmount,
           COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS outstandingLiability,
           COALESCE(SUM(CASE WHEN status = 'paid'    THEN amount END), 0) AS completedDisbursement,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)        AS pendingCount,
           SUM(CASE WHEN status = 'paid'    THEN 1 ELSE 0 END)        AS paidCount
         FROM payroll_records`
      )
      .get();
  }
};

module.exports = payrollRepo;
