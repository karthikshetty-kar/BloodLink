const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'bloodlink.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
  }
});

// Helper function to convert db.run, db.get, db.all to Promises
db.query = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

db.getOne = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

db.execute = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

// Initialize Tables & Seed Data
async function initDatabase() {
  await db.execute(`PRAGMA foreign_keys = ON;`);

  // 1. Users Table - Blood Bank role is supported via migration
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      city TEXT NOT NULL,
      area TEXT NOT NULL,
      status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Disabled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Donors Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS donors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      blood_group TEXT NOT NULL CHECK(blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
      availability TEXT DEFAULT 'Available' CHECK(availability IN ('Available', 'Not Available')),
      last_donation_date TEXT,
      city TEXT NOT NULL,
      area TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 3. Blood Banks Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS blood_banks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      bank_name TEXT NOT NULL,
      license_number TEXT,
      city TEXT NOT NULL,
      area TEXT NOT NULL,
      address TEXT,
      operating_hours TEXT DEFAULT '24/7',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 4. Blood Bank Inventory Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS blood_bank_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blood_bank_id INTEGER NOT NULL,
      blood_group TEXT NOT NULL CHECK(blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
      units_available INTEGER DEFAULT 0,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (blood_bank_id) REFERENCES blood_banks(id) ON DELETE CASCADE
    )
  `);

  // 5. Blood Requests Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS blood_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      hospital_name TEXT NOT NULL,
      blood_group TEXT NOT NULL CHECK(blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
      units_required INTEGER NOT NULL DEFAULT 1,
      city TEXT NOT NULL,
      area TEXT NOT NULL,
      urgency TEXT DEFAULT 'Normal' CHECK(urgency IN ('Normal', 'Urgent', 'Emergency')),
      required_date TEXT,
      message TEXT,
      status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Active', 'Accepted', 'Fulfilled', 'Cancelled')),
      assigned_blood_bank_id INTEGER,
      confirmed_units INTEGER DEFAULT 0,
      remaining_units INTEGER DEFAULT 0,
      bank_response TEXT,
      bank_response_notes TEXT,
      bank_responded_at DATETIME,
      donor_fallback_active INTEGER DEFAULT 0,
      immediate_donor_alert INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_blood_bank_id) REFERENCES blood_banks(id) ON DELETE SET NULL
    )
  `);

  // 6. Blood Bank Responses Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS blood_bank_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blood_request_id INTEGER NOT NULL,
      blood_bank_id INTEGER NOT NULL,
      response TEXT NOT NULL,
      confirmed_units INTEGER DEFAULT 0,
      notes TEXT,
      responded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (blood_request_id) REFERENCES blood_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (blood_bank_id) REFERENCES blood_banks(id) ON DELETE CASCADE
    )
  `);

  // 7. Donation Requests Table (Requester -> Donor)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS donation_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blood_request_id INTEGER NOT NULL,
      donor_id INTEGER NOT NULL,
      status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Accepted', 'Declined', 'Completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (blood_request_id) REFERENCES blood_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (donor_id) REFERENCES donors(id) ON DELETE CASCADE
    )
  `);

  // 8. Notifications Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Run migrations for existing databases
  await runMigrations();

  // Seed if empty
  const userCount = await db.getOne(`SELECT COUNT(*) as count FROM users`);
  if (userCount.count === 0) {
    console.log('Seeding initial data for BloodLink...');
    await seedInitialData();
  } else {
    // Seed blood banks if they don't exist yet
    const bbCount = await db.getOne(`SELECT COUNT(*) as count FROM blood_banks`);
    if (bbCount.count === 0) {
      console.log('Seeding blood bank demo accounts...');
      await seedBloodBanks();
    }
  }
}

async function runMigrations() {
  // Migration 0: Extend users.role CHECK constraint to include 'Blood Bank'
  // SQLite cannot ALTER a CHECK constraint, so we recreate the table if needed.
  try {
    const usersDDL = await db.getOne(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
    );
    if (usersDDL && usersDDL.sql && !usersDDL.sql.includes("'Blood Bank'")) {
      console.log("Migration: Updating users table to support 'Blood Bank' role...");
      await db.execute(`PRAGMA foreign_keys = OFF;`);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT NOT NULL,
          password TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('Donor', 'Blood Seeker', 'Hospital', 'Admin', 'Blood Bank')),
          city TEXT NOT NULL,
          area TEXT NOT NULL,
          status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Disabled')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.execute(`
        INSERT INTO users_new (id, name, email, phone, password, role, city, area, status, created_at)
        SELECT id, name, email, phone, password, role, city, area, status, created_at FROM users
      `);
      await db.execute(`DROP TABLE users`);
      await db.execute(`ALTER TABLE users_new RENAME TO users`);
      await db.execute(`PRAGMA foreign_keys = ON;`);
      console.log("Migration: users table updated successfully.");
    }
  } catch (migErr) {
    console.error('Migration 0 error (users role constraint):', migErr.message);
    // Re-enable foreign keys on failure
    try { await db.execute(`PRAGMA foreign_keys = ON;`); } catch(_) {}
  }

  // Migration 1: Fix corrupted password hashes for seeded demo accounts
  // (old seeding used a non-bcrypt placeholder starting with $bloodlink$)
  try {
    const DEMO_ACCOUNTS = [
      { email: 'hospital@citycare.com', pw: '123456' },
      { email: 'seeker@gmail.com', pw: '123456' },
      { email: 'rahul@gmail.com', pw: '123456' },
      { email: 'priya@gmail.com', pw: '123456' },
      { email: 'aman@gmail.com', pw: '123456' },
      { email: 'sneha@gmail.com', pw: '123456' },
      { email: 'vikram@gmail.com', pw: '123456' },
      { email: 'admin@bloodlink.com', pw: 'admin123' },
    ];
    for (const { email, pw } of DEMO_ACCOUNTS) {
      const u = await db.getOne('SELECT id, password FROM users WHERE email = ?', [email]);
      if (u && u.password && !u.password.startsWith('$2')) {
        const fixed = await bcrypt.hash(pw, 10);
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [fixed, u.id]);
        console.log(`Migration: Fixed password hash for ${email}`);
      }
    }
  } catch (migErr1) {
    console.error('Migration 1 error (password fix):', migErr1.message);
  }

  // Add new columns to blood_requests if they don't exist
  const columnsToAdd = [
    { col: 'assigned_blood_bank_id', def: 'INTEGER' },
    { col: 'confirmed_units', def: 'INTEGER DEFAULT 0' },
    { col: 'remaining_units', def: 'INTEGER DEFAULT 0' },
    { col: 'bank_response', def: 'TEXT' },
    { col: 'bank_response_notes', def: 'TEXT' },
    { col: 'bank_responded_at', def: 'DATETIME' },
    { col: 'donor_fallback_active', def: 'INTEGER DEFAULT 0' },
    { col: 'immediate_donor_alert', def: 'INTEGER DEFAULT 0' },
  ];

  const tableInfo = await db.query(`PRAGMA table_info(blood_requests)`);
  const existingCols = tableInfo.map(c => c.name);

  for (const { col, def } of columnsToAdd) {
    if (!existingCols.includes(col)) {
      try {
        await db.execute(`ALTER TABLE blood_requests ADD COLUMN ${col} ${def}`);
        console.log(`Migration: Added column ${col} to blood_requests`);
      } catch (e) {
        // Column may already exist
      }
    }
  }
}

async function seedBloodBanks() {
  const defaultPassword = await bcrypt.hash('123456', 10);

  const banks = [
    {
      name: 'Mira Road Blood Bank', email: 'bloodbank@mira.org', phone: '9820099001',
      city: 'Mumbai', area: 'Mira Road', address: 'Station Road, Mira Road East, Mumbai - 401107',
      license: 'MH-BB-2024-001', hours: '24/7',
      inventory: { 'A+': 15, 'A-': 5, 'B+': 20, 'B-': 3, 'AB+': 8, 'AB-': 2, 'O+': 25, 'O-': 10 }
    },
    {
      name: 'Andheri City Blood Centre', email: 'bloodbank@andheri.org', phone: '9820099002',
      city: 'Mumbai', area: 'Andheri', address: 'Near Andheri Station, West, Mumbai - 400058',
      license: 'MH-BB-2024-002', hours: '8am-10pm',
      inventory: { 'A+': 10, 'A-': 2, 'B+': 8, 'B-': 1, 'AB+': 5, 'AB-': 1, 'O+': 18, 'O-': 6 }
    }
  ];

  for (const bank of banks) {
    const existing = await db.getOne(`SELECT id FROM users WHERE email = ?`, [bank.email]);
    if (existing) continue;

    const uRes = await db.execute(
      `INSERT INTO users (name, email, phone, password, role, city, area) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [bank.name, bank.email, bank.phone, defaultPassword, 'Blood Bank', bank.city, bank.area]
    );

    if (uRes.lastID) {
      const bbRes = await db.execute(
        `INSERT INTO blood_banks (user_id, bank_name, license_number, city, area, address, operating_hours) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uRes.lastID, bank.name, bank.license, bank.city, bank.area, bank.address, bank.hours]
      );

      if (bbRes.lastID) {
        for (const [bg, units] of Object.entries(bank.inventory)) {
          await db.execute(
            `INSERT INTO blood_bank_inventory (blood_bank_id, blood_group, units_available) VALUES (?, ?, ?)`,
            [bbRes.lastID, bg, units]
          );
        }

        await db.execute(
          `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
          [uRes.lastID, `Welcome to BloodLink! Your Blood Bank account (${bank.name}) is active. Keep your inventory updated.`, 'info']
        );
      }
    }
  }

  console.log('Blood bank accounts seeded: bloodbank@mira.org | bloodbank@andheri.org (password: 123456)');
}

async function seedInitialData() {
  const defaultPassword = await bcrypt.hash('123456', 10);
  const adminPassword = await bcrypt.hash('admin123', 10);

  // 1. Admin User
  await db.execute(
    `INSERT INTO users (name, email, phone, password, role, city, area) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['System Admin', 'admin@bloodlink.com', '9876543210', adminPassword, 'Admin', 'Mumbai', 'Central']
  );

  // 2. Hospital User
  const hospitalRes = await db.execute(
    `INSERT INTO users (name, email, phone, password, role, city, area) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['CityCare Hospital', 'hospital@citycare.com', '9876543211', defaultPassword, 'Hospital', 'Mumbai', 'Andheri']
  );

  // 3. Blood Seeker User
  const seekerRes = await db.execute(
    `INSERT INTO users (name, email, phone, password, role, city, area) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['Amit Kumar', 'seeker@gmail.com', '9876543212', defaultPassword, 'Blood Seeker', 'Mumbai', 'Andheri']
  );

  // 4. Sample Donors
  const sampleDonors = [
    { name: 'Rahul Sharma', email: 'rahul@gmail.com', phone: '9820011223', bg: 'O+', city: 'Mumbai', area: 'Andheri', avail: 'Available', date: '2026-05-15' },
    { name: 'Priya Patel', email: 'priya@gmail.com', phone: '9820022334', bg: 'A+', city: 'Mumbai', area: 'Bandra', avail: 'Available', date: '2026-06-10' },
    { name: 'Aman Gupta', email: 'aman@gmail.com', phone: '9820033445', bg: 'B+', city: 'Thane', area: 'Naupada', avail: 'Available', date: '2026-04-20' },
    { name: 'Sneha Verma', email: 'sneha@gmail.com', phone: '9820044556', bg: 'O-', city: 'Mumbai', area: 'Dadar', avail: 'Not Available', date: '2026-07-01' },
    { name: 'Vikram Singh', email: 'vikram@gmail.com', phone: '9820055667', bg: 'AB+', city: 'Navi Mumbai', area: 'Vashi', avail: 'Available', date: '2026-03-12' }
  ];

  const createdDonorIds = [];

  for (const d of sampleDonors) {
    const uRes = await db.execute(
      `INSERT INTO users (name, email, phone, password, role, city, area) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [d.name, d.email, d.phone, defaultPassword, 'Donor', d.city, d.area]
    );
    const donorRes = await db.execute(
      `INSERT INTO donors (user_id, blood_group, availability, last_donation_date, city, area) VALUES (?, ?, ?, ?, ?, ?)`,
      [uRes.lastID, d.bg, d.avail, d.date, d.city, d.area]
    );
    createdDonorIds.push({ userId: uRes.lastID, donorId: donorRes.lastID, name: d.name });
  }

  // 5. Sample Blood Request
  const requestRes = await db.execute(
    `INSERT INTO blood_requests (requester_id, hospital_name, blood_group, units_required, city, area, urgency, required_date, message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [seekerRes.lastID, 'CityCare Hospital', 'O+', 2, 'Mumbai', 'Andheri', 'Emergency', '2026-08-15', 'Urgent O+ blood needed for surgery.', 'Active']
  );

  // 6. Sample Donation Request
  const firstRahul = createdDonorIds[0];
  await db.execute(
    `INSERT INTO donation_requests (blood_request_id, donor_id, status) VALUES (?, ?, ?)`,
    [requestRes.lastID, firstRahul.donorId, 'Pending']
  );

  // 7. Initial Notification
  await db.execute(
    `INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)`,
    [firstRahul.userId, '🔔 New Emergency Blood Request: 2 Units of O+ required at CityCare Hospital, Andheri.', 'request']
  );

  // 8. Seed blood banks
  await seedBloodBanks();

  console.log('Database seeded successfully with default accounts!');
}

initDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
});

module.exports = db;
