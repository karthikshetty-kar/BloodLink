/* BloodLink - Admin Panel JS */

async function loadAdminDashboard() {
  const user = protectRoute(['Admin']);
  if (!user) return;

  try {
    const data = await API.get('/admin/statistics');
    if (data.success && data.statistics) {
      const s = data.statistics;
      if (document.getElementById('statTotalUsers')) document.getElementById('statTotalUsers').textContent = s.totalUsers;
      if (document.getElementById('statTotalDonors')) document.getElementById('statTotalDonors').textContent = s.totalDonors;
      if (document.getElementById('statAvailDonors')) document.getElementById('statAvailDonors').textContent = s.availableDonors || 0;
      if (document.getElementById('statTotalHospitals')) document.getElementById('statTotalHospitals').textContent = s.totalHospitals;
      if (document.getElementById('statActiveRequests')) document.getElementById('statActiveRequests').textContent = s.activeRequests;
      if (document.getElementById('statEmergencyRequests')) document.getElementById('statEmergencyRequests').textContent = s.emergencyRequests || 0;
      if (document.getElementById('statCompletedRequests')) document.getElementById('statCompletedRequests').textContent = s.completedRequests;

      renderBloodGroupChart(s.bloodGroupDistribution);
    }
  } catch (err) {
    console.error('Admin stats error:', err);
  }
}

function renderBloodGroupChart(distribution) {
  const container = document.getElementById('bloodGroupChartContainer');
  if (!container || !distribution) return;

  const maxCount = Math.max(...Object.values(distribution), 1);

  const rows = Object.entries(distribution).map(([group, count]) => {
    const pct = Math.round((count / maxCount) * 100);
    return `
      <div class="chart-row">
        <div class="chart-label">${group}</div>
        <div class="chart-bar-bg">
          <div class="chart-bar-fill" style="width: ${pct}%;"></div>
        </div>
        <div class="chart-val">${count}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <h3 style="margin-bottom: 1rem;">🧪 Donors Blood Group Distribution</h3>
    <div class="chart-container">
      ${rows}
    </div>
  `;
}

async function loadAdminUsersTable() {
  const user = protectRoute(['Admin']);
  if (!user) return;

  const tbody = document.getElementById('adminUsersTableBody');
  const searchInput = document.getElementById('userSearchInput');
  const roleFilter = document.getElementById('roleFilterSelect');

  async function fetchUsers() {
    if (!tbody) return;
    const search = searchInput?.value.trim() || '';
    const role = roleFilter?.value || '';

    try {
      const data = await API.get(`/admin/users?search=${encodeURIComponent(search)}&role=${encodeURIComponent(role)}`);
      if (data.success) {
        if (data.users.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" class="text-center">No users found.</td></tr>`;
          return;
        }

        tbody.innerHTML = data.users.map(u => `
          <tr>
            <td>#${u.id}</td>
            <td><strong>${u.name}</strong></td>
            <td>${u.email}</td>
            <td>${u.phone}</td>
            <td><span class="badge badge-primary">${u.role}</span></td>
            <td>${u.area}, ${u.city}</td>
            <td><span class="badge ${u.status === 'Active' ? 'badge-success' : 'badge-danger'}">${u.status}</span></td>
            <td>
              ${u.role !== 'Admin' ? `
                <button onclick="toggleUserStatus(${u.id}, '${u.status === 'Active' ? 'Disabled' : 'Active'}')" class="btn btn-sm ${u.status === 'Active' ? 'btn-danger' : 'btn-success'}">
                  ${u.status === 'Active' ? 'Disable' : 'Enable'}
                </button>
              ` : '<span class="text-muted">Protected</span>'}
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  }

  if (searchInput) searchInput.addEventListener('input', fetchUsers);
  if (roleFilter) roleFilter.addEventListener('change', fetchUsers);

  fetchUsers();
}

async function toggleUserStatus(userId, newStatus) {
  if (!confirm(`Are you sure you want to set this user status to ${newStatus}?`)) return;

  try {
    const data = await API.put(`/admin/users/${userId}/status`, { status: newStatus });
    if (data.success) {
      alert(`User status changed to ${newStatus}.`);
      loadAdminUsersTable();
    }
  } catch (err) {
    alert(err.message || 'Failed to update user status.');
  }
}

async function loadAdminDonorsTable() {
  const user = protectRoute(['Admin']);
  if (!user) return;

  const tbody = document.getElementById('adminDonorsTableBody');
  if (!tbody) return;

  try {
    const data = await API.get('/admin/donors');
    if (data.success) {
      if (data.donors.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">No donors found.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.donors.map(d => `
        <tr>
          <td>#${d.id}</td>
          <td><strong>${d.name}</strong></td>
          <td><span class="blood-pill" style="width:30px; height:30px; font-size:0.85rem;">${d.blood_group}</span></td>
          <td>${d.phone}</td>
          <td>${d.area}, ${d.city}</td>
          <td><span class="badge ${d.availability === 'Available' ? 'badge-success' : 'badge-danger'}">${d.availability}</span></td>
          <td>${d.last_donation_date || 'N/A'}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Error loading admin donors:', err);
  }
}

async function loadAdminHospitalsTable() {
  const user = protectRoute(['Admin']);
  if (!user) return;

  const tbody = document.getElementById('adminHospitalsTableBody');
  if (!tbody) return;

  try {
    const data = await API.get('/admin/hospitals');
    if (data.success) {
      if (data.hospitals.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">No registered hospitals found.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.hospitals.map(h => `
        <tr>
          <td>#${h.id}</td>
          <td><strong>${h.name}</strong></td>
          <td>${h.email}</td>
          <td>${h.phone}</td>
          <td>${h.area}, ${h.city}</td>
          <td><span class="badge ${h.status === 'Active' ? 'badge-success' : 'badge-danger'}">${h.status}</span></td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Error loading admin hospitals:', err);
  }
}

async function loadAdminRequestsTable() {
  const user = protectRoute(['Admin']);
  if (!user) return;

  const tbody = document.getElementById('adminRequestsTableBody');
  if (!tbody) return;

  try {
    const data = await API.get('/admin/requests');
    if (data.success) {
      if (data.requests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">No blood requests found.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.requests.map(r => `
        <tr>
          <td>#${r.id}</td>
          <td><strong>${r.hospital_name}</strong></td>
          <td><span class="blood-pill" style="width:30px; height:30px; font-size:0.85rem;">${r.blood_group}</span></td>
          <td>${r.units_required} Unit(s)</td>
          <td>${r.area}, ${r.city}</td>
          <td><span class="badge ${r.urgency === 'Emergency' ? 'badge-emergency' : r.urgency === 'Urgent' ? 'badge-warning' : 'badge-info'}">${r.urgency}</span></td>
          <td><span class="badge ${r.status === 'Fulfilled' ? 'badge-success' : r.status === 'Active' ? 'badge-primary' : 'badge-warning'}">${r.status}</span></td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Error loading admin requests:', err);
  }
}
