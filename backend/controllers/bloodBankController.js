const db = require('../database/db');
const { getLocationCoordinates, haversineDistance, findMatchingDonors } = require('../utils/matching');

// Get Blood Bank Profile
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const bank = await db.getOne(
      `SELECT bb.*, u.name, u.email, u.phone, u.city, u.area, u.status
       FROM blood_banks bb
       JOIN users u ON bb.user_id = u.id
       WHERE bb.user_id = ?`,
      [userId]
    );

    if (!bank) {
      return res.status(404).json({ success: false, message: 'Blood bank profile not found.' });
    }

    const inventory = await db.query(
      `SELECT blood_group, units_available, last_updated FROM blood_bank_inventory WHERE blood_bank_id = ? ORDER BY blood_group`,
      [bank.id]
    );

    return res.json({ success: true, bank: { ...bank, inventory } });
  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching blood bank profile.' });
  }
};

// Get all Blood Banks (public - for routing logic)
exports.getAllBanks = async (req, res) => {
  try {
    const banks = await db.query(`
      SELECT bb.id, bb.bank_name, bb.city, bb.area, bb.address, bb.operating_hours, bb.is_active,
             u.name, u.email, u.phone
      FROM blood_banks bb
      JOIN users u ON bb.user_id = u.id
      WHERE bb.is_active = 1 AND u.status = 'Active'
      ORDER BY bb.id
    `);

    for (const bank of banks) {
      bank.inventory = await db.query(
        `SELECT blood_group, units_available FROM blood_bank_inventory WHERE blood_bank_id = ? ORDER BY blood_group`,
        [bank.id]
      );
      bank.coords = getLocationCoordinates(bank.area, bank.city);
    }

    return res.json({ success: true, count: banks.length, banks });
  } catch (err) {
    console.error('getAllBanks error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching blood banks.' });
  }
};

// Update Inventory
exports.updateInventory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { inventory } = req.body; // Array of { blood_group, units_available }

    if (!Array.isArray(inventory) || inventory.length === 0) {
      return res.status(400).json({ success: false, message: 'Inventory data is required.' });
    }

    const bank = await db.getOne(`SELECT id FROM blood_banks WHERE user_id = ?`, [userId]);
    if (!bank) {
      return res.status(404).json({ success: false, message: 'Blood bank not found.' });
    }

    const validGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

    await db.execute('BEGIN TRANSACTION');
    try {
      for (const item of inventory) {
        if (!validGroups.includes(item.blood_group)) continue;
        const units = Math.max(0, parseInt(item.units_available) || 0);

        const existing = await db.getOne(
          `SELECT id FROM blood_bank_inventory WHERE blood_bank_id = ? AND blood_group = ?`,
          [bank.id, item.blood_group]
        );

        if (existing) {
          await db.execute(
            `UPDATE blood_bank_inventory SET units_available = ?, last_updated = CURRENT_TIMESTAMP WHERE blood_bank_id = ? AND blood_group = ?`,
            [units, bank.id, item.blood_group]
          );
        } else {
          await db.execute(
            `INSERT INTO blood_bank_inventory (blood_bank_id, blood_group, units_available) VALUES (?, ?, ?)`,
            [bank.id, item.blood_group, units]
          );
        }
      }
      await db.execute('COMMIT');
    } catch (txErr) {
      await db.execute('ROLLBACK');
      throw txErr;
    }

    return res.json({ success: true, message: 'Inventory updated successfully.' });
  } catch (err) {
    console.error('updateInventory error:', err);
    return res.status(500).json({ success: false, message: 'Server error updating inventory.' });
  }
};

// Get Assigned Requests for Blood Bank
exports.getAssignedRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const bank = await db.getOne(`SELECT id FROM blood_banks WHERE user_id = ?`, [userId]);
    if (!bank) {
      return res.status(404).json({ success: false, message: 'Blood bank not found.' });
    }

    const requests = await db.query(
      `SELECT br.*, u.name as requester_name, u.phone as requester_phone, u.role as requester_role,
              bbr.response as my_response, bbr.confirmed_units as my_confirmed_units, bbr.notes as my_notes, bbr.responded_at as my_responded_at
       FROM blood_requests br
       JOIN users u ON br.requester_id = u.id
       LEFT JOIN blood_bank_responses bbr ON bbr.blood_request_id = br.id AND bbr.blood_bank_id = ?
       WHERE br.assigned_blood_bank_id = ?
       ORDER BY CASE br.urgency WHEN 'Emergency' THEN 1 WHEN 'Urgent' THEN 2 ELSE 3 END, br.id DESC`,
      [bank.id, bank.id]
    );

    return res.json({ success: true, count: requests.length, requests });
  } catch (err) {
    console.error('getAssignedRequests error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching assigned requests.' });
  }
};

// Respond to a Blood Request
exports.respondToRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;
    const { response, confirmed_units, notes } = req.body;

    const validResponses = ['Fully Available', 'Partially Available', 'Unavailable', 'Unable to Respond'];
    if (!validResponses.includes(response)) {
      return res.status(400).json({ success: false, message: 'Invalid response type.' });
    }

    const bank = await db.getOne(`SELECT id, bank_name FROM blood_banks WHERE user_id = ?`, [userId]);
    if (!bank) {
      return res.status(404).json({ success: false, message: 'Blood bank not found.' });
    }

    const request = await db.getOne(`SELECT * FROM blood_requests WHERE id = ? AND assigned_blood_bank_id = ?`, [requestId, bank.id]);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Blood request not assigned to your bank or not found.' });
    }

    let confirmedUnits = parseInt(confirmed_units) || 0;

    // Check prior response by this bank on this request (for revisions)
    const prevResponse = await db.getOne(
      `SELECT * FROM blood_bank_responses WHERE blood_request_id = ? AND blood_bank_id = ? ORDER BY id DESC LIMIT 1`,
      [requestId, bank.id]
    );
    const prevConfirmed = prevResponse ? (prevResponse.confirmed_units || 0) : 0;

    const invItem = await db.getOne(
      `SELECT id, units_available FROM blood_bank_inventory WHERE blood_bank_id = ? AND blood_group = ?`,
      [bank.id, request.blood_group]
    );
    const currentStock = invItem ? invItem.units_available : 0;
    const maxAllocatable = currentStock + prevConfirmed;

    // Validate confirmed units against current inventory (prevent overselling)
    if (response === 'Fully Available' || response === 'Partially Available') {
      if (confirmedUnits <= 0) {
        return res.status(400).json({ success: false, message: 'Confirmed units must be greater than 0 when available.' });
      }
      if (confirmedUnits > maxAllocatable) {
        return res.status(400).json({
          success: false,
          message: `Cannot confirm ${confirmedUnits} units — your current available inventory is ${currentStock} unit(s) of ${request.blood_group} (+${prevConfirmed} previously reserved). Update your inventory first if stock has changed.`
        });
      }
      // Cap at request units required
      if (confirmedUnits > request.units_required) {
        confirmedUnits = request.units_required;
      }
    } else {
      confirmedUnits = 0; // Unavailable or Unable to Respond → 0 confirmed units
    }

    const remainingUnits = Math.max(0, request.units_required - confirmedUnits);
    const delta = confirmedUnits - prevConfirmed; // Net units to deduct from stock

    // Execute atomic transaction for response and inventory
    await db.execute('BEGIN TRANSACTION');
    try {
      // 1. Record response in history
      await db.execute(
        `INSERT INTO blood_bank_responses (blood_request_id, blood_bank_id, response, confirmed_units, notes) VALUES (?, ?, ?, ?, ?)`,
        [requestId, bank.id, response, confirmedUnits, notes || '']
      );

      // 2. Update blood request with bank response
      await db.execute(
        `UPDATE blood_requests SET 
          bank_response = ?, 
          bank_response_notes = ?, 
          bank_responded_at = CURRENT_TIMESTAMP,
          confirmed_units = ?,
          remaining_units = ?,
          donor_fallback_active = ?,
          status = 'Active'
         WHERE id = ?`,
        [
          response,
          notes || '',
          confirmedUnits,
          remainingUnits,
          (response === 'Unavailable' || response === 'Unable to Respond' || remainingUnits > 0) ? 1 : 0,
          requestId
        ]
      );

      // 3. Adjust inventory atomically based on net delta
      if (invItem && delta !== 0) {
        await db.execute(
          `UPDATE blood_bank_inventory SET units_available = units_available - ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
          [delta, invItem.id]
        );
      }

      await db.execute('COMMIT');
    } catch (txErr) {
      await db.execute('ROLLBACK');
      throw txErr;
    }

    // Notify requester
    let notificationMsg = '';
    if (response === 'Fully Available') {
      notificationMsg = `✅ ${bank.bank_name} can FULLY provide ${confirmedUnits} unit(s) of ${request.blood_group} for your request at ${request.hospital_name}.`;
    } else if (response === 'Partially Available') {
      notificationMsg = `⚠️ ${bank.bank_name} can partially provide ${confirmedUnits} unit(s) of ${request.blood_group}. ${remainingUnits} unit(s) still needed — Donor matching activated.`;
    } else if (response === 'Unavailable') {
      notificationMsg = `❌ ${bank.bank_name} does not have ${request.blood_group} stock. Donor matching has been activated for all ${request.units_required} unit(s).`;
    } else {
      notificationMsg = `⏰ ${bank.bank_name} is unable to respond right now. Donor matching activated for ${request.units_required} unit(s) of ${request.blood_group}.`;
    }

    await db.execute(
      `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
      [request.requester_id, notificationMsg, 'status_update']
    );

    // If donor fallback needed, auto-notify matching donors
    if (response !== 'Fully Available') {
      try {
        const matchedDonors = await findMatchingDonors({
          blood_group: request.blood_group,
          city: request.city,
          area: request.area,
          urgency: request.urgency
        });

        const unitsNeeded = response === 'Partially Available' ? remainingUnits : request.units_required;

        for (const donor of matchedDonors.slice(0, 10)) {
          await db.execute(
            `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
            [
              donor.user_id,
              `🚨 URGENT Donor Alert: ${unitsNeeded} unit(s) of ${request.blood_group} needed at ${request.hospital_name}, ${request.area}, ${request.city}. Blood bank cannot fully fulfill this request. Please respond if available.`,
              'request'
            ]
          );
        }
      } catch (notifyErr) {
        console.error('Donor fallback notification error:', notifyErr);
      }
    }

    return res.json({
      success: true,
      message: `Response recorded: ${response}. ${remainingUnits > 0 ? `Donor fallback activated for ${remainingUnits} remaining unit(s).` : ''}`,
      confirmed_units: confirmedUnits,
      remaining_units: remainingUnits,
      donor_fallback: remainingUnits > 0 || response === 'Unavailable' || response === 'Unable to Respond'
    });
  } catch (err) {
    console.error('respondToRequest error:', err);
    return res.status(500).json({ success: false, message: 'Server error recording response.' });
  }
};

// Get Blood Bank Dashboard Statistics
exports.getDashboardStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const bank = await db.getOne(`SELECT id FROM blood_banks WHERE user_id = ?`, [userId]);
    if (!bank) {
      return res.status(404).json({ success: false, message: 'Blood bank not found.' });
    }

    const totalAssigned = await db.getOne(
      `SELECT COUNT(*) as count FROM blood_requests WHERE assigned_blood_bank_id = ?`, [bank.id]
    );
    const pendingResponse = await db.getOne(
      `SELECT COUNT(*) as count FROM blood_requests WHERE assigned_blood_bank_id = ? AND bank_response IS NULL AND status IN ('Active', 'Pending')`, [bank.id]
    );
    const fullyFulfilled = await db.getOne(
      `SELECT COUNT(*) as count FROM blood_requests WHERE assigned_blood_bank_id = ? AND bank_response = 'Fully Available'`, [bank.id]
    );
    const partiallyFulfilled = await db.getOne(
      `SELECT COUNT(*) as count FROM blood_requests WHERE assigned_blood_bank_id = ? AND bank_response = 'Partially Available'`, [bank.id]
    );

    const totalInventory = await db.query(
      `SELECT blood_group, units_available FROM blood_bank_inventory WHERE blood_bank_id = ? ORDER BY blood_group`,
      [bank.id]
    );

    const totalUnits = totalInventory.reduce((sum, i) => sum + (i.units_available || 0), 0);

    return res.json({
      success: true,
      stats: {
        totalAssigned: totalAssigned.count || 0,
        pendingResponse: pendingResponse.count || 0,
        fullyFulfilled: fullyFulfilled.count || 0,
        partiallyFulfilled: partiallyFulfilled.count || 0,
        totalUnitsInStock: totalUnits,
        inventory: totalInventory
      }
    });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching stats.' });
  }
};
