const db = require('../database/db');
const { findMatchingDonors, getLocationCoordinates, haversineDistance } = require('../utils/matching');

// Helper: Find the best nearby blood bank for a request
async function findBestBloodBank(blood_group, city, area, units_required) {
  try {
    // Get all active blood banks
    const banks = await db.query(`
      SELECT bb.id, bb.bank_name, bb.city, bb.area, bb.is_active,
             u.id as user_id, u.status
      FROM blood_banks bb
      JOIN users u ON bb.user_id = u.id
      WHERE bb.is_active = 1 AND u.status = 'Active'
    `);

    if (!banks.length) return null;

    const requestCoords = getLocationCoordinates(area, city);

    const scoredBanks = [];
    for (const bank of banks) {
      const inventory = await db.getOne(
        `SELECT units_available FROM blood_bank_inventory WHERE blood_bank_id = ? AND blood_group = ?`,
        [bank.id, blood_group]
      );
      const available = inventory ? inventory.units_available : 0;
      if (available === 0) continue; // Skip banks with zero stock

      const bankCoords = getLocationCoordinates(bank.area, bank.city);
      const distance = requestCoords && bankCoords
        ? haversineDistance(requestCoords.lat, requestCoords.lng, bankCoords.lat, bankCoords.lng)
        : 999;

      scoredBanks.push({
        ...bank,
        units_available: available,
        canFulfillFully: available >= units_required,
        distance_km: typeof distance === 'number' ? distance : 999
      });
    }

    if (!scoredBanks.length) return null;

    // Sort: fully-capable banks first, then by distance
    scoredBanks.sort((a, b) => {
      if (a.canFulfillFully !== b.canFulfillFully) return b.canFulfillFully - a.canFulfillFully;
      return a.distance_km - b.distance_km;
    });

    return scoredBanks[0];
  } catch (err) {
    console.error('findBestBloodBank error:', err);
    return null;
  }
}

// Create Blood Request - Blood Bank First Workflow
exports.createRequest = async (req, res) => {
  try {
    const requesterId = req.user.id;
    const {
      hospital_name,
      blood_group,
      units_required,
      city,
      area,
      urgency,
      required_date,
      message
    } = req.body;

    if (!hospital_name || !blood_group || !city || !area) {
      return res.status(400).json({ success: false, message: 'Hospital Name, Blood Group, City, and Area are required.' });
    }

    const validBloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    if (!validBloodGroups.includes(blood_group)) {
      return res.status(400).json({ success: false, message: 'Invalid blood group provided.' });
    }

    const unitsNeeded = parseInt(units_required) || 1;
    const isEmergency = urgency === 'Emergency';

    // Step 1: Find nearest eligible blood bank
    const bestBank = await findBestBloodBank(blood_group, city, area, unitsNeeded);

    const result = await db.execute(
      `INSERT INTO blood_requests 
       (requester_id, hospital_name, blood_group, units_required, city, area, urgency, required_date, message, status,
        assigned_blood_bank_id, confirmed_units, remaining_units, donor_fallback_active, immediate_donor_alert)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, 0, ?, ?, ?)`,
      [
        requesterId,
        hospital_name,
        blood_group,
        unitsNeeded,
        city,
        area,
        urgency || 'Normal',
        required_date || null,
        message || '',
        bestBank ? bestBank.id : null,
        unitsNeeded,
        bestBank ? 0 : 1,
        isEmergency ? 1 : 0
      ]
    );

    const requestId = result.lastID;

    // Step 2: Notify the assigned blood bank
    if (bestBank) {
      await db.execute(
        `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
        [
          bestBank.user_id,
          `🏥 New ${urgency || 'Normal'} Blood Request Assigned to You: ${unitsNeeded} unit(s) of ${blood_group} needed at ${hospital_name}, ${area}, ${city}. Please respond promptly in your dashboard.`,
          'request'
        ]
      );
    }

    // Step 3: For emergencies, immediately also alert nearby donors in parallel
    if (isEmergency) {
      try {
        const matchedDonors = await findMatchingDonors({ blood_group, city, area, urgency });
        for (const donor of matchedDonors.slice(0, 5)) {
          await db.execute(
            `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
            [
              donor.user_id,
              `🚨 EMERGENCY Alert: ${unitsNeeded} unit(s) of ${blood_group} urgently needed at ${hospital_name}, ${area}, ${city}. Please contact the hospital if available.`,
              'request'
            ]
          );
        }
      } catch (notifyErr) {
        console.error('Emergency donor alert error:', notifyErr);
      }
    } else if (!bestBank) {
      // No blood bank available - fall back to donor matching
      try {
        const matchedDonors = await findMatchingDonors({ blood_group, city, area, urgency });
        for (const donor of matchedDonors) {
          await db.execute(
            `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
            [
              donor.user_id,
              `🔔 New ${urgency || 'Normal'} Blood Request: ${unitsNeeded} unit(s) of ${blood_group} required at ${hospital_name}, ${area}, ${city}. (No blood bank stock available).`,
              'request'
            ]
          );
        }
      } catch (notifyErr) {
        console.error('Donor fallback notification error:', notifyErr);
      }
    }

    const responseMsg = bestBank
      ? `Blood request created! Assigned to ${bestBank.bank_name} (${bestBank.distance_km} km away). Blood Bank is reviewing availability.`
      : `Blood request created! No nearby blood banks currently have ${blood_group} stock. Matching local donors have been alerted.`;

    return res.status(201).json({
      success: true,
      message: responseMsg,
      requestId,
      assignedBank: bestBank ? { id: bestBank.id, name: bestBank.bank_name, distance_km: bestBank.distance_km } : null
    });
  } catch (err) {
    console.error('Create blood request error:', err);
    return res.status(500).json({ success: false, message: 'Server error creating blood request.' });
  }
};


// Get All Requests with filters
exports.getRequests = async (req, res) => {
  try {
    const { requester_id, status, blood_group, urgency, city } = req.query;

    let query = `
      SELECT br.*, u.name as requester_name, u.phone as requester_phone, u.role as requester_role,
             bb.bank_name as assigned_bank_name, bb.city as assigned_bank_city, bb.area as assigned_bank_area
      FROM blood_requests br
      JOIN users u ON br.requester_id = u.id
      LEFT JOIN blood_banks bb ON br.assigned_blood_bank_id = bb.id
      WHERE 1=1
    `;
    const params = [];

    if (requester_id) {
      query += ` AND br.requester_id = ?`;
      params.push(requester_id);
    }

    if (status) {
      query += ` AND br.status = ?`;
      params.push(status);
    }

    if (blood_group) {
      query += ` AND br.blood_group = ?`;
      params.push(blood_group);
    }

    if (urgency) {
      query += ` AND br.urgency = ?`;
      params.push(urgency);
    }

    if (city) {
      query += ` AND br.city LIKE ?`;
      params.push(`%${city}%`);
    }

    query += ` ORDER BY CASE br.urgency WHEN 'Emergency' THEN 1 WHEN 'Urgent' THEN 2 ELSE 3 END, br.id DESC`;

    const requests = await db.query(query, params);

    // Attach area coordinates to requests for map plotting
    requests.forEach(r => {
      r.coords = getLocationCoordinates(r.area, r.city);
    });

    return res.json({ success: true, count: requests.length, requests });
  } catch (err) {
    console.error('Get requests error:', err);
    return res.status(500).json({ success: false, message: 'Server error retrieving blood requests.' });
  }
};

// Trigger Donor Fallback for a Request
exports.triggerDonorFallback = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const request = await db.getOne('SELECT * FROM blood_requests WHERE id = ?', [id]);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Blood request not found.' });
    }

    if (request.requester_id !== userId && userRole !== 'Admin' && userRole !== 'Hospital') {
      return res.status(403).json({ success: false, message: 'Unauthorized to trigger donor fallback for this request.' });
    }

    if (request.status === 'Fulfilled' || request.status === 'Cancelled') {
      return res.status(400).json({ success: false, message: `Cannot activate fallback for a ${request.status} request.` });
    }

    // Determine unmet units
    const unitsStillNeeded = request.remaining_units > 0 ? request.remaining_units : request.units_required;

    // Notify matching donors
    let notifiedCount = 0;
    try {
      const matchedDonors = await findMatchingDonors({
        blood_group: request.blood_group,
        city: request.city,
        area: request.area,
        urgency: 'Emergency'
      });

      for (const donor of matchedDonors.slice(0, 10)) {
        await db.execute(
          `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
          [
            donor.user_id,
            `🚨 URGENT Donor Alert: ${unitsStillNeeded} unit(s) of ${request.blood_group} needed at ${request.hospital_name}, ${request.area}, ${request.city}. Please respond if available.`,
            'request'
          ]
        );
        notifiedCount++;
      }
    } catch (dErr) {
      console.error('Error finding donors for fallback:', dErr);
    }

    // Update request state
    await db.execute(
      `UPDATE blood_requests SET 
        donor_fallback_active = 1,
        immediate_donor_alert = 1
       WHERE id = ?`,
      [id]
    );

    // Notify requester
    await db.execute(
      `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
      [
        request.requester_id,
        `⚡ Donor fallback activated for Request #${id}. ${notifiedCount > 0 ? `${notifiedCount} local donors alerted.` : 'Local donors active.'}`,
        'status_update'
      ]
    );

    return res.json({
      success: true,
      message: `Donor fallback activated! ${notifiedCount > 0 ? `${notifiedCount} matching donors notified in your area.` : 'Matching donors alerted.'}`,
      notifiedCount
    });
  } catch (err) {
    console.error('triggerDonorFallback error:', err);
    return res.status(500).json({ success: false, message: 'Server error activating donor fallback.' });
  }
};

// Get Request by ID
exports.getRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    const request = await db.getOne(
      `SELECT br.*, u.name as requester_name, u.email as requester_email, u.phone as requester_phone
       FROM blood_requests br
       JOIN users u ON br.requester_id = u.id
       WHERE br.id = ?`,
      [id]
    );

    if (!request) {
      return res.status(404).json({ success: false, message: 'Blood request not found.' });
    }

    // Get linked donation requests
    const donationRequests = await db.query(
      `SELECT dr.*, d.blood_group, d.availability, u.name as donor_name, u.phone as donor_phone, u.city as donor_city
       FROM donation_requests dr
       JOIN donors d ON dr.donor_id = d.id
       JOIN users u ON d.user_id = u.id
       WHERE dr.blood_request_id = ?`,
      [id]
    );

    return res.json({ success: true, request, donationRequests });
  } catch (err) {
    console.error('Get request by ID error:', err);
    return res.status(500).json({ success: false, message: 'Server error retrieving request details.' });
  }
};

// Update Blood Request Status (e.g. Fulfilled, Cancelled)
exports.updateRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    const validStatuses = ['Active', 'Pending', 'Accepted', 'Fulfilled', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status provided.' });
    }

    const request = await db.getOne('SELECT * FROM blood_requests WHERE id = ?', [id]);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Blood request not found.' });
    }

    // Verify ownership or Admin role
    if (request.requester_id !== userId && userRole !== 'Admin' && userRole !== 'Hospital') {
      return res.status(403).json({ success: false, message: 'Unauthorized to update this request.' });
    }

    await db.execute('UPDATE blood_requests SET status = ? WHERE id = ?', [status, id]);

    // If status updated to Fulfilled, notify attached donors
    if (status === 'Fulfilled') {
      const linkedDonors = await db.query(
        `SELECT DISTINCT d.user_id FROM donation_requests dr JOIN donors d ON dr.donor_id = d.id WHERE dr.blood_request_id = ?`,
        [id]
      );
      for (const donor of linkedDonors) {
        await db.execute(
          `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
          [donor.user_id, `🎉 Blood Request #${id} at ${request.hospital_name} has been marked as Fulfilled! Thank you for your support.`, 'status_update']
        );
      }
    }

    return res.json({ success: true, message: `Blood request status updated to ${status}.` });
  } catch (err) {
    console.error('Update request status error:', err);
    return res.status(500).json({ success: false, message: 'Server error updating request status.' });
  }
};

// Send direct Donation Request to a Donor
exports.sendDonationRequest = async (req, res) => {
  try {
    const { blood_request_id, donor_id } = req.body;

    if (!blood_request_id || !donor_id) {
      return res.status(400).json({ success: false, message: 'blood_request_id and donor_id are required.' });
    }

    const bloodReq = await db.getOne('SELECT * FROM blood_requests WHERE id = ?', [blood_request_id]);
    if (!bloodReq) {
      return res.status(404).json({ success: false, message: 'Blood request not found.' });
    }

    const donor = await db.getOne('SELECT d.*, u.name FROM donors d JOIN users u ON d.user_id = u.id WHERE d.id = ?', [donor_id]);
    if (!donor) {
      return res.status(404).json({ success: false, message: 'Donor not found.' });
    }

    // Check if donation request already sent
    const existing = await db.getOne(
      'SELECT id FROM donation_requests WHERE blood_request_id = ? AND donor_id = ?',
      [blood_request_id, donor_id]
    );

    if (existing) {
      return res.status(400).json({ success: false, message: 'A donation request has already been sent to this donor.' });
    }

    const result = await db.execute(
      `INSERT INTO donation_requests (blood_request_id, donor_id, status) VALUES (?, ?, 'Pending')`,
      [blood_request_id, donor_id]
    );

    // Notify Donor
    await db.execute(
      `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
      [
        donor.user_id,
        `🩸 You have received a personal blood donation request for ${bloodReq.blood_group} at ${bloodReq.hospital_name}, ${bloodReq.city}.`,
        'request'
      ]
    );

    return res.status(201).json({
      success: true,
      message: `Donation request sent to ${donor.name}!`,
      donationRequestId: result.lastID
    });
  } catch (err) {
    console.error('Send donation request error:', err);
    return res.status(500).json({ success: false, message: 'Server error sending donation request.' });
  }
};

// Donor Accepts or Declines donation request
exports.respondDonationRequest = async (req, res) => {
  try {
    const { id } = req.params; // donation_request id
    const { status } = req.body; // Accepted or Declined
    const userId = req.user.id;

    if (!['Accepted', 'Declined'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be Accepted or Declined.' });
    }

    // Find donor ID for logged in user
    const donor = await db.getOne('SELECT id FROM donors WHERE user_id = ?', [userId]);
    if (!donor) {
      return res.status(403).json({ success: false, message: 'Only registered donors can respond to donation requests.' });
    }

    const donationReq = await db.getOne('SELECT * FROM donation_requests WHERE id = ? AND donor_id = ?', [id, donor.id]);
    if (!donationReq) {
      return res.status(404).json({ success: false, message: 'Donation request not found or not assigned to you.' });
    }

    await db.execute('UPDATE donation_requests SET status = ? WHERE id = ?', [status, id]);

    // Fetch details for notification
    const bloodReq = await db.getOne('SELECT * FROM blood_requests WHERE id = ?', [donationReq.blood_request_id]);
    const donorUser = await db.getOne('SELECT name, phone FROM users WHERE id = ?', [userId]);

    if (bloodReq) {
      // If accepted, update blood request status to Accepted if it was Pending/Active
      if (status === 'Accepted') {
        await db.execute('UPDATE blood_requests SET status = ? WHERE id = ?', ['Accepted', bloodReq.id]);
      }

      // Notify requester
      await db.execute(
        `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
        [
          bloodReq.requester_id,
          `📢 Donor ${donorUser.name} has ${status.toLowerCase()} your blood request for ${bloodReq.blood_group} at ${bloodReq.hospital_name}. ${status === 'Accepted' ? `Contact Phone: ${donorUser.phone}` : ''}`,
          'status_update'
        ]
      );
    }

    return res.json({
      success: true,
      message: `Donation request ${status.toLowerCase()} successfully.`
    });
  } catch (err) {
    console.error('Respond donation request error:', err);
    return res.status(500).json({ success: false, message: 'Server error responding to request.' });
  }
};

// Get requests specifically assigned to logged-in Donor
exports.getDonorDonationRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const donor = await db.getOne('SELECT id FROM donors WHERE user_id = ?', [userId]);

    if (!donor) {
      return res.json({ success: true, donationRequests: [] });
    }

    const requests = await db.query(
      `SELECT dr.id as donation_req_id, dr.status as donation_status, dr.created_at as request_sent_date,
              br.id as blood_req_id, br.hospital_name, br.blood_group, br.units_required, br.city, br.area, br.urgency, br.required_date, br.message, br.status as blood_req_status,
              u.name as requester_name, u.phone as requester_phone
       FROM donation_requests dr
       JOIN blood_requests br ON dr.blood_request_id = br.id
       JOIN users u ON br.requester_id = u.id
       WHERE dr.donor_id = ?
       ORDER BY dr.id DESC`,
      [donor.id]
    );

    return res.json({ success: true, count: requests.length, donationRequests: requests });
  } catch (err) {
    console.error('Get donor donation requests error:', err);
    return res.status(500).json({ success: false, message: 'Server error loading donor requests.' });
  }
};
