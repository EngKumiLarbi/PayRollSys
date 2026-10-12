/* First-time HR bootstrap page. Creates the initial HR administrator, then
   disables itself once one exists. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (data.fullName.trim().length < 2) errors.fullName = 'Enter a full name.';
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{3,19}$/.test(data.employeeId.trim()))
    errors.employeeId = 'Employee ID must be 4-20 characters (letters, digits, hyphens).';
  if (!EMAIL_RE.test(data.email.trim())) errors.email = 'Enter a valid email address.';
  const failed = Object.entries(pwRules).find(([, test]) => !test(data.password));
  if (failed) errors.password = 'Password does not meet the complexity requirements.';
  return errors;
}

function showClosedPanel() {
  document.getElementById('setup-panel').classList.add('hidden');
  document.getElementById('closed-panel').classList.remove('hidden');
}

const form = document.getElementById('setup-form');
const passwordInput = document.getElementById('password');

passwordInput.addEventListener('input', () => updatePasswordRules(passwordInput.value));

// Ask the server whether setup is still available (and if a token is required).
apiFetch('/api/setup/status')
  .then((status) => {
    if (!status.needsSetup) showClosedPanel();
    if (status.tokenRequired) document.getElementById('token-wrap').classList.remove('hidden');
  })
  .catch(() => showClosedPanel());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('message');
  const btn = document.getElementById('submit-btn');
  clearMessage(msg);
  ['fullName', 'employeeId', 'email', 'password'].forEach((f) => showFieldError(f, null));

  const data = {
    fullName: document.getElementById('fullName').value,
    employeeId: document.getElementById('employeeId').value,
    email: document.getElementById('email').value,
    password: passwordInput.value,
    setupToken: document.getElementById('setupToken').value
  };

  const errors = validateForm(data);
  if (Object.keys(errors).length) {
    Object.entries(errors).forEach(([k, v]) => showFieldError(k, v));
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating...';
  try {
    const res = await apiFetch('/api/setup', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    setMessage(msg, res.message + ' Redirecting to sign in...', 'success');
    setTimeout(() => (window.location.href = '/'), 1500);
  } catch (err) {
    if (err.status === 403) {
      showClosedPanel();
      return;
    }
    if (err.fields) Object.entries(err.fields).forEach(([k, v]) => showFieldError(k, v));
    setMessage(msg, err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create HR administrator';
  }
});

initPasswordToggles();
