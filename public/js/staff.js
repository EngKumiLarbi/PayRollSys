/* Staff dashboard controller. */

function statusBadge(status) {
  const map = {
    paid: 'bg-green-50 text-green-700 border-green-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    failed: 'bg-red-50 text-red-700 border-red-200'
  };
  const cls = map[status] || 'bg-slate-50 text-slate-600 border-slate-200';
  return `<span class="inline-block rounded-full border px-2 py-0.5 text-xs capitalize ${cls}">${status}</span>`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

async function loadProfile() {
  const { profile } = await apiFetch('/api/staff/profile');
  document.getElementById('p-name').textContent = profile.fullName;
  document.getElementById('p-empid').textContent = profile.employeeId;
  document.getElementById('p-email').textContent = profile.email;
  document.getElementById('p-dept').textContent = profile.department;
  document.getElementById('p-pos').textContent = profile.position;
  document.getElementById('p-currency').textContent = profile.currency;
  document.getElementById('stat-salary').textContent = money(profile.baseSalary, profile.currency);
}

async function loadPayroll() {
  const data = await apiFetch('/api/staff/payroll');
  document.getElementById('stat-pending').textContent = data.pendingCount;
  document.getElementById('stat-eta').textContent = data.nextEta || '—';

  const body = document.getElementById('payroll-body');
  const empty = document.getElementById('payroll-empty');
  body.innerHTML = '';
  empty.classList.toggle('hidden', data.payroll.length > 0);

  data.payroll.forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-5 py-2 font-mono text-xs">${esc(p.period)}</td>
      <td class="px-5 py-2">${money(p.amount)}</td>
      <td class="px-5 py-2">${statusBadge(p.status)}</td>
      <td class="px-5 py-2 text-slate-500 text-xs">${p.eta ? esc(p.eta) : '—'}</td>
      <td class="px-5 py-2 text-slate-500 text-xs">${p.paidAt ? esc(p.paidAt) : '—'}</td>`;
    body.appendChild(tr);
  });
}

document.getElementById('logout').addEventListener('click', logout);

(async function init() {
  const user = await requireSession('staff');
  if (!user) return;
  document.getElementById('who').textContent = `${user.fullName} • ${user.email}`;
  await Promise.all([loadProfile(), loadPayroll()]);
})();
