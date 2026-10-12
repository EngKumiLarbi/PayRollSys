/* Login page: credentials -> email OTP (2FA or email verification). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let otpContext = { email: '', purpose: 'login', cooldownTimer: null };

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

function validateForm(email, password) {
  const errors = {};
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Password is required.';
  return errors;
}

function showOtpPanel(email, purpose, devCode) {
  otpContext.email = email;
  otpContext.purpose = purpose;

  document.getElementById('credentials-panel').classList.add('hidden');
  document.getElementById('otp-panel').classList.remove('hidden');
  document.getElementById('otp-email').textContent = email;
  document.getElementById('otp-title').textContent =
    purpose === 'email_verify' ? 'Confirm your email' : 'Two-step verification';
  document.getElementById('otp-resend-info').textContent = '';
  const hint = document.getElementById('otp-devhint');
  if (hint) hint.classList.add('hidden');
  document.getElementById('otp-code').value = '';
  clearMessage(document.getElementById('otp-message'));
  document.getElementById('otp-code').focus();
  showDevOtp(devCode);
  startCooldown(60);
}

function showCredentialsPanel() {
  document.getElementById('otp-panel').classList.add('hidden');
  document.getElementById('credentials-panel').classList.remove('hidden');
  if (otpContext.cooldownTimer) clearInterval(otpContext.cooldownTimer);
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

// Step 1: submit credentials.
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('message');
  const btn = document.getElementById('submit-btn');
  clearMessage(msg);

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  showFieldError('email', null);
  showFieldError('password', null);

  const errors = validateForm(email, password);
  if (Object.keys(errors).length) {
    Object.entries(errors).forEach(([k, v]) => showFieldError(k, v));
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (data.otpRequired) {
      showOtpPanel(data.email || email, data.otpPurpose || 'login', data.devOtp);
    } else {
      redirectByRole(data.user.role);
    }
  } catch (err) {
    const payload = err.data || {};
    if (payload.otpRequired) {
      showOtpPanel(payload.email || email, payload.otpPurpose || 'email_verify', payload.devOtp);
      // Email-not-verified path issues no code on login; fetch a fresh one.
      if (payload.otpPurpose === 'email_verify' && !payload.devOtp) {
        resendOtp(true);
      }
    } else {
      if (err.fields) Object.entries(err.fields).forEach(([k, v]) => showFieldError(k, v));
      setMessage(msg, err.message, 'error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});

// Step 2: submit the OTP.
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

  const endpoint = otpContext.purpose === 'email_verify'
    ? '/api/auth/verify-email'
    : '/api/auth/login/verify';

  try {
    const data = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ email: otpContext.email, code })
    });
    if (data.user) {
      redirectByRole(data.user.role);
    } else {
      // Email verified but still awaiting HR approval.
      showCredentialsPanel();
      setMessage(document.getElementById('message'), data.message, 'success');
    }
  } catch (err) {
    setMessage(msg, err.message, 'error');
    if (err.data && err.data.retryAfter) startCooldown(err.data.retryAfter);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify';
  }
});

document.getElementById('otp-resend').addEventListener('click', () => resendOtp(false));

async function resendOtp(silent) {
  const msg = document.getElementById('otp-message');
  if (!silent) clearMessage(msg);
  try {
    const data = await apiFetch('/api/auth/otp/resend', {
      method: 'POST',
      body: JSON.stringify({ email: otpContext.email, purpose: otpContext.purpose })
    });
    showDevOtp(data.devOtp);
    if (!silent) setMessage(msg, data.message, 'success');
    startCooldown(data.retryAfter || 60);
  } catch (err) {
    if (!silent) setMessage(msg, err.message, 'error');
    if (err.data && err.data.retryAfter) startCooldown(err.data.retryAfter);
  }
}

document.getElementById('otp-back').addEventListener('click', showCredentialsPanel);

function redirectByRole(role) {
  window.location.href = role === 'hr' ? '/hr' : '/staff';
}

initPasswordToggles();
initOtpInputs();
