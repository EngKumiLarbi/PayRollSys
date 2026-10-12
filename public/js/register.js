/* Registration page: instant client-side checks mirrored by the server,
   followed by email OTP verification. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let otpContext = { email: '', cooldownTimer: null };

function showFieldError(name, message) {
  const el = document.querySelector(`[data-error-for="${name}"]`);
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

const pwRules = {
  length: (p) => p.length >= 12,
  upper: (p) => /[A-Z]/.test(p),
  lower: (p) => /[a-z]/.test(p),
  digit: (p) => /[0-9]/.test(p),
  special: (p) => /[^A-Za-z0-9]/.test(p)
};

function updatePasswordRules(password) {
  Object.entries(pwRules).forEach(([rule, test]) => {
    const li = document.querySelector(`[data-rule="${rule}"]`);
    if (!li) return;
    const ok = test(password);
    li.className = ok ? 'text-green-600' : 'text-slate-500';
    li.textContent = (ok ? '✓ ' : '• ') + li.textContent.replace(/^[✓•]\s*/, '');
  });
}

function validateForm(data) {
  const errors = {};
  if (data.fullName.trim().length < 2) errors.fullName = 'Enter your full name.';
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{3,19}$/.test(data.employeeId.trim()))
    errors.employeeId = 'Employee ID must be 4-20 characters (letters, digits, hyphens).';
  if (!EMAIL_RE.test(data.email.trim())) errors.email = 'Enter a valid email address.';

  const failed = Object.entries(pwRules).find(([, test]) => !test(data.password));
  if (failed) errors.password = 'Password does not meet the complexity requirements.';
  return errors;
}

function startCooldown(seconds) {
  const btn = document.getElementById('otp-resend');
  const info = document.getElementById('otp-resend-info');
  if (otpContext.cooldownTimer) clearInterval(otpContext.cooldownTimer);
  if (!seconds || seconds <= 0) {
    btn.disabled = false;
    info.textContent = '';
    return;
  }
  let remaining = seconds;
  btn.disabled = true;
  const tick = () => {
    if (remaining <= 0) {
      clearInterval(otpContext.cooldownTimer);
      btn.disabled = false;
      info.textContent = '';
      return;
    }
    info.textContent = `You can request another code in ${remaining}s.`;
    remaining -= 1;
  };
  tick();
  otpContext.cooldownTimer = setInterval(tick, 1000);
}

function showOtpPanel(email, devCode) {
  otpContext.email = email;
  document.getElementById('register-panel').classList.add('hidden');
  document.getElementById('otp-panel').classList.remove('hidden');
  document.getElementById('otp-email').textContent = email;
  const hint = document.getElementById('otp-devhint');
  if (hint) hint.classList.add('hidden');
  document.getElementById('otp-code').value = '';
  clearMessage(document.getElementById('otp-message'));
  document.getElementById('otp-code').focus();
  showDevOtp(devCode);
  startCooldown(60);
}

const form = document.getElementById('register-form');
const passwordInput = document.getElementById('password');

passwordInput.addEventListener('input', () => updatePasswordRules(passwordInput.value));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('message');
  const btn = document.getElementById('submit-btn');
  clearMessage(msg);
  ['fullName', 'employeeId', 'email', 'password', 'role'].forEach((f) => showFieldError(f, null));

  const data = {
    fullName: document.getElementById('fullName').value,
    employeeId: document.getElementById('employeeId').value,
    email: document.getElementById('email').value,
    password: passwordInput.value,
    role: document.getElementById('role').value
  };

  const errors = validateForm(data);
  if (Object.keys(errors).length) {
    Object.entries(errors).forEach(([k, v]) => showFieldError(k, v));
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating account...';

  try {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    if (res.otpRequired) {
      showOtpPanel(res.user.email, res.devOtp);
    } else {
      setMessage(msg, res.message, 'success');
      form.reset();
      updatePasswordRules('');
    }
  } catch (err) {
    if (err.fields) Object.entries(err.fields).forEach(([k, v]) => showFieldError(k, v));
    setMessage(msg, err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
});

document.getElementById('otp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('otp-message');
  const btn = document.getElementById('otp-submit');
  const code = document.getElementById('otp-code').value.trim();
  clearMessage(msg);

  if (code.length < 4) {
    setMessage(msg, 'Enter the verification code.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying...';
  try {
    const res = await apiFetch('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email: otpContext.email, code })
    });
    setMessage(msg, res.message, 'success');
    document.getElementById('otp-submit').disabled = true;
    document.getElementById('otp-resend').disabled = true;
    if (otpContext.cooldownTimer) clearInterval(otpContext.cooldownTimer);
    document.getElementById('otp-resend-info').textContent =
      'You can now sign in once HR verifies your employment.';
  } catch (err) {
    setMessage(msg, err.message, 'error');
    if (err.data && err.data.retryAfter) startCooldown(err.data.retryAfter);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify email';
  }
});

document.getElementById('otp-resend').addEventListener('click', async () => {
  const msg = document.getElementById('otp-message');
  clearMessage(msg);
  try {
    const data = await apiFetch('/api/auth/otp/resend', {
      method: 'POST',
      body: JSON.stringify({ email: otpContext.email, purpose: 'email_verify' })
    });
    showDevOtp(data.devOtp);
    setMessage(msg, data.message, 'success');
    startCooldown(data.retryAfter || 60);
  } catch (err) {
    setMessage(msg, err.message, 'error');
    if (err.data && err.data.retryAfter) startCooldown(err.data.retryAfter);
  }
});

initPasswordToggles();
initOtpInputs();
