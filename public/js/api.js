/* Shared front-end helpers. */

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.fields = data.fields;
    err.data = data;
    throw err;
  }
  return data;
}

// Wires every <button data-toggle-password data-target="#inputId"> in the page
// so users can reveal/mask what they are typing.
function initPasswordToggles() {
  document.querySelectorAll('button[data-toggle-password]').forEach((btn) => {
    const input = document.querySelector(btn.dataset.target);
    if (!input) return;
    const showIcon = btn.querySelector('[data-icon="show"]');
    const hideIcon = btn.querySelector('[data-icon="hide"]');
    btn.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      btn.setAttribute('title', reveal ? 'Hide password' : 'Show password');
      if (showIcon) showIcon.classList.toggle('hidden', reveal);
      if (hideIcon) hideIcon.classList.toggle('hidden', !reveal);
      input.focus();
    });
  });
}

// Keeps an OTP field numeric-only and caps its length.
function initOtpInputs() {
  document.querySelectorAll('input[data-otp]').forEach((input) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '');
    });
  });
}

// Development only: the server echoes the OTP when SMTP is not configured.
// Print it to the browser console and surface a small hint in the OTP panel.
function showDevOtp(code) {
  if (!code) return;
  console.log(
    '%c[DEV OTP] verification code: ' + code,
    'color:#b45309;font-weight:bold;font-size:14px'
  );
  const el = document.getElementById('otp-devhint');
  if (el) {
    el.textContent = 'Dev mode (SMTP not configured) — verification code: ' + code;
    el.classList.remove('hidden');
  }
}


function setMessage(el, message, type = 'error') {
  if (!el) return;
  el.textContent = message;
  el.className =
    'mt-4 rounded-md px-3 py-2 text-sm ' +
    (type === 'error'
      ? 'bg-red-50 text-red-700 border border-red-200'
      : 'bg-green-50 text-green-700 border border-green-200');
  el.classList.remove('hidden');
}

function clearMessage(el) {
  if (el) el.classList.add('hidden');
}

function money(value, currency = 'USD') {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { style: 'currency', currency });
}

// Client-side logout used by both dashboards.
async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  window.location.href = '/';
}

// Guard a dashboard page: ensures a session exists and the role matches,
// otherwise redirects to the appropriate landing page (front-end UX only;
// the server independently enforces RBAC on every API call).
async function requireSession(expectedRole) {
  try {
    const { user } = await apiFetch('/api/auth/me');
    if (expectedRole && user.role !== expectedRole) {
      window.location.href = user.role === 'hr' ? '/hr' : '/staff';
      return null;
    }
    return user;
  } catch {
    window.location.href = '/';
    return null;
  }
}
