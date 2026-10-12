'use strict';

const express = require('express');
const usersRepo = require('../db/users');
const payrollRepo = require('../db/payroll');
const auditRepo = require('../db/audit');
const { sanitizeString } = require('../utils/validators');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler, httpError } = require('../middleware/errorHandler');

const router = express.Router();

// Every HR route requires an authenticated user with the HR role.
router.use(requireAuth, requireRole('hr'));

// GET /api/hr/registrations - pending staff registrations awaiting verification
router.get(
  '/registrations',
  asyncHandler(async (req, res) => {
    res.json({ registrations: usersRepo.listPending() });
  })
);

// POST /api/hr/registrations/:id/approve - verify employment, activate account
router.post(
  '/registrations/:id/approve',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = usersRepo.findById(id);
    if (!user) throw httpError(404, 'Registration not found.');
    if (user.status !== 'pending') throw httpError(409, 'Registration is not pending.');

    const updated = usersRepo.setStatus(id, 'active', req.user.id);
    auditRepo.log({
      actorId: req.user.id,
      action: 'verify_registration',
      targetType: 'user',
      targetId: id,
      detail: `Activated ${user.email}`
    });

    res.json({ message: 'Registration verified and account activated.', user: updated });
  })
);

// POST /api/hr/registrations/:id/reject
router.post(
  '/registrations/:id/reject',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = usersRepo.findById(id);
    if (!user) throw httpError(404, 'Registration not found.');
    if (user.status !== 'pending') throw httpError(409, 'Registration is not pending.');

    const updated = usersRepo.setStatus(id, 'rejected');
    auditRepo.log({
      actorId: req.user.id,
      action: 'reject_registration',
      targetType: 'user',
      targetId: id,
      detail: `Rejected ${user.email}`
    });

    res.json({ message: 'Registration rejected.', user: updated });
  })
);

// GET /api/hr/staff - all staff records with compensation profiles
router.get(
  '/staff',
  asyncHandler(async (req, res) => {
    res.json({ staff: usersRepo.listStaff() });
  })
);

// PUT /api/hr/staff/:id/profile - manage employee records
router.put(
  '/staff/:id/profile',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = usersRepo.findById(id);
    if (!user || user.role !== 'staff') throw httpError(404, 'Staff member not found.');

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const profile = usersRepo.upsertProfile(id, {
      department: sanitizeString(body.department),
      position: sanitizeString(body.position),
      baseSalary: body.baseSalary,
      bankAccount: sanitizeString(body.bankAccount),
      currency: sanitizeString(body.currency)
    });

    auditRepo.log({
      actorId: req.user.id,
      action: 'update_profile',
      targetType: 'user',
      targetId: id,
      detail: `Updated compensation profile`
    });

    res.json({ message: 'Employee record updated.', profile });
  })
);

// GET /api/hr/payroll - full visibility across all payroll records
router.get(
  '/payroll',
  asyncHandler(async (req, res) => {
    res.json({ payroll: payrollRepo.listAll() });
  })
);

// POST /api/hr/payroll - initiate a payment cycle for a staff member
router.post(
  '/payroll',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const userId = Number(body.userId);
    const period = sanitizeString(body.period);
    const amount = Number(body.amount);
    const eta = sanitizeString(body.eta) || null;

    const fields = {};
    if (!Number.isInteger(userId)) fields.userId = 'A valid staff member is required.';
    if (!/^\d{4}-\d{2}$/.test(period)) fields.period = 'Period must be in YYYY-MM format.';
    if (!Number.isFinite(amount) || amount <= 0) fields.amount = 'Amount must be greater than zero.';
    if (Object.keys(fields).length) {
      return res.status(422).json({ error: 'Validation failed.', fields });
    }

    const staff = usersRepo.findById(userId);
    if (!staff || staff.role !== 'staff') throw httpError(404, 'Staff member not found.');

    const existing = payrollRepo.listForUser(userId).find((r) => r.period === period);
    if (existing) throw httpError(409, `A payroll record for ${period} already exists for this employee.`);

    const record = payrollRepo.create({ userId, period, amount, eta });
    auditRepo.log({
      actorId: req.user.id,
      action: 'create_payroll',
      targetType: 'payroll',
      targetId: record.id,
      detail: `${period} - ${amount} for user ${userId}`
    });

    res.status(201).json({ message: 'Payment cycle initiated.', payroll: record });
  })
);

// POST /api/hr/payroll/:id/pay - mark a disbursement as completed
router.post(
  '/payroll/:id/pay',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const record = payrollRepo.findById(id);
    if (!record) throw httpError(404, 'Payroll record not found.');
    if (record.status !== 'pending') throw httpError(409, 'Only pending records can be disbursed.');

    const updated = payrollRepo.markPaid(id);
    auditRepo.log({
      actorId: req.user.id,
      action: 'disburse_payroll',
      targetType: 'payroll',
      targetId: id,
      detail: `Disbursed ${record.period} to ${record.fullName}`
    });

    res.json({ message: 'Disbursement completed.', payroll: updated });
  })
);

// GET /api/hr/summary - outstanding liabilities vs completed disbursements
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json({ summary: payrollRepo.summary() });
  })
);

// GET /api/hr/audit - recent administrative audit trail
router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    res.json({ audit: auditRepo.recent(50) });
  })
);

module.exports = router;
