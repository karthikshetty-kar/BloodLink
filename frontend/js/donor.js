/* BloodLink - Donor Management JS */

let leafletMapInstance = null;

async function loadDonorDashboard() {
  const user = protectRoute(['Donor']);
  if (!user) return;

  try {
    const data = await API.get('/auth/me');
    if (!data.success || !data.user.donor) return;

    const donor = data.user.donor;

    // Update banner
    document.getElementById('donorName').textContent = data.user.name;
    document.getElementById('donorBg').textContent = donor.blood_group;
    document.getElementById('donorCity').textContent = `${donor.area}, ${donor.city}`;
    document.getElementById('donorLastDate').textContent = donor.last_donation_date || 'Not specified';

    // Feature 3: Availability Badge & Toggle
    const availBtn = document.getElementById('toggleAvailBtn');
    if (availBtn) {
      availBtn.textContent = donor.availability;
      availBtn.className = `btn btn-sm ${donor.availability === 'Available' ? 'btn-success' : 'btn-secondary'}`;
      availBtn.onclick = () => toggleDonorAvailability(donor.availability === 'Available' ? 'Not Available' : 'Available');
    }

    // Feature 4: Render Eligibility Reminder & Medical Disclaimer Banner
    renderDonorEligibilityBanner(donor.eligibility);

    // Fetch incoming donation requests
    const reqData = await API.get('/requests/donor/my-requests');
    if (reqData.success) {
      document.getElementById('incomingCount').textContent = reqData.donationRequests.filter(r => r.donation_status === 'Pending').length;
      document.getElementById('acceptedCount').textContent = reqData.donationRequests.filter(r => r.donation_status === 'Accepted').length;
      document.getElementById('totalHistoryCount').textContent = reqData.donationRequests.length;
    }

    // Fetch unread notifications
    const notifData = await API.get('/notifications');
    if (notifData.success) {
      document.getElementById('notifCount').textContent = notifData.unreadCount;
    }

  } catch (err) {
    console.error('Error loading donor dashboard:', err);
  }
}

// Feature 4: Donor Eligibility Banner Renderer
function renderDonorEligibilityBanner(eligibility) {
  const container = document.getElementById('eligibilityBannerContainer');
  if (!container || !eligibility) return;

  const isEligible = eligibility.is_eligible;
  const statusMsg = eligibility.status_text;

  container.innerHTML = `
    <div class="card" style="margin-bottom: 2rem; border-left: 6px solid ${isEligible ? 'var(--success)' : 'var(--warning)'}; background: #ffffff;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h4 style="display: flex; align-items: center; gap: 0.5rem; color: ${isEligible ? 'var(--success)' : 'var(--warning)'};">
            ${isEligible ? '✅ Ready to Donate Blood' : '⏳ Donation Interval Countdown'}
          </h4>
          <p style="font-size: 1.05rem; font-weight: 700; margin-top: 0.25rem;">${statusMsg}</p>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.2rem;">
            Last Recorded Donation: <strong>${eligibility.last_donation_date || 'None on record'}</strong> 
            ${eligibility.next_eligible_date ? `| Next Eligible: <strong>${eligibility.next_eligible_date}</strong>` : ''}
          </p>
        </div>
        <div>
          <span class="badge ${isEligible ? 'badge-success' : 'badge-warning'}" style="font-size: 0.85rem; padding: 0.4rem 0.8rem;">
            ${isEligible ? 'Eligible Now' : 'Pending Interval'}
          </span>
        </div>
      </div>

      <!-- Mandatory Medical Disclaimer -->
      <div class="disclaimer-banner">
        <span style="font-size: 1.2rem;">⚠️</span>
        <div>
          <strong>Important Disclaimer:</strong> This donation eligibility status is an application reminder based on a standard 90-day interval following your last recorded donation date. It does not constitute medical advice. Please consult a qualified medical professional or certified blood bank before donating blood.
        </div>
      </div>
    </div>
  `;
}

// Feature 3: Donor Availability Switcher
async function toggleDonorAvailability(newStatus) {
  try {
    const data = await API.put('/donors/profile', { availability: newStatus });
    if (data.success) {
      alert(`Availability status updated to: ${newStatus}`);
      window.location.reload();
    }
  } catch (err) {
    alert(err.message || 'Failed to update availability.');
  }
}

async function loadDonorProfileForm() {
  const user = protectRoute(['Donor']);
  if (!user) return;

  try {
    const data = await API.get('/auth/me');
    if (data.success && data.user) {
      const u = data.user;
      const d = data.user.donor || {};

      document.getElementById('profileName').value = u.name || '';
      document.getElementById('profilePhone').value = u.phone || '';
      document.getElementById('profileCity').value = u.city || '';
      document.getElementById('profileArea').value = u.area || '';
      document.getElementById('profileBg').value = d.blood_group || 'O+';
      document.getElementById('profileAvail').value = d.availability || 'Available';
      document.getElementById('profileLastDate').value = d.last_donation_date || '';

      if (d.eligibility) {
        renderDonorEligibilityBanner(d.eligibility);
      }
    }
  } catch (err) {
    console.error('Error loading profile form:', err);
  }

  const form = document.getElementById('donorProfileForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert('alertContainer');

      const payload = {
        name: document.getElementById('profileName').value.trim(),
        phone: document.getElementById('profilePhone').value.trim(),
        city: document.getElementById('profileCity').value.trim(),
        area: document.getElementById('profileArea').value.trim(),
        blood_group: document.getElementById('profileBg').value,
        availability: document.getElementById('profileAvail').value,
        last_donation_date: document.getElementById('profileLastDate').value
      };

      try {
        const res = await API.put('/donors/profile', payload);
        if (res.success) {
          showAlert('alertContainer', 'Profile updated successfully!', 'success');
          if (res.user && res.user.donor && res.user.donor.eligibility) {
            renderDonorEligibilityBanner(res.user.donor.eligibility);
          }
        }
      } catch (err) {
        showAlert('alertContainer', err.message || 'Failed to update profile.');
      }
    });
  }
}

// Render Real Geographical Leaflet.js OpenStreetMap
async function renderNearbyDonorMap(donors, targetCity, targetArea, activeRequests = []) {
  const container = document.getElementById('nearbyDonorMapContainer');
  const mapElement = document.getElementById('leafletMap');
  if (!container || !mapElement) return;

  container.style.display = 'block';

  // Verified Hospitals around Mira-Bhayandar / Mira Road
  const HOSPITALS = [
    { name: 'Thunga Hospital', area: 'Mira Road', lat: 19.2863, lng: 72.8596 },
    { name: 'Wockhardt Hospitals, Mira Road', area: 'Mira Road', lat: 19.2885, lng: 72.8572 },
    { name: 'Bhaktivedanta Hospital', area: 'Mira Road', lat: 19.2789, lng: 72.8643 },
    { name: 'Shah Lifeline Hospital', area: 'Mira Road', lat: 19.2941, lng: 72.8548 },
    { name: 'Mira Super Speciality Hospital', area: 'Mira Road', lat: 19.2842, lng: 72.8580 },
    { name: 'Sunrise Hospital', area: 'Mira Road', lat: 19.2910, lng: 72.8520 },
    { name: 'St. Anns Hospital', area: 'Mira Road', lat: 19.2825, lng: 72.8610 },
    { name: 'Indira Gandhi Municipal Hospital', area: 'Bhayandar', lat: 19.3015, lng: 72.8505 }
  ];

  // Verified Railway Stations (Western Line)
  const RAILWAY_STATIONS = [
    { name: 'Mira Road Railway Station', line: 'Western Railway', lat: 19.2809, lng: 72.8556 },
    { name: 'Bhayandar Railway Station', line: 'Western Railway', lat: 19.3075, lng: 72.8525 },
    { name: 'Dahisar Railway Station', line: 'Western Railway', lat: 19.2501, lng: 72.8593 },
    { name: 'Borivali Railway Station', line: 'Western Railway', lat: 19.2291, lng: 72.8567 },
    { name: 'Kandivali Railway Station', line: 'Western Railway', lat: 19.2046, lng: 72.8522 },
    { name: 'Malad Railway Station', line: 'Western Railway', lat: 19.1874, lng: 72.8488 },
    { name: 'Goregaon Railway Station', line: 'Western Railway', lat: 19.1648, lng: 72.8492 },
    { name: 'Andheri Railway Station', line: 'Western Railway', lat: 19.1197, lng: 72.8464 },
    { name: 'Bandra Railway Station', line: 'Western Railway', lat: 19.0544, lng: 72.8402 }
  ];

  // Safely re-initialize Leaflet map instance
  if (leafletMapInstance) {
    leafletMapInstance.remove();
    leafletMapInstance = null;
  }

  // Initial Center: Mira Road (19.2812, 72.8561) or search target center
  let centerLat = 19.2812;
  let centerLng = 72.8561;

  if (targetArea || targetCity) {
    const normA = (targetArea || '').toLowerCase();
    const normC = (targetCity || '').toLowerCase();
    if (normA.includes('bhayandar') || normC.includes('bhayandar')) { centerLat = 19.3015; centerLng = 72.8505; }
    else if (normA.includes('borivali') || normC.includes('borivali')) { centerLat = 19.2291; centerLng = 72.8567; }
    else if (normA.includes('andheri') || normC.includes('andheri')) { centerLat = 19.1197; centerLng = 72.8464; }
  }

  leafletMapInstance = L.map('leafletMap', {
    center: [centerLat, centerLng],
    zoom: 13,
    zoomControl: true
  });

  // OpenStreetMap Tile Layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(leafletMapInstance);

  // Layer Groups for Leaflet Control
  const donorsLayer = L.layerGroup();
  const requestsLayer = L.layerGroup();
  const hospitalsLayer = L.layerGroup();
  const stationsLayer = L.layerGroup();

  const createDivIcon = (emoji, bgColor) => L.divIcon({
    className: 'custom-leaflet-marker',
    html: `<div style="background-color: ${bgColor}; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; border: 2px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.3);">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18]
  });

  // 1. Add Donor Markers (Privacy Protected)
  if (donors && donors.length > 0) {
    const availableDonors = donors.filter(d => d.availability === 'Available');
    availableDonors.forEach((d, idx) => {
      const coords = d.coords || { lat: 19.2812, lng: 72.8561 };
      const latOffset = (idx % 3 === 0 ? 0.0012 : idx % 3 === 1 ? -0.0015 : 0.0008);
      const lngOffset = (idx % 2 === 0 ? 0.0014 : -0.0011);
      const markerLat = coords.lat + latOffset;
      const markerLng = coords.lng + lngOffset;

      const donorIcon = createDivIcon('🩸', '#d32f2f');
      const distStr = typeof d.distance_km === 'number' ? `~${d.distance_km} km` : (d.distance_km || 'Distance unavailable');

      const popupContent = `
        <div style="font-family: system-ui, sans-serif; min-width: 180px; padding: 0.2rem;">
          <h4 style="margin: 0 0 0.4rem 0; color: #d32f2f; font-size: 0.95rem; display: flex; align-items: center; gap: 0.3rem;">
            🩸 Available Donor
          </h4>
          <div style="font-size: 0.85rem; line-height: 1.5; color: #333;">
            <p style="margin: 0;"><strong>Blood Group:</strong> <span style="background: #d32f2f; color: white; padding: 0.1rem 0.4rem; border-radius: 10px; font-weight: bold;">${d.blood_group}</span></p>
            <p style="margin: 0.2rem 0 0 0;"><strong>Area:</strong> ${d.area || d.city || 'Local Area'}</p>
            <p style="margin: 0.2rem 0 0 0;"><strong>Distance:</strong> ${distStr}</p>
            <p style="margin: 0.2rem 0 0 0;"><strong>Status:</strong> <span style="color: #2e7d32; font-weight: bold;">Available</span></p>
          </div>
          <div style="margin-top: 0.5rem; font-size: 0.72rem; color: #757575; border-top: 1px solid #eee; padding-top: 0.3rem;">
            🔒 Personal details protected for privacy. Use search list to request.
          </div>
        </div>
      `;

      L.marker([markerLat, markerLng], { icon: donorIcon })
        .bindPopup(popupContent)
        .addTo(donorsLayer);
    });
  }

  // 2. Add Active Blood Requests Layer
  if (activeRequests && activeRequests.length > 0) {
    activeRequests.forEach((r, idx) => {
      if (['Active', 'Pending'].includes(r.status)) {
        const coords = r.coords || { lat: 19.2812, lng: 72.8561 };
        const isEmergency = r.urgency === 'Emergency';
        const reqIcon = createDivIcon(isEmergency ? '🚨' : '📋', isEmergency ? '#b71c1c' : '#f57c00');

        const popupContent = `
          <div style="font-family: system-ui, sans-serif; min-width: 190px; padding: 0.2rem;">
            <h4 style="margin: 0 0 0.4rem 0; color: ${isEmergency ? '#b71c1c' : '#f57c00'}; font-size: 0.95rem; display: flex; align-items: center; gap: 0.3rem;">
              ${isEmergency ? '🚨 Emergency Blood Request' : '📋 Blood Request'}
            </h4>
            <div style="font-size: 0.85rem; line-height: 1.5; color: #333;">
              <p style="margin: 0;"><strong>Blood Group:</strong> <span style="background: ${isEmergency ? '#b71c1c' : '#f57c00'}; color: white; padding: 0.1rem 0.4rem; border-radius: 10px; font-weight: bold;">${r.blood_group}</span></p>
              <p style="margin: 0.2rem 0 0 0;"><strong>Units Required:</strong> ${r.units_required || 1} Unit(s)</p>
              <p style="margin: 0.2rem 0 0 0;"><strong>Area / Hospital:</strong> ${r.hospital_name || r.area}</p>
              <p style="margin: 0.2rem 0 0 0;"><strong>Priority:</strong> <strong style="color: ${isEmergency ? '#b71c1c' : '#f57c00'};">${r.urgency || 'Normal'}</strong></p>
              <p style="margin: 0.2rem 0 0 0;"><strong>Status:</strong> ${r.status}</p>
            </div>
          </div>
        `;

        L.marker([coords.lat + (idx * 0.0008), coords.lng - (idx * 0.0009)], { icon: reqIcon })
          .bindPopup(popupContent)
          .addTo(requestsLayer);
      }
    });
  }

  // 3. Add Hospitals Layer
  HOSPITALS.forEach(h => {
    const hospIcon = createDivIcon('🏥', '#0288d1');
    const popupContent = `
      <div style="font-family: system-ui, sans-serif; padding: 0.2rem;">
        <h4 style="margin: 0 0 0.3rem 0; color: #0288d1; font-size: 0.95rem;">🏥 ${h.name}</h4>
        <p style="margin: 0; font-size: 0.85rem; color: #555;"><strong>Area:</strong> ${h.area}</p>
        <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: #757575;">Verified Public Hospital Facility</p>
      </div>
    `;
    L.marker([h.lat, h.lng], { icon: hospIcon })
      .bindPopup(popupContent)
      .addTo(hospitalsLayer);
  });

  // 4. Add Railway Stations Layer
  RAILWAY_STATIONS.forEach(s => {
    const stnIcon = createDivIcon('🚉', '#424242');
    const popupContent = `
      <div style="font-family: system-ui, sans-serif; padding: 0.2rem;">
        <h4 style="margin: 0 0 0.3rem 0; color: #424242; font-size: 0.95rem;">🚉 ${s.name}</h4>
        <p style="margin: 0; font-size: 0.85rem; color: #555;"><strong>Line:</strong> ${s.line}</p>
        <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: #757575;">Reference Transit Location</p>
      </div>
    `;
    L.marker([s.lat, s.lng], { icon: stnIcon })
      .bindPopup(popupContent)
      .addTo(stationsLayer);
  });

  // Add layer groups to Leaflet map
  donorsLayer.addTo(leafletMapInstance);
  requestsLayer.addTo(leafletMapInstance);
  hospitalsLayer.addTo(leafletMapInstance);
  stationsLayer.addTo(leafletMapInstance);

  // Add Leaflet Layer Control
  const overlays = {
    '🩸 Available Donors': donorsLayer,
    '🚨 Blood Requests': requestsLayer,
    '🏥 Hospitals': hospitalsLayer,
    '🚉 Railway Stations': stationsLayer
  };
  L.control.layers(null, overlays, { collapsed: false }).addTo(leafletMapInstance);

  // Add Leaflet Map Legend Control
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'info legend');
    div.style.background = '#ffffff';
    div.style.padding = '0.6rem 0.8rem';
    div.style.borderRadius = '8px';
    div.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
    div.style.fontSize = '0.8rem';
    div.style.lineHeight = '1.6';

    div.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 0.3rem; border-bottom: 1px solid #ddd; padding-bottom: 0.2rem;">Map Legend</div>
      <div>🩸 Available Donor</div>
      <div>🚨 Blood Request</div>
      <div>🏥 Hospital</div>
      <div>🚉 Railway Station</div>
      <div style="margin-top: 0.4rem; font-size: 0.72rem; color: #757575; font-style: italic;">
        📍 Approximate locations shown for privacy.
      </div>
    `;
    return div;
  };
  legend.addTo(leafletMapInstance);
}

async function initDonorSearch() {
  const searchForm = document.getElementById('searchForm');
  const resultsContainer = document.getElementById('searchResults');

  async function performSearch() {
    if (!resultsContainer) return;
    resultsContainer.innerHTML = '<p class="text-center">Searching available donors...</p>';

    const bg = document.getElementById('filterBg')?.value || '';
    const city = document.getElementById('filterCity')?.value.trim() || '';
    const area = document.getElementById('filterArea')?.value.trim() || '';
    const avail = document.getElementById('filterAvail')?.value || 'Available';
    const urgency = document.getElementById('filterUrgency')?.value || 'Normal';

    try {
      // Fetch donors and active blood requests in parallel
      const [donorRes, reqRes] = await Promise.all([
        API.get(`/donors/search?blood_group=${encodeURIComponent(bg)}&city=${encodeURIComponent(city)}&area=${encodeURIComponent(area)}&availability=${encodeURIComponent(avail)}&urgency=${encodeURIComponent(urgency)}`),
        API.get(`/requests?status=Active`)
      ]);
      
      const activeRequests = reqRes.success ? reqRes.requests : [];

      if (donorRes.success && donorRes.donors.length > 0) {
        // Render Leaflet.js Real Geographical Map
        renderNearbyDonorMap(donorRes.donors, city, area, activeRequests);

        resultsContainer.innerHTML = donorRes.donors.map(d => {
          const distStr = typeof d.distance_km === 'number' ? `~${d.distance_km} km away` : (d.distance_km || 'Distance unavailable');
          return `
            <div class="card" style="border-top: 4px solid ${d.availability === 'Available' ? 'var(--primary)' : '#9e9e9e'};">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                <div>
                  <h3 style="margin-bottom: 0.2rem;">${d.name}</h3>
                  <p style="color: var(--text-muted); font-size: 0.9rem;">📍 ${d.area}, ${d.city}</p>
                  <span class="distance-tag">🚗 ${distStr}</span>
                </div>
                <div class="blood-pill">${d.blood_group}</div>
              </div>
              <div style="font-size: 0.9rem; margin-bottom: 1rem;">
                <p><strong>Status:</strong> <span class="badge ${d.availability === 'Available' ? 'badge-success' : 'badge-danger'}">${d.availability}</span></p>
                <p><strong>Eligibility:</strong> <span style="color: ${d.eligibility?.is_eligible ? 'var(--success)' : 'var(--warning)'}; font-weight: 600;">${d.eligibility?.status_text || 'Eligible'}</span></p>
                <p><strong>Last Donation:</strong> ${d.last_donation_date || 'N/A'}</p>
              </div>
              <button onclick="openRequestModal(${d.id}, '${d.name}', '${d.blood_group}')" class="btn btn-primary btn-sm" style="width: 100%;">
                🩸 Request Blood
              </button>
            </div>
          `;
        }).join('');
      } else {
        renderNearbyDonorMap([], city, area, activeRequests);
        resultsContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 2rem; background: #fff; border-radius: var(--radius-md);">
          <h3>No matching donors found</h3>
          <p style="color: var(--text-muted);">Try adjusting your search criteria, city filter, or availability options.</p>
        </div>`;
      }
    } catch (err) {
      resultsContainer.innerHTML = `<p class="text-center" style="color: red;">Error searching donors: ${err.message}</p>`;
    }
  }

  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      performSearch();
    });
  }

  performSearch();
}
