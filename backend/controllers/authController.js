const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { JWT_SECRET } = require('../middleware/authMiddleware');

exports.register = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      confirmPassword,
      role,
      city,
      area,
      blood_group,
      last_donation_date,
      availability
    } = req.body;

    // 1. Validations
    if (!name || !email || !phone || !password || !role || !city || !area) {
      return res.status(400).json({ success: false, message: 'All required fields must be filled.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    const validRoles = ['Donor', 'Blood Seeker', 'Hospital', 'Admin', 'Blood Bank'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid user role selected.' });
    }

    if (role === 'Donor') {
      const validBloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      if (!blood_group || !validBloodGroups.includes(blood_group)) {
        return res.status(400).json({ success: false, message: 'Please select a valid blood group for Donor registration.' });
      }
    }

    // Check if email already exists
    const existingUser = await db.getOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email address is already registered.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const userResult = await db.execute(
      `INSERT INTO users (name, email, phone, password, role, city, area) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, email.toLowerCase(), phone, hashedPassword, role, city, area]
    );

    const userId = userResult.lastID;
    let donorId = null;

    // If Donor role, insert into donors table
    if (role === 'Donor') {
      const donorRes = await db.execute(
        `INSERT INTO donors (user_id, blood_group, availability, last_donation_date, city, area) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, blood_group, availability || 'Available', last_donation_date || null, city, area]
      );
      donorId = donorRes.lastID;
    }

    // If Blood Bank role, insert into blood_banks table
    if (role === 'Blood Bank') {
      const { bank_name, license_number, address, operating_hours } = req.body;
      const bankName = bank_name || name;
      await db.execute(
        `INSERT INTO blood_banks (user_id, bank_name, license_number, city, area, address, operating_hours) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, bankName, license_number || '', city, area, address || '', operating_hours || '24/7']
      );
    }

    // Welcome Notification
    await db.execute(
      `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
      [userId, `Welcome to BloodLink, ${name}! Your account has been successfully created as a ${role}.`, 'info']
    );

    // Generate token
    const token = jwt.sign(
      { id: userId, name, email: email.toLowerCase(), role, city, area, donorId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Registration successful!',
      token,
      user: { id: userId, name, email: email.toLowerCase(), role, city, area, donorId, blood_group }
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = await db.getOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (user.status === 'Disabled') {
      return res.status(403).json({ success: false, message: 'Your account has been disabled by system administrator.' });
    }

    // Role validation: if user explicitly selected a role, ensure it matches account
    if (role && user.role !== role) {
      return res.status(400).json({
        success: false,
        message: `This account is registered as '${user.role}', not as '${role}'. Please switch to the '${user.role}' role or check your credentials.`
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Get donor profile if applicable
    let donor = null;
    if (user.role === 'Donor') {
      donor = await db.getOne('SELECT * FROM donors WHERE user_id = ?', [user.id]);
    }

    // Get blood bank profile if applicable
    let bloodBank = null;
    if (user.role === 'Blood Bank') {
      bloodBank = await db.getOne('SELECT id, bank_name, city, area FROM blood_banks WHERE user_id = ?', [user.id]);
    }

    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        city: user.city,
        area: user.area,
        donorId: donor ? donor.id : null,
        bloodBankId: bloodBank ? bloodBank.id : null
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        city: user.city,
        area: user.area,
        donorId: donor ? donor.id : null,
        blood_group: donor ? donor.blood_group : null,
        availability: donor ? donor.availability : null,
        bloodBankId: bloodBank ? bloodBank.id : null,
        bankName: bloodBank ? bloodBank.bank_name : null
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

const { calculateDonorEligibility } = require('./donorController');

exports.getMe = async (req, res) => {
  try {
    const user = await db.getOne(
      'SELECT id, name, email, phone, role, city, area, status, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let donorProfile = null;
    if (user.role === 'Donor') {
      donorProfile = await db.getOne('SELECT * FROM donors WHERE user_id = ?', [user.id]);
      if (donorProfile) {
        donorProfile.eligibility = calculateDonorEligibility(donorProfile.last_donation_date);
      }
    }

    return res.json({
      success: true,
      user: {
        ...user,
        donor: donorProfile
      }
    });
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ success: false, message: 'Server error retrieving user data.' });
  }
};
