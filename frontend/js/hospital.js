/* BloodLink - Hospital Dashboard JS */

async function loadHospitalDashboard() {
  const user = protectRoute(['Hospital', 'Admin']);
  if (!user) return;

  try {
    const nameEl = document.getElementById('hospitalName');
    if (nameEl) nameEl.textContent = user.name || 'Hospital';

    const cityEl = document.getElementById('hospitalCity');
    if (cityEl) {
      const loc = [user.area, user.city].filter(Boolean).join(', ');
      cityEl.textContent = loc || 'Location set';
    }

    // Get active hospital requests
    const reqData = await API.get(`/requests?requester_id=${user.id}`);
    if (reqData.success) {
      const requests = reqData.requests || [];
      const activeEl = document.getElementById('activeReqCount');
      if (activeEl) activeEl.textContent = requests.filter(r => r.status === 'Active' || r.status === 'Pending').length;

      const fulfilledEl = document.getElementById('fulfilledReqCount');
      if (fulfilledEl) fulfilledEl.textContent = requests.filter(r => r.status === 'Fulfilled').length;

      const totalEl = document.getElementById('totalReqCount');
      if (totalEl) totalEl.textContent = requests.length;

      renderHospitalRequestsTable(requests, 'hospitalRequestsTable');
    }

    // Get available donors in same city
    const donorEl = document.getElementById('availDonorsCount');
    if (donorEl) {
      try {
        const donorData = await API.get(`/donors/search?city=${encodeURIComponent(user.city || '')}&availability=Available`);
        if (donorData.success) {
          donorEl.textContent = donorData.count;
        }
      } catch (e) {
        donorEl.textContent = '0';
      }
    }
  } catch (err) {
    console.error('Hospital dashboard load error:', err);
    const cityEl = document.getElementById('hospitalCity');
    if (cityEl && cityEl.textContent === 'Loading...') {
      cityEl.textContent = user.city || 'Location unavailable';
    }
  }
}

function renderHospitalRequestsTable(requests, tableId) {
  const tbody = document.getElementById(tableId);
  if (!tbody) return;

  if (!requests || requests.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 2rem; color: var(--text-muted, #64748b);">No blood requests created yet. Click "+ New Emergency Request" to post one.</td></tr>`;
    return;
  }

  tbody.innerHTML = requests.map(r => {
    let bankInfo = `<small style="display:block;color:var(--text-muted,#94a3b8);font-size:0.75rem;">No bank assigned (Donor fallback)</small>`;
    if (r.assigned_blood_bank_id) {
      if (r.bank_response === 'Fully Available') {
        bankInfo = `<small style="display:block;color:#16a34a;font-weight:600;font-size:0.75rem;">🏦 Bank: Fully Available</small>`;
      } else if (r.bank_response === 'Partially Available') {
        bankInfo = `<small style="display:block;color:#d97706;font-weight:600;font-size:0.75rem;">🏦 Bank: Partial (${r.confirmed_units || 0} confirmed)</small>`;
      } else if (r.bank_response === 'Unavailable') {
        bankInfo = `<small style="display:block;color:#dc2626;font-weight:600;font-size:0.75rem;">🏦 Bank: Unavailable (Donor fallback active)</small>`;
      } else if (r.bank_response === 'Unable to Respond') {
        bankInfo = `<small style="display:block;color:#dc2626;font-weight:600;font-size:0.75rem;">🏦 Bank: Unable to Respond</small>`;
      } else {
        bankInfo = `<small style="display:block;color:#2563eb;font-size:0.75rem;">🏦 Assigned to Bank ⏳ Awaiting Response</small>`;
      }
    }

    const fallbackBadge = r.donor_fallback_active
      ? `<span class="badge badge-warning" style="display:inline-block;margin-top:0.25rem;font-size:0.7rem;">⚡ Donor Fallback Active</span>`
      : '';

    // Can escalate/trigger donor fallback if bank has not confirmed all units and request is still open
    const canEscalate = r.status !== 'Fulfilled' && r.status !== 'Cancelled' && (!r.bank_response || r.bank_response === 'Partially Available' || r.bank_response === 'Unavailable');

    return `
    <tr>
      <td><strong>#${r.id}</strong></td>
      <td><span class="blood-pill" style="width:34px; height:34px; font-size:0.9rem;">${r.blood_group}</span></td>
      <td>
        ${r.units_required} Unit(s)
        ${r.confirmed_units > 0 ? `<small style="display:block;color:#16a34a;font-weight:600;">✓ ${r.confirmed_units} confirmed by bank</small>` : ''}
        ${r.remaining_units > 0 ? `<small style="display:block;color:#d97706;font-weight:600;">⏳ ${r.remaining_units} still needed</small>` : ''}
      </td>
      <td>${r.area || ''}, ${r.city || ''}</td>
      <td><span class="badge ${r.urgency === 'Emergency' ? 'badge-danger' : r.urgency === 'Urgent' ? 'badge-warning' : 'badge-info'}">${r.urgency}</span></td>
      <td>
        <span class="badge ${r.status === 'Fulfilled' ? 'badge-success' : r.status === 'Active' ? 'badge-primary' : 'badge-warning'}">${r.status}</span>
        ${bankInfo}
        ${fallbackBadge}
      </td>
      <td>
        <div style="display:flex; flex-direction:column; gap:0.35rem;">
          ${r.status !== 'Fulfilled' ? `<button onclick="markRequestFulfilled(${r.id})" class="btn btn-success btn-sm">✓ Fulfilled</button>` : `<span style="color:var(--success, #16a34a); font-weight:600; font-size:0.85rem;">✓ Completed</span>`}
          ${canEscalate ? `<button onclick="triggerDonorFallback(${r.id})" class="btn btn-outline btn-sm" style="font-size:0.75rem; padding:0.25rem 0.5rem;" title="Notify nearby donors directly">⚡ Alert Donors</button>` : ''}
        </div>
      </td>
    </tr>
  `}).join('');
}

async function markRequestFulfilled(requestId) {
  if (!confirm(`Are you sure you want to mark Request #${requestId} as Fulfilled?`)) return;

  try {
    const data = await API.put(`/requests/${requestId}`, { status: 'Fulfilled' });
    if (data.success) {
      alert(`Request #${requestId} has been marked as Fulfilled!`);
      window.location.reload();
    }
  } catch (err) {
    alert(err.message || 'Failed to update request status.');
  }
}

async function triggerDonorFallback(requestId) {
  if (!confirm(`Trigger emergency donor alerts for Request #${requestId}? This will notify matching donors in your area.`)) return;

  try {
    const data = await API.post(`/requests/${requestId}/trigger-donor-fallback`, {});
    if (data.success) {
      alert(data.message || 'Donor fallback activated successfully!');
      window.location.reload();
    }
  } catch (err) {
    alert(err.message || 'Failed to trigger donor fallback.');
  }
}

function initCreateRequestForm() {
  const form = document.getElementById('createRequestForm');
  if (!form) return;

  const user = protectRoute(['Hospital', 'Blood Seeker', 'Admin']);
  if (!user) return;

  // Pre-fill hospital name if user is Hospital
  const hospInput = document.getElementById('hospitalNameInput');
  const cityInput = document.getElementById('cityInput');
  const areaInput = document.getElementById('areaInput');

  if (user.role === 'Hospital') {
    if (hospInput && !hospInput.value) hospInput.value = user.name;
  }
  if (cityInput && !cityInput.value) cityInput.value = user.city || '';
  if (areaInput && !areaInput.value) areaInput.value = user.area || '';

  // Adapt sidebar and breadcrumbs for Seeker vs Hospital
  if (user.role === 'Blood Seeker') {
    const roleLabel = document.querySelector('.sidebar-role');
    if (roleLabel) roleLabel.textContent = 'Blood Seeker Portal';
    const profileName = document.querySelector('.sidebar-name');
    if (profileName) profileName.textContent = user.name || 'Blood Seeker';

    const dashLink = document.querySelector('.sidebar-nav a[href="/hospital/dashboard.html"]');
    if (dashLink) {
      dashLink.href = '/seeker/dashboard.html';
      dashLink.innerHTML = '<span class="icon">📊</span> My Dashboard';
    }
    const reqLink = document.querySelector('.sidebar-nav a[href="/hospital/requests.html"]');
    if (reqLink) {
      reqLink.href = '/seeker/dashboard.html';
      reqLink.innerHTML = '<span class="icon">📋</span> My Requests';
    }
    const donorLink = document.querySelector('.sidebar-nav a[href="/hospital/donors.html"]');
    if (donorLink) {
      donorLink.href = '/donor/search.html';
      donorLink.innerHTML = '<span class="icon">🔍</span> Find Donors';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert('alertContainer');

    const payload = {
      hospital_name: document.getElementById('hospitalNameInput').value.trim(),
      blood_group: document.getElementById('bloodGroupInput').value,
      units_required: parseInt(document.getElementById('unitsInput').value) || 1,
      city: document.getElementById('cityInput').value.trim(),
      area: document.getElementById('areaInput').value.trim(),
      urgency: document.getElementById('urgencyInput').value,
      required_date: document.getElementById('requiredDateInput').value,
      message: document.getElementById('messageInput')?.value.trim() || ''
    };

    try {
      const data = await API.post('/requests', payload);
      if (data.success) {
        let successMsg = '✅ Blood Request created successfully!';
        if (data.assignedBank) {
          successMsg += ` Assigned to <strong>${data.assignedBank.name}</strong> (~${data.assignedBank.distance_km} km away). Blood Bank is reviewing stock.`;
        } else {
          successMsg += ' No blood bank had immediate stock; matching local donors have been alerted.';
        }
        showAlert('alertContainer', successMsg, 'success');
        form.reset();
        setTimeout(() => {
          if (user.role === 'Blood Seeker') {
            window.location.href = '/seeker/dashboard.html';
          } else {
            window.location.href = '/hospital/dashboard.html';
          }
        }, 2000);
      }
    } catch (err) {
      showAlert('alertContainer', err.message || 'Failed to create request.');
    }
  });
}

