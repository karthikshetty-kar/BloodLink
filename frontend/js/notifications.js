/* BloodLink - Notifications JS */

async function loadNotificationsPage() {
  const user = API.getUser();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }

  const container = document.getElementById('notificationsContainer');
  const unreadBadge = document.getElementById('unreadBadge');
  if (!container) return;

  try {
    const data = await API.get('/notifications');
    if (data.success) {
      if (unreadBadge) unreadBadge.textContent = data.unreadCount;

      if (data.notifications.length === 0) {
        container.innerHTML = `<div class="card text-center"><p class="text-muted">No notifications found.</p></div>`;
        return;
      }

      container.innerHTML = data.notifications.map(n => `
        <div class="notification-item ${n.is_read ? '' : 'unread'}" id="notif-${n.id}">
          <div>
            <p style="margin-bottom: 0.25rem;">${n.message}</p>
            <span class="notification-time">${new Date(n.created_at).toLocaleString()}</span>
          </div>
          ${!n.is_read ? `
            <button onclick="markNotificationRead(${n.id})" class="btn btn-sm btn-outline">Mark Read</button>
          ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Read</span>'}
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Error loading notifications:', err);
  }
}

async function markNotificationRead(id) {
  try {
    const data = await API.put(`/notifications/${id}/read`);
    if (data.success) {
      loadNotificationsPage();
    }
  } catch (err) {
    console.error('Error marking notification read:', err);
  }
}

async function markAllNotificationsRead() {
  try {
    const data = await API.put('/notifications/read-all');
    if (data.success) {
      loadNotificationsPage();
    }
  } catch (err) {
    console.error('Error marking all notifications read:', err);
  }
}
