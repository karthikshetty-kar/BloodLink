const db = require('../database/db');

exports.getStatistics = async (req, res) => {
  try {
    const totalUsersRow = await db.getOne(`SELECT COUNT(*) as count FROM users`);
    const totalDonorsRow = await db.getOne(`SELECT COUNT(*) as count FROM donors`);
    const availableDonorsRow = await db.getOne(`SELECT COUNT(*) as count FROM donors d JOIN users u ON d.user_id = u.id WHERE d.availability = 'Available' AND u.status = 'Active'`);
    const totalHospitalsRow = await db.getOne(`SELECT COUNT(*) as count FROM users WHERE role = 'Hospital'`);
    const activeRequestsRow = await db.getOne(`SELECT COUNT(*) as count FROM blood_requests WHERE status IN ('Active', 'Pending')`);
    const emergencyRequestsRow = await db.getOne(`SELECT COUNT(*) as count FROM blood_requests WHERE urgency = 'Emergency' AND status IN ('Active', 'Pending')`);
    const completedRequestsRow = await db.getOne(`SELECT COUNT(*) as count FROM blood_requests WHERE status = 'Fulfilled'`);
    
    // Blood groups available
    const availableGroupsRow = await db.getOne(`SELECT COUNT(DISTINCT blood_group) as count FROM donors WHERE availability = 'Available'`);

    // Blood Group Distribution
    const bgRows = await db.query(`
      SELECT blood_group, COUNT(*) as count
      FROM donors d
      JOIN users u ON d.user_id = u.id
      WHERE u.status = 'Active'
      GROUP BY blood_group
    `);

    const bloodGroupDistribution = {
      'A+': 0, 'A-': 0, 'B+': 0, 'B-': 0,
      'AB+': 0, 'AB-': 0, 'O+': 0, 'O-': 0
    };

    bgRows.forEach(row => {
      if (bloodGroupDistribution[row.blood_group] !== undefined) {
        bloodGroupDistribution[row.blood_group] = row.count;
      }
    });

    return res.json({
      success: true,
      statistics: {
        totalUsers: totalUsersRow.count || 0,
        totalDonors: totalDonorsRow.count || 0,
        availableDonors: availableDonorsRow.count || 0,
        totalHospitals: totalHospitalsRow.count || 0,
        activeRequests: activeRequestsRow.count || 0,
        emergencyRequests: emergencyRequestsRow.count || 0,
        completedRequests: completedRequestsRow.count || 0,
        bloodGroupsAvailable: availableGroupsRow.count || 0,
        bloodGroupDistribution
      }
    });
  } catch (err) {
    console.error('Get statistics error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching system statistics.' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const { role, status, search } = req.query;

    let query = `SELECT id, name, email, phone, role, city, area, status, created_at FROM users WHERE 1=1`;
    const params = [];

    if (role) {
      query += ` AND role = ?`;
      params.push(role);
    }

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (search) {
      query += ` AND (name LIKE ? OR email LIKE ? OR city LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY id DESC`;

    const users = await db.query(query, params);
    return res.json({ success: true, count: users.length, users });
  } catch (err) {
    console.error('Admin getUsers error:', err);
    return res.status(500).json({ success: false, message: 'Server error retrieving users.' });
  }
};

exports.toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'Active' or 'Disabled'

    if (!['Active', 'Disabled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be Active or Disabled.' });
    }

    const user = await db.getOne('SELECT id, role FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.role === 'Admin') {
      return res.status(400).json({ success: false, message: 'Cannot disable Admin users.' });
    }

    await db.execute('UPDATE users SET status = ? WHERE id = ?', [status, id]);

    return res.json({
      success: true,
      message: `User status successfully set to ${status}.`
    });
  } catch (err) {
    console.error('Toggle user status error:', err);
    return res.status(500).json({ success: false, message: 'Server error toggling user status.' });
  }
};

exports.getDonors = async (req, res) => {
  try {
    const donors = await db.query(`
      SELECT d.*, u.name, u.email, u.phone, u.status as user_status
      FROM donors d
      JOIN users u ON d.user_id = u.id
      ORDER BY d.id DESC
    `);

    return res.json({ success: true, count: donors.length, donors });
  } catch (err) {
    console.error('Admin getDonors error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching donors.' });
  }
};

exports.getHospitals = async (req, res) => {
  try {
    const hospitals = await db.query(`
      SELECT id, name, email, phone, city, area, status, created_at
      FROM users
      WHERE role = 'Hospital'
      ORDER BY id DESC
    `);

    return res.json({ success: true, count: hospitals.length, hospitals });
  } catch (err) {
    console.error('Admin getHospitals error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching hospitals.' });
  }
};

exports.getRequests = async (req, res) => {
  try {
    const requests = await db.query(`
      SELECT br.*, u.name as requester_name, u.role as requester_role
      FROM blood_requests br
      JOIN users u ON br.requester_id = u.id
      ORDER BY br.id DESC
    `);

    return res.json({ success: true, count: requests.length, requests });
  } catch (err) {
    console.error('Admin getRequests error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching requests.' });
  }
};
