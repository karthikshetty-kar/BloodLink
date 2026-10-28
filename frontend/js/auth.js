/* BloodLink - Authentication Helper */

document.addEventListener('DOMContentLoaded', () => {
  initAuthForm();
  initRoleToggle();
  setupNavigation();
});

// Protect page access based on required roles
function protectRoute(allowedRoles = []) {
  const user = API.getUser();
  const token = API.getToken();

  if (!token || !user) {
    window.location.href = '/login.html';
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    alert(`Access denied. You do not have permission to view this page.`);
    redirectUserToDashboard(user);
    return null;
  }

  return user;
}

function redirectUserToDashboard(user) {
  if (!user) return;
  switch (user.role) {
    case 'Donor':
      window.location.href = '/donor/dashboard.html';
      break;
    case 'Hospital':
      window.location.href = '/hospital/dashboard.html';
      break;
    case 'Admin':
      window.location.href = '/admin/dashboard.html';
      break;
    case 'Blood Seeker':
      window.location.href = '/seeker/dashboard.html';
      break;
    case 'Blood Bank':
      window.location.href = '/bloodbank/dashboard.html';
      break;
    default:
      window.location.href = '/index.html';
  }
}

function initRoleToggle() {
  const roleSelect = document.getElementById('roleSelect');
  const donorFields = document.getElementById('donorFields');

  if (roleSelect && donorFields) {
    roleSelect.addEventListener('change', (e) => {
      if (e.target.value === 'Donor') {
        donorFields.style.display = 'block';
        document.getElementById('bloodGroupSelect').required = true;
      } else {
        donorFields.style.display = 'none';
        document.getElementById('bloodGroupSelect').required = false;
      }
    });
  }
}

function initAuthForm() {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert('alertContainer');

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const role = document.getElementById('loginRole')?.value || '';

      const payload = { email, password };
      if (role) payload.role = role;

      try {
        const data = await API.post('/auth/login', payload);
        if (data.success) {
          API.setSession(data.token, data.user);
          redirectUserToDashboard(data.user);
        }
      } catch (err) {
        showAlert('alertContainer', err.message || 'Login failed. Check your credentials.');
      }
    });
  }

  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert('alertContainer');

      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const phone = document.getElementById('phone').value.trim();
      const city = document.getElementById('cityInput')?.value?.trim() || document.getElementById('city')?.value?.trim();
      const area = document.getElementById('areaInput')?.value?.trim() || document.getElementById('area')?.value?.trim();
      const role = document.getElementById('roleSelect').value;
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      const payload = {
        name,
        email,
        phone,
        city,
        area,
        role,
        password,
        confirmPassword
      };

      if (role === 'Donor') {
        payload.blood_group = document.getElementById('bloodGroupSelect').value;
        payload.availability = document.getElementById('availabilitySelect')?.value || 'Available';
        payload.last_donation_date = document.getElementById('lastDonationDate')?.value || null;
      }

      try {
        const data = await API.post('/auth/register', payload);
        if (data.success) {
          API.setSession(data.token, data.user);
          alert('Registration successful!');
          redirectUserToDashboard(data.user);
        }
      } catch (err) {
        showAlert('alertContainer', err.message || 'Registration failed.');
      }
    });
  }
}

function setupNavigation() {
  const user = API.getUser();
  const navContainer = document.getElementById('navDynamicLinks');
  if (!navContainer) return;

  if (user) {
    let dashboardUrl = '/index.html';
    if (user.role === 'Donor') dashboardUrl = '/donor/dashboard.html';
    if (user.role === 'Hospital') dashboardUrl = '/hospital/dashboard.html';
    if (user.role === 'Admin') dashboardUrl = '/admin/dashboard.html';
    if (user.role === 'Blood Seeker') dashboardUrl = '/seeker/dashboard.html';
    if (user.role === 'Blood Bank') dashboardUrl = '/bloodbank/dashboard.html';

    navContainer.innerHTML = `
      <a href="${dashboardUrl}" class="nav-link">Dashboard (${user.role})</a>
      <a href="#" id="logoutBtn" class="btn btn-outline btn-sm">Logout (${user.name})</a>
    `;

    document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      API.clearSession();
      window.location.href = '/login.html';
    });
  } else {
    navContainer.innerHTML = `
      <a href="/login.html" class="nav-link">Login</a>
      <a href="/register.html" class="btn btn-primary btn-sm">Register</a>
    `;
  }
}
