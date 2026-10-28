const db = require('../database/db');
const { findMatchingDonors, calculateEstimatedDistance, getLocationCoordinates } = require('../utils/matching');

/**
 * Calculates donor eligibility based on last donation date (90-day rule).
 */
function calculateDonorEligibility(lastDonationDate) {
  if (!lastDonationDate) {
    return {
      is_eligible: true,
      last_donation_date: null,
      next_eligible_date: null,
      days_remaining: 0,
      status_text: 'Eligible to donate today!'
    };
  }

  const lastDate = new Date(lastDonationDate);
  if (isNaN(lastDate.getTime())) {
    return {
      is_eligible: true,
      last_donation_date: null,
      next_eligible_date: null,
      days_remaining: 0,
      status_text: 'Eligible to donate today!'
    };
  }

  const nextEligible = new Date(lastDate);
  nextEligible.setDate(nextEligible.getDate() + 90);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffTime = nextEligible.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  const isEligible = daysRemaining <= 0;
  const nextDateFormatted = nextEligible.toISOString().split('T')[0];

  return {
    is_eligible: isEligible,
    last_donation_date: lastDonationDate,
    next_eligible_date: nextDateFormatted,
    days_remaining: isEligible ? 0 : daysRemaining,
    status_text: isEligible ? 'Eligible to donate today!' : `Eligible in ${daysRemaining} day(s) on ${nextDateFormatted}`
  };
}

exports.searchDonors = async (req, res) => {
  try {
    const { blood_group, city, area, availability, urgency } = req.query;

    let query = `
      SELECT d.id, d.user_id, d.blood_group, d.availability, d.last_donation_date, d.city, d.area, d.created_at,
             u.name, u.phone
      FROM donors d
      JOIN users u ON d.user_id = u.id
      WHERE u.status = 'Active'
    `;

    const params = [];

    if (blood_group) {
      query += ` AND d.blood_group = ?`;
      params.push(blood_group);
    }

    if (city) {
      query += ` AND d.city LIKE ?`;
      params.push(`%${city}%`);
    }

    if (area) {
      query += ` AND d.area LIKE ?`;
      params.push(`%${area}%`);
    }

    // Default search filters to Available donors if availability param is provided or defaulted
    if (availability) {
      query += ` AND d.availability = ?`;
      params.push(availability);
    }

    query += ` ORDER BY CASE d.availability WHEN 'Available' THEN 1 ELSE 2 END, d.id DESC`;

    const donors = await db.query(query, params);

    // Attach area coordinates, estimated distance, and eligibility info to each donor
    donors.forEach(d => {
      d.coords = getLocationCoordinates(d.area, d.city);
      d.distance_km = calculateEstimatedDistance(d.area, d.city, area, city);
      d.eligibility = calculateDonorEligibility(d.last_donation_date);
    });

    // If emergency flag present, sort by emergency priority (Available + Nearest)
    if (urgency === 'Emergency') {
      donors.sort((a, b) => {
        const aAvail = a.availability === 'Available' ? 1 : 0;
        const bAvail = b.availability === 'Available' ? 1 : 0;
        if (aAvail !== bAvail) return bAvail - aAvail;
        const distA = typeof a.distance_km === 'number' ? a.distance_km : 999;
        const distB = typeof b.distance_km === 'number' ? b.distance_km : 999;
        return distA - distB;
      });
    }

    return res.json({
      success: true,
      count: donors.length,
      donors
    });
  } catch (err) {
    console.error('Search donors error:', err);
    return res.status(500).json({ success: false, message: 'Server error while searching donors.' });
  }
};

exports.getDonorById = async (req, res) => {
  try {
    const { id } = req.params;

    const donor = await db.getOne(
      `SELECT d.id, d.user_id, d.blood_group, d.availability, d.last_donation_date, d.city, d.area,
              u.name, u.email, u.phone
       FROM donors d
       JOIN users u ON d.user_id = u.id
       WHERE d.id = ? AND u.status = 'Active'`,
      [id]
    );

    if (!donor) {
      return res.status(404).json({ success: false, message: 'Donor not found.' });
    }

    donor.coords = getLocationCoordinates(donor.area, donor.city);
    donor.eligibility = calculateDonorEligibility(donor.last_donation_date);

    return res.json({ success: true, donor });
  } catch (err) {
    console.error('Get donor by ID error:', err);
    return res.status(500).json({ success: false, message: 'Server error retrieving donor details.' });
  }
};

exports.updateDonorProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone, city, area, blood_group, last_donation_date, availability } = req.body;

    // Validate availability input if passed
    if (availability && !['Available', 'Not Available'].includes(availability)) {
      return res.status(400).json({ success: false, message: 'Availability must be Available or Not Available.' });
    }

    // Get current user and donor record
    const currentUser = await db.getOne('SELECT * FROM users WHERE id = ?', [userId]);
    const currentDonor = await db.getOne('SELECT * FROM donors WHERE user_id = ?', [userId]);

    if (!currentUser || !currentDonor) {
      return res.status(404).json({ success: false, message: 'Donor account not found.' });
    }

    const updatedName = name !== undefined ? name : currentUser.name;
    const updatedPhone = phone !== undefined ? phone : currentUser.phone;
    const updatedCity = city !== undefined ? city : currentUser.city;
    const updatedArea = area !== undefined ? area : currentUser.area;

    const updatedBloodGroup = blood_group !== undefined ? blood_group : currentDonor.blood_group;
    const updatedLastDonationDate = last_donation_date !== undefined ? last_donation_date : currentDonor.last_donation_date;
    const updatedAvailability = availability !== undefined ? availability : currentDonor.availability;

    // Update users table
    await db.execute(
      `UPDATE users SET name = ?, phone = ?, city = ?, area = ? WHERE id = ?`,
      [updatedName, updatedPhone, updatedCity, updatedArea, userId]
    );

    // Update donors table
    await db.execute(
      `UPDATE donors SET blood_group = ?, last_donation_date = ?, availability = ?, city = ?, area = ? WHERE user_id = ?`,
      [updatedBloodGroup, updatedLastDonationDate, updatedAvailability, updatedCity, updatedArea, userId]
    );

    const updatedUser = await db.getOne('SELECT id, name, email, phone, role, city, area FROM users WHERE id = ?', [userId]);
    const updatedDonorRes = await db.getOne('SELECT * FROM donors WHERE user_id = ?', [userId]);

    if (updatedDonorRes) {
      updatedDonorRes.coords = getLocationCoordinates(updatedDonorRes.area, updatedDonorRes.city);
      updatedDonorRes.eligibility = calculateDonorEligibility(updatedDonorRes.last_donation_date);
    }

    return res.json({
      success: true,
      message: 'Profile updated successfully!',
      user: {
        ...updatedUser,
        donor: updatedDonorRes
      }
    });
  } catch (err) {
    console.error('Update donor profile error:', err);
    return res.status(500).json({ success: false, message: 'Server error updating profile.' });
  }
};

exports.getMatchingDonorsForRequest = async (req, res) => {
  try {
    const { blood_group, city, area, urgency } = req.query;

    if (!blood_group) {
      return res.status(400).json({ success: false, message: 'blood_group parameter is required.' });
    }

    const matchedDonors = await findMatchingDonors({ blood_group, city, area, urgency });

    matchedDonors.forEach(d => {
      d.coords = getLocationCoordinates(d.area, d.city);
      d.eligibility = calculateDonorEligibility(d.last_donation_date);
    });

    return res.json({
      success: true,
      count: matchedDonors.length,
      donors: matchedDonors
    });
  } catch (err) {
    console.error('Get matching donors error:', err);
    return res.status(500).json({ success: false, message: 'Server error matching donors.' });
  }
};

module.exports.calculateDonorEligibility = calculateDonorEligibility;
