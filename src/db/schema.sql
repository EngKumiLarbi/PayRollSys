-- ---------------------------------------------------------------------------
-- Corporate HR & Payroll Portal - Relational Schema (SQLite)
-- ---------------------------------------------------------------------------

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Users: employees and HR administrators share the same identity table.
-- Role is statically assigned at the DB level during onboarding (PRD 3 & 6).
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id     TEXT    NOT NULL UNIQUE,
  email           TEXT    NOT NULL UNIQUE,
  full_name       TEXT    NOT NULL,
  password_hash   TEXT    NOT NULL,
  password_salt   TEXT    NOT NULL,            -- unique per-user salt (PRD 4)
  email_verified  INTEGER NOT NULL DEFAULT 0,  -- set once the signup OTP is confirmed
  role            TEXT    NOT NULL CHECK (role IN ('hr', 'staff')),
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'active', 'suspended', 'rejected')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  verified_at     TEXT,
  verified_by     INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

-- Compensation / employment profile for each staff member.
CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  department    TEXT    NOT NULL DEFAULT 'Unassigned',
  position      TEXT    NOT NULL DEFAULT 'Employee',
  base_salary   REAL    NOT NULL DEFAULT 0,
  bank_account  TEXT,
  currency      TEXT    NOT NULL DEFAULT 'USD'
);

-- Payroll disbursement records (one row per user, per pay period).
CREATE TABLE IF NOT EXISTS payroll_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period        TEXT    NOT NULL,               -- e.g. '2026-10'
  amount        REAL    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'failed')),
  eta           TEXT,                            -- estimated time of arrival / deposit
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  paid_at       TEXT,
  UNIQUE (user_id, period)
);

CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll_records(status);
CREATE INDEX IF NOT EXISTS idx_payroll_user   ON payroll_records(user_id);

-- Audit trail for sensitive administrative actions.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id),
  action      TEXT    NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  detail      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);

-- One-time passwords for email verification ('email_verify') and login 2FA
-- ('login'). Codes are stored only as HMAC-SHA256(pepper) hashes.
CREATE TABLE IF NOT EXISTS otp_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose      TEXT    NOT NULL CHECK (purpose IN ('email_verify', 'login')),
  code_hash    TEXT    NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  consumed_at  TEXT,
  expires_at   TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_otp_user_purpose ON otp_codes(user_id, purpose);
