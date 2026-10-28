const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken } = require('../middleware/authMiddleware');

router.use(authenticateToken);

// Get User Notifications
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const notifications = await db.query(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
      [userId]
    );

    const unreadCountRow = await db.getOne(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`,
      [userId]
    );

    return res.json({
      success: true,
      unreadCount: unreadCountRow.count || 0,
      notifications
    });
  } catch (err) {
    console.error('Get notifications error:', err);
    return res.status(500).json({ success: false, message: 'Server error retrieving notifications.' });
  }
});

// Mark Single Notification as Read
router.put('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await db.execute(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    return res.json({ success: true, message: 'Notification marked as read.' });
  } catch (err) {
    console.error('Mark notification read error:', err);
    return res.status(500).json({ success: false, message: 'Server error updating notification.' });
  }
});

// Mark All Notifications as Read
router.put('/read-all', async (req, res) => {
  try {
    const userId = req.user.id;
    await db.execute(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [userId]);

    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('Mark all read error:', err);
    return res.status(500).json({ success: false, message: 'Server error updating notifications.' });
  }
});

module.exports = router;
