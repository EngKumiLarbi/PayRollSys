'use strict';

const express = require('express');
const usersRepo = require('../db/users');
const payrollRepo = require('../db/payroll');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Staff routes are scoped to the authenticated employee only.
router.use(requireAuth, requireRole('staff'));

// GET /api/staff/profile - personal profile + compensation details
router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const profile = usersRepo.getProfile(req.user.id) || {};
    res.json({
      profile: {
        employeeId: req.user.employeeId,
        fullName: req.user.fullName,
        email: req.user.email,
        role: req.user.role,
        department: profile.department || 'Unassigned',
        position: profile.position || 'Employee',
        baseSalary: profile.base_salary || 0,
        currency: profile.currency || 'USD'
      }
    });
  })
);

// GET /api/staff/payroll - personal payment status + deposit ETA
router.get(
  '/payroll',
  asyncHandler(async (req, res) => {
    const records = payrollRepo.listForUser(req.user.id);
    const pending = records.filter((r) => r.status === 'pending');
    const nextEta = pending
      .map((r) => r.eta)
      .filter(Boolean)
      .sort()[0] || null;

    res.json({
      payroll: records,
      pendingCount: pending.length,
      nextEta
    });
  })
);

module.exports = router;
