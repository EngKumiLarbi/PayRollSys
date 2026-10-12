# Corporate HR & Payroll Portal

Authentication & access-control subsystem implementing the PRD: corporate identity
binding, HR account verification, salt + pepper + adaptive password hashing,
dual-layer validation, role-based dashboards, and hardened short-lived sessions.
Adds SMTP-delivered email OTPs for signup verification and login two-factor auth.

## Tech stack

| Layer     | Choice                                              |
|-----------|-----------------------------------------------------|
| Frontend  | HTML5, Tailwind CSS (CDN), Vanilla JavaScript       |
| Backend   | Node.js + Express                                   |
| Database  | SQLite (local, isolated) via Node's built-in `node:sqlite` (no native build) |
| Sessions  | JWT in `HttpOnly` + `SameSite=Strict` cookies        |
| Hashing   | bcrypt (adaptive) over HMAC-SHA256(password+salt) with server pepper |
| Email OTP | Nodemailer (SMTP) for email verification + login 2FA |

## Quick start

Requires **Node.js >= 22.5** (uses the built-in `node:sqlite` driver).

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# edit .env and set strong JWT_SECRET and PEPPER values
npm run seed              # optional demo accounts
npm start                 # http://localhost:3000
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # PEPPER
```

### SMTP & OTP

OTP is on by default (`OTP_ENABLED=true`). Configure delivery in `.env`:

```
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-user
SMTP_PASS=your-password
SMTP_FROM="HR Payroll Portal <no-reply@company.com>"
```

If `SMTP_HOST` is left blank (the development default), OTP codes are printed
to the server console **and echoed to the browser**: the API returns a `devOtp`
field that the login/registration pages log to the browser console and show as
an on-page hint. This echo is hard-disabled in production and whenever
`SMTP_HOST` is set (`OTP_DEV_ECHO=false` also turns it off).

For Gmail, enable 2-Step Verification and create an **App Password**
(https://myaccount.google.com/apppasswords), then use `smtp.gmail.com`, port
`587`, and the 16-character app password (spaces removed) as `SMTP_PASS`.

Two flows use OTP:

- **Signup** — after registering, the user confirms their email with a
  6-digit code (`POST /api/auth/verify-email`). HR approval is still required.
- **Sign-in** — after correct credentials, a second code
  (`POST /api/auth/login/verify`) must be entered before a session is issued.

Codes expire after 10 minutes, allow 5 attempts, and resend is throttled
(`OTP_*` variables in `.env.example`).

All password fields include a show/hide toggle for usability.

### Demo accounts (after `npm run seed`)

| Role  | Email            | Password          |
|-------|------------------|-------------------|
| HR    | hr@company.com   | `SuperSecure#2026` |
| Staff | jane@company.com | `Employee#2026!`   |
| Staff | mike@company.com | `Pending#2026!` (awaiting HR verification) |

> Seeded accounts are already email-verified, but **sign-in still asks for an
> OTP**. With `SMTP_HOST` blank the code is printed to the server console and
> shown in the browser — watch the terminal running `npm start`.

## Verify the build

```bash
npm run smoke
```

Boots the real server on an ephemeral port and asserts the full flow:
register → email OTP verification → blocked login until verified → HR approval →
credential login → login OTP 2FA → RBAC denial → payroll cycle → staff ETA →
disbursement → liability summary.

## Project structure

```
server.js                     app entrypoint
src/
  app.js                      Express app, security headers, static + API wiring
  config/index.js             env config (JWT, pepper, cookie, DB path)
  db/
    schema.sql                relational schema
    index.js                  SQLite connection (node:sqlite) + schema bootstrap + migrations
    users.js / payroll.js / audit.js / otp.js   data-access layer
  middleware/
    auth.js                   requireAuth (live DB re-check) + requireRole (RBAC)
    errorHandler.js           async wrapper, 404, centralized errors
  routes/
    auth.js                   register / verify-email / login / login-verify / otp-resend / logout / me
    setup.js                  first-run HR bootstrap (/setup, self-disables once an HR exists)
    hr.js                     verification, staff, payroll, summary, audit
    staff.js                  personal profile + payroll
  services/
    password.js               salt + pepper + bcrypt
    token.js                  JWT sign/verify + hardened cookie helpers
    otp.js                    OTP generation, HMAC hashing, throttling
    mailer.js                 SMTP transport (console fallback in dev)
  utils/validators.js         back-end verification + sanitization
public/                       login, register, HR & staff dashboards
scripts/seed.js               demo data
scripts/create-admin.js       bootstrap the first HR admin on production
scripts/smoke-test.js         end-to-end test
render.yaml                   Render Blueprint (web service + disk + env)
```

## How the PRD maps to the code

- **Identity binding & verification (PRD 3)** — `routes/auth.js` registration
  creates `status='pending'` and emails an OTP (`services/otp.js` +
  `services/mailer.js`) to confirm the address;
  `/api/hr/registrations/:id/approve` then activates it.
- **Login 2FA** — `/api/auth/login` verifies the password and sends an OTP;
  no session cookie is issued until `/api/auth/login/verify` succeeds.
- **Salt + pepper + hashing (PRD 4)** — `services/password.js`. Unique
  per-user salt is stored in `users.password_salt`; the pepper stays only in
  `.env`; bcrypt cost 12.
- **Front-end vs back-end validation (PRD 5)** — instant checks in
  `public/js/*.js`; authoritative re-validation + sanitization in
  `utils/validators.js` on every request.
- **RBAC (PRD 6)** — `middleware/auth.js` `requireRole('hr')` /
  `requireRole('staff')`; least-privilege dashboards.
- **Session hardening (PRD 7)** — `services/token.js` sets `HttpOnly`,
  `SameSite=Strict`, `Secure` (production) cookies; JWT default lifetime 15m.

## Production notes

- Set `NODE_ENV=production` — the app refuses to boot without `JWT_SECRET`
  and `PEPPER`, and enables `Secure` cookies + HSTS.
- Terminate TLS at the proxy (reverse proxy / load balancer); `trust proxy`
  is enabled so secure cookies work behind HTTPS.
- The SQLite file under `data/` holds corporate records and is git-ignored.
- **First HR admin** — open `/setup` to create the initial HR administrator. The
  route (and the login page link to it) is available only until one active HR
  account exists. Set `SETUP_TOKEN` to additionally require a shared secret.

## Deploy: GitHub → Render

1. **Push to GitHub** (see commands below).
2. **Render → New → Blueprint**, pick the repo. `render.yaml` provisions:
   - a Node web service (`npm ci` → `npm start`, health check `/health`)
   - generated `JWT_SECRET` and `PEPPER`
   - a 1 GB persistent disk mounted at `/var/data` (SQLite lives there)
   - SMTP env vars for Gmail (`SMTP_PASS` is a secret you set in the dashboard)
3. When prompted, paste `SMTP_PASS` = the 16-char Gmail app password
   (**no spaces**). `JWT_SECRET`/`PEPPER` are generated automatically.
4. Create your first HR admin. Two options:

   **a) First-run setup page (easiest)** — open `https://<your-app>.onrender.com/setup`
   and fill in the form. This page only works while no active HR account exists,
   then disables itself. Set an optional `SETUP_TOKEN` env var to require a shared
   secret on that form.

   **b) Render Shell** — run once:

   ```bash
   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='StrongPass#2026' npm run create-admin
   ```

   Do **not** run `npm run seed` in production (it ships public demo passwords).

### Render specifics

- **Node version** — `.node-version` pins Node 24 (required: the app uses the
  built-in `node:sqlite`).
- **Persistent disk** — Render disks require a paid instance type. On the free
  tier the filesystem is ephemeral, so either attach a disk (recommended) or
  accept that the SQLite database resets on every deploy/restart.
- **Email on the free tier** — Render blocks outbound SMTP ports `25`/`465`/`587`
  on free web services, so Gmail/SMTP OTP emails **cannot be sent** from a free
  service. The app fails fast (no more 502) and prints the OTP to the service
  **Logs** as a `DEV OTP` block so you can still sign in. For real delivery,
  either upgrade to any paid instance (SMTP works) or switch the mailer to an
  HTTPS email API (e.g. Resend/SendGrid).
- **Set `SMTP_PASS` only in Render** — never commit it. It is already git-ignored
  locally via `.env`.

### Push commands

```bash
git init
git add -A
git commit -m "Corporate HR & Payroll Portal"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
