/* BloodLink - Requests & Match Management JS */

let selectedDonorForModal = null;

function openRequestModal(donorId, donorName, bloodGroup) {
  const user = API.getUser();
  if (!user) {
    alert('Please login to send a blood donation request.');
    window.location.href = '/login.html';
    return;
  }

  selectedDonorForModal = { id: donorId, name: donorName, bloodGroup };
  
  const modal = document.getElementById('requestModal');
  if (!modal) {
    // If no modal present on current page, redirect to create request or directly send standard request
    sendDirectDonationRequest(donorId, donorName, bloodGroup);
    return;
  }

  document.getElementById('modalDonorName').textContent = donorName;
  document.getElementById('modalDonorBg').textContent = bloodGroup;
  modal.style.display = 'flex';
}

function closeRequestModal() {
  const modal = document.getElementById('requestModal');
  if (modal) modal.style.display = 'none';
}

async function sendDirectDonationRequest(donorId, donorName, bloodGroup) {
  const user = API.getUser();
  if (!user) {
    alert('Please login to send a blood request.');
    window.location.href = '/login.html';
    return;
  }

  const hospitalName = prompt(`Enter Hospital Name for ${bloodGroup} blood requirement:`, 'City Hospital');
  if (!hospitalName) return;

  try {
    // 1. Create a blood request
    const reqRes = await API.post('/requests', {
      hospital_name: hospitalName,
      blood_group: bloodGroup,
      units_required: 1,
      city: user.city || 'Local',
      area: user.area || 'Local Area',
      urgency: 'Urgent',
      message: `Direct request sent to ${donorName}`
    });

    if (reqRes.success && reqRes.requestId) {
      // 2. Send donation request to selected donor
      const donRes = await API.post('/requests/donation-request', {
        blood_request_id: reqRes.requestId,
        donor_id: donorId
      });

      if (donRes.success) {
        alert(`Donation request successfully sent to ${donorName}!`);
      }
    }
  } catch (err) {
    alert(err.message || 'Failed to send request.');
  }
}

// Load incoming donation requests for Donor
async function loadDonorRequestsList() {
  const user = protectRoute(['Donor']);
  if (!user) return;

  const container = document.getElementById('donorRequestsList');
  if (!container) return;

  try {
    const data = await API.get('/requests/donor/my-requests');
    if (data.success) {
      const requests = data.donationRequests;

      if (requests.length === 0) {
        container.innerHTML = `<div class="card text-center"><p class="text-muted">No donation requests received yet.</p></div>`;
        return;
      }

      container.innerHTML = requests.map(r => `
        <div class="card" style="margin-bottom: 1rem; border-left: 5px solid ${r.donation_status === 'Accepted' ? 'var(--success)' : r.donation_status === 'Declined' ? '#dc3545' : 'var(--primary)'}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
            <div>
              <h3 style="font-size: 1.1rem; margin-bottom: 0.2rem;">🏥 ${r.hospital_name}</h3>
              <p style="font-size: 0.85rem; color: var(--text-muted);">Requested by: ${r.requester_name} (${r.requester_phone})</p>
            </div>
            <div class="blood-pill" style="width: 36px; height: 36px; font-size: 0.95rem;">${r.blood_group}</div>
          </div>
          <div style="font-size: 0.9rem; margin-bottom: 1rem;">
            <p><strong>Location:</strong> ${r.area}, ${r.city}</p>
            <p><strong>Units Needed:</strong> ${r.units_required} Unit(s)</p>
            <p><strong>Urgency:</strong> <span class="badge ${r.urgency === 'Emergency' ? 'badge-danger' : 'badge-warning'}">${r.urgency}</span></p>
            <p><strong>Status:</strong> <span class="badge ${r.donation_status === 'Accepted' ? 'badge-success' : r.donation_status === 'Declined' ? 'badge-danger' : 'badge-warning'}">${r.donation_status}</span></p>
          </div>
          ${r.donation_status === 'Pending' ? `
            <div style="display: flex; gap: 0.5rem;">
              <button onclick="respondToRequest(${r.donation_req_id}, 'Accepted')" class="btn btn-success btn-sm" style="flex: 1;">
                ✓ Accept Request
              </button>
              <button onclick="respondToRequest(${r.donation_req_id}, 'Declined')" class="btn btn-danger btn-sm" style="flex: 1;">
                ✕ Decline
              </button>
            </div>
          ` : `
            <p style="font-size: 0.85rem; color: var(--text-muted);">You ${r.donation_status.toLowerCase()} this request on ${new Date(r.request_sent_date).toLocaleDateString()}.</p>
          `}
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Error loading donor requests list:', err);
  }
}

async function respondToRequest(donationReqId, status) {
  if (!confirm(`Are you sure you want to ${status.toLowerCase()} this blood donation request?`)) return;

  try {
    const data = await API.put(`/requests/donation-request/${donationReqId}/respond`, { status });
    if (data.success) {
      alert(`Request ${status.toLowerCase()}!`);
      loadDonorRequestsList();
    }
  } catch (err) {
    alert(err.message || 'Failed to respond to request.');
  }
}
