/* HR dashboard controller. */

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

async function loadSummary() {
  const { summary } = await apiFetch('/api/hr/summary');
  document.getElementById('stat-liability').textContent = money(summary.outstandingLiability);
  document.getElementById('stat-disbursed').textContent = money(summary.completedDisbursement);
  document.getElementById('stat-total').textContent = summary.totalRecords;
  document.getElementById('stat-total-amount').textContent = money(summary.totalAmount) + ' total';
  document.getElementById('stat-pending-count').textContent = `${summary.pendingCount || 0} pending payment(s)`;
  document.getElementById('stat-paid-count').textContent = `${summary.paidCount || 0} completed payment(s)`;
}

async function loadPending() {
  const { registrations } = await apiFetch('/api/hr/registrations');
  const body = document.getElementById('pending-body');
  const empty = document.getElementById('pending-empty');
  body.innerHTML = '';
  empty.classList.toggle('hidden', registrations.length > 0);

  registrations.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-5 py-2 font-mono text-xs">${esc(r.employeeId)}</td>
      <td class="px-5 py-2">${esc(r.fullName)}</td>
      <td class="px-5 py-2 text-slate-500">${esc(r.email)}</td>
      <td class="px-5 py-2 capitalize">${esc(r.role)}</td>
      <td class="px-5 py-2 text-right space-x-2">
        <button data-action="approve" data-id="${r.id}"
          class="rounded-md bg-green-600 text-white text-xs px-3 py-1 hover:bg-green-700">Verify</button>
        <button data-action="reject" data-id="${r.id}"
          class="rounded-md bg-white border border-slate-300 text-slate-700 text-xs px-3 py-1 hover:bg-slate-50">Reject</button>
      </td>`;
    body.appendChild(tr);
  });

  body.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await apiFetch(`/api/hr/registrations/${btn.dataset.id}/${btn.dataset.action}`, {
          method: 'POST'
        });
        await Promise.all([loadPending(), loadStaff(), loadAudit()]);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

let staffCache = [];

async function loadStaff() {
  const { staff } = await apiFetch('/api/hr/staff');
  staffCache = staff.filter((s) => s.status === 'active');
  const select = document.getElementById('pay-user');
  select.innerHTML =
    '<option value="">Select employee…</option>' +
    staffCache
      .map((s) => `<option value="${s.id}">${esc(s.fullName)} (${esc(s.employeeId)})</option>`)
      .join('');
}

async function loadPayroll() {
  const { payroll } = await apiFetch('/api/hr/payroll');
  const body = document.getElementById('payroll-body');
  const empty = document.getElementById('payroll-empty');
  body.innerHTML = '';
  empty.classList.toggle('hidden', payroll.length > 0);

  payroll.forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-5 py-2">${esc(p.fullName)}<span class="block text-xs text-slate-400">${esc(p.employeeId)}</span></td>
      <td class="px-5 py-2 font-mono text-xs">${esc(p.period)}</td>
      <td class="px-5 py-2">${money(p.amount)}</td>
      <td class="px-5 py-2">${statusBadge(p.status)}</td>
      <td class="px-5 py-2 text-slate-500 text-xs">${p.eta ? esc(p.eta) : '—'}</td>
      <td class="px-5 py-2 text-right">
        ${p.status === 'pending'
          ? `<button data-pay="${p.id}" class="rounded-md bg-slate-900 text-white text-xs px-3 py-1 hover:bg-slate-800">Mark paid</button>`
          : '<span class="text-xs text-slate-400">—</span>'}
      </td>`;
    body.appendChild(tr);
  });

  body.querySelectorAll('button[data-pay]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await apiFetch(`/api/hr/payroll/${btn.dataset.pay}/pay`, { method: 'POST' });
        await Promise.all([loadPayroll(), loadSummary(), loadAudit()]);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

async function loadAudit() {
  const { audit } = await apiFetch('/api/hr/audit');
  const list = document.getElementById('audit-list');
  list.innerHTML = audit.length
    ? audit
        .map(
          (a) => `<li class="px-5 py-2 flex items-center justify-between gap-4">
            <span><span class="font-medium">${esc(a.actorName || 'system')}</span>
            <span class="text-slate-500"> ${esc(a.action)}</span>
            ${a.detail ? `<span class="text-slate-400"> — ${esc(a.detail)}</span>` : ''}</span>
            <span class="text-xs text-slate-400 whitespace-nowrap">${esc(a.createdAt)}</span>
          </li>`
        )
        .join('')
    : '<li class="px-5 py-6 text-sm text-slate-400">No activity yet.</li>';
}

document.getElementById('payroll-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('payroll-message');
  msg.textContent = '';
  const payload = {
    userId: Number(document.getElementById('pay-user').value),
    period: document.getElementById('pay-period').value,
    amount: Number(document.getElementById('pay-amount').value),
    eta: document.getElementById('pay-eta').value
  };

  if (!payload.userId || !payload.period || !payload.amount) {
    msg.className = 'ml-3 text-sm text-red-600';
    msg.textContent = 'Select an employee, period and amount.';
    return;
  }

  try {
    await apiFetch('/api/hr/payroll', { method: 'POST', body: JSON.stringify(payload) });
    msg.className = 'ml-3 text-sm text-green-600';
    msg.textContent = 'Payment cycle initiated.';
    e.target.reset();
    await Promise.all([loadPayroll(), loadSummary(), loadAudit()]);
  } catch (err) {
    msg.className = 'ml-3 text-sm text-red-600';
    msg.textContent = err.message;
  }
});

document.getElementById('logout').addEventListener('click', logout);

(async function init() {
  const user = await requireSession('hr');
  if (!user) return;
  document.getElementById('who').textContent = `${user.fullName} • ${user.email}`;
  await Promise.all([loadSummary(), loadPending(), loadStaff(), loadPayroll(), loadAudit()]);
})();
