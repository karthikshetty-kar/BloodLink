/* BloodLink - API Client & Utility Helper */

const API_BASE_URL = '/api';

const API = {
  // Get stored auth token
  getToken() {
    return localStorage.getItem('bloodlink_token');
  },

  // Store auth token & user
  setSession(token, user) {
    localStorage.setItem('bloodlink_token', token);
    localStorage.setItem('bloodlink_user', JSON.stringify(user));
  },

  // Get logged in user object
  getUser() {
    const userStr = localStorage.getItem('bloodlink_user');
    return userStr ? JSON.parse(userStr) : null;
  },

  // Clear session (Logout)
  clearSession() {
    localStorage.removeItem('bloodlink_token');
    localStorage.removeItem('bloodlink_user');
  },

  // Generic Request Helper
  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          // Token expired or invalid, clear and redirect to login if protected page
          if (!window.location.pathname.endsWith('login.html') && !window.location.pathname.endsWith('register.html') && window.location.pathname !== '/' && !window.location.pathname.endsWith('index.html')) {
            this.clearSession();
            window.location.href = '/login.html';
          }
        }
        throw new Error(data.message || 'API request failed');
      }

      return data;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err.message);
      throw err;
    }
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  put(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};

// UI Helper Toast / Alert
function showAlert(containerId, message, type = 'danger') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `
    <div class="alert alert-${type}">
      ${message}
    </div>
  `;
}

function clearAlert(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '';
}
