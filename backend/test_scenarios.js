const http = require('http');

function request(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : '';
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (postData) headers['Content-Length'] = Buffer.byteLength(postData);

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 ========================================================');
  console.log('   STARTING BLOODLINK COMPREHENSIVE TEST SUITE (15 SCENARIOS)');
  console.log('===========================================================');

  let passed = 0;
  let failed = 0;

  function assert(name, condition, extra = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${name} ${extra}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name} ${extra}`);
      failed++;
    }
  }

  // 1. Hospital Login
  console.log('\n--- Test 1: Hospital Authentication & Role Enforcement ---');
  const hospLogin = await request('POST', '/api/auth/login', {
    email: 'hospital@citycare.com',
    password: '123456',
    role: 'Hospital'
  });
  assert('Hospital login succeeds', hospLogin.status === 200 && hospLogin.data.success);
  assert('Hospital user role is Hospital', hospLogin.data.user?.role === 'Hospital');
  assert('Hospital name is CityCare Hospital', hospLogin.data.user?.name === 'CityCare Hospital');
  const hospToken = hospLogin.data.token;
  const hospUserId = hospLogin.data.user.id;

  // Test role mismatch on login
  const hospRoleMismatch = await request('POST', '/api/auth/login', {
    email: 'hospital@citycare.com',
    password: '123456',
    role: 'Donor'
  });
  assert('Login role mismatch rejected with 400', hospRoleMismatch.status === 400);

  // 2. Seeker Login
  console.log('\n--- Test 2: Seeker Authentication & Identity ---');
  const seekerLogin = await request('POST', '/api/auth/login', {
    email: 'seeker@gmail.com',
    password: '123456',
    role: 'Blood Seeker'
  });
  assert('Seeker login succeeds', seekerLogin.status === 200 && seekerLogin.data.success);
  assert('Seeker role is Blood Seeker', seekerLogin.data.user?.role === 'Blood Seeker');
  assert('Seeker name is Amit Kumar', seekerLogin.data.user?.name === 'Amit Kumar');
  const seekerToken = seekerLogin.data.token;
  const seekerUserId = seekerLogin.data.user.id;

  // 3. Donor and Admin Login
  console.log('\n--- Test 3: Donor & Admin Login Working ---');
  const donorLogin = await request('POST', '/api/auth/login', {
    email: 'rahul@gmail.com',
    password: '123456',
    role: 'Donor'
  });
  assert('Donor login succeeds', donorLogin.status === 200 && donorLogin.data.user?.role === 'Donor');
  const donorToken = donorLogin.data.token;

  const adminLogin = await request('POST', '/api/auth/login', {
    email: 'admin@bloodlink.com',
    password: 'admin123',
    role: 'Admin'
  });
  assert('Admin login succeeds', adminLogin.status === 200 && adminLogin.data.user?.role === 'Admin');

  // 4. Blood Bank Login & Dashboard
  console.log('\n--- Test 4: Blood Bank Login & Dashboard Stats ---');
  const bbLogin = await request('POST', '/api/auth/login', {
    email: 'bloodbank@mira.org',
    password: '123456',
    role: 'Blood Bank'
  });
  assert('Blood Bank login succeeds', bbLogin.status === 200 && bbLogin.data.user?.role === 'Blood Bank');
  assert('Blood Bank bankName returned', !!bbLogin.data.user?.bankName);
  const bbToken = bbLogin.data.token;

  const bbStats = await request('GET', '/api/bloodbank/dashboard-stats', null, bbToken);
  assert('Blood Bank dashboard stats accessible', bbStats.status === 200 && bbStats.data.stats?.inventory?.length > 0);
  console.log(`     Total units in stock: ${bbStats.data.stats?.totalUnitsInStock}`);

  // 5. Hospital Emergency Request Creation & SQLite Persistence
  console.log('\n--- Test 5: Hospital Emergency Request Creation ---');
  const createReq = await request('POST', '/api/requests', {
    hospital_name: 'CityCare Hospital',
    blood_group: 'AB-',
    units_required: 1,
    city: 'Mumbai',
    area: 'Mira Road',
    urgency: 'Emergency',
    required_date: '2026-11-10',
    message: 'Automated test emergency request'
  }, hospToken);
  assert('Emergency request created successfully', createReq.status === 201 && createReq.data.success);
  const testReqId = createReq.data.requestId;
  assert('Request assigned to suitable bank (Mira Road)', !!createReq.data.assignedBank);

  // 6. Request Retrieval & Visibility After Refresh
  console.log('\n--- Test 6: Request Retrieval via Requester ID ---');
  const myReqs = await request('GET', `/api/requests?requester_id=${hospUserId}`, null, hospToken);
  assert('Hospital requests retrieved', myReqs.status === 200 && myReqs.data.requests?.length > 0);
  const foundReq = myReqs.data.requests.find(r => r.id === testReqId);
  assert('Newly created request found in database', !!foundReq);
  assert('Request retains correct units and status', foundReq?.units_required === 1 && foundReq?.status === 'Active');

  // 7. Assigned Blood Bank Receives and Views Request
  console.log('\n--- Test 7: Assigned Blood Bank Views Assigned Request ---');
  const assignedReqs = await request('GET', '/api/bloodbank/assigned-requests', null, bbToken);
  assert('Blood bank retrieves assigned requests', assignedReqs.status === 200 && assignedReqs.data.success);
  const bbFoundReq = assignedReqs.data.requests.find(r => r.id === testReqId);
  assert('Target request visible to assigned Blood Bank', !!bbFoundReq);

  // 8. Full Availability Response
  console.log('\n--- Test 8: Blood Bank Confirms Full Availability ---');
  // Check initial AB- inventory
  const initialInvProfile = await request('GET', '/api/bloodbank/profile', null, bbToken);
  const initialABMinus = initialInvProfile.data.bank?.inventory?.find(i => i.blood_group === 'AB-')?.units_available || 0;

  const fullResp = await request('POST', `/api/bloodbank/respond/${testReqId}`, {
    response: 'Fully Available',
    confirmed_units: 1,
    notes: 'Full units confirmed from batch BB-01'
  }, bbToken);
  assert('Full availability response recorded', fullResp.status === 200 && fullResp.data.confirmed_units === 1);
  assert('Remaining units is 0', fullResp.data.remaining_units === 0);

  // Verify inventory was deducted by 1
  const afterInvProfile = await request('GET', '/api/bloodbank/profile', null, bbToken);
  const afterABMinus = afterInvProfile.data.bank?.inventory?.find(i => i.blood_group === 'AB-')?.units_available || 0;
  assert('Inventory deducted correctly (1 unit)', afterABMinus === initialABMinus - 1, `(was ${initialABMinus}, now ${afterABMinus})`);

  // 9. Partial Availability Response & Remaining Quantity
  console.log('\n--- Test 9: Partial Availability Response ---');
  // Create a 2nd request for A- with 3 units
  const createReq2 = await request('POST', '/api/requests', {
    hospital_name: 'CityCare Hospital',
    blood_group: 'A-',
    units_required: 3,
    city: 'Mumbai',
    area: 'Mira Road',
    urgency: 'Urgent',
    required_date: '2026-11-12',
    message: 'Partial fulfillment test'
  }, hospToken);
  const testReqId2 = createReq2.data.requestId;

  const partialResp = await request('POST', `/api/bloodbank/respond/${testReqId2}`, {
    response: 'Partially Available',
    confirmed_units: 1,
    notes: 'Only 1 unit available in stock currently'
  }, bbToken);
  assert('Partial response recorded', partialResp.status === 200 && partialResp.data.confirmed_units === 1);
  assert('Remaining units correctly calculated (2 needed)', partialResp.data.remaining_units === 2);
  assert('Donor fallback activated for partial fulfillment', partialResp.data.donor_fallback === true);

  // 10. Unavailable Response Triggers Full Fallback
  console.log('\n--- Test 10: Unavailable Response Triggers Fallback ---');
  const createReq3 = await request('POST', '/api/requests', {
    hospital_name: 'CityCare Hospital',
    blood_group: 'B-',
    units_required: 2,
    city: 'Mumbai',
    area: 'Mira Road',
    urgency: 'Normal',
    required_date: '2026-11-15',
    message: 'Unavailable test'
  }, hospToken);
  const testReqId3 = createReq3.data.requestId;

  const unavailResp = await request('POST', `/api/bloodbank/respond/${testReqId3}`, {
    response: 'Unavailable',
    confirmed_units: 0,
    notes: 'No stock available for B-'
  }, bbToken);
  assert('Unavailable response accepted', unavailResp.status === 200);
  assert('Remaining units equals total requested (2)', unavailResp.data.remaining_units === 2);
  assert('Donor fallback flag is true', unavailResp.data.donor_fallback === true);

  // 11. Nonresponsive Bank / Manual Escalation Fallback
  console.log('\n--- Test 11: Manual Escalation / Parallel Donor Outreach ---');
  // Create a pending request
  const createReq4 = await request('POST', '/api/requests', {
    hospital_name: 'CityCare Hospital',
    blood_group: 'O-',
    units_required: 2,
    city: 'Mumbai',
    area: 'Mira Road',
    urgency: 'Emergency',
    required_date: '2026-11-10',
    message: 'Testing manual escalation'
  }, hospToken);
  const testReqId4 = createReq4.data.requestId;

  // Trigger fallback without waiting for bank
  const fallbackRes = await request('POST', `/api/requests/${testReqId4}/trigger-donor-fallback`, {}, hospToken);
  assert('Manual fallback trigger succeeds', fallbackRes.status === 200 && fallbackRes.data.success);
  console.log(`     Donors notified: ${fallbackRes.data.notifiedCount}`);

  // Verify request updated
  const checkReq4 = await request('GET', `/api/requests/${testReqId4}`);
  assert('donor_fallback_active is 1 in DB', checkReq4.data.request?.donor_fallback_active === 1);

  // 12. Prevent Overselling and Negative Inventory
  console.log('\n--- Test 12: Overselling and Negative Inventory Prevention ---');
  // Attempt to confirm 999 units of O- (more than bank has)
  const oversellResp = await request('POST', `/api/bloodbank/respond/${testReqId4}`, {
    response: 'Fully Available',
    confirmed_units: 999,
    notes: 'Attempting to oversell'
  }, bbToken);
  assert('Overselling rejected with 400 status', oversellResp.status === 400);

  // 13. Role-Based Authorization Security
  console.log('\n--- Test 13: Role-based Authorization Restrictions ---');
  // Donor attempts to access blood bank inventory API
  const unauthorizedBB = await request('PUT', '/api/bloodbank/inventory', { inventory: [{ blood_group: 'O+', units_available: 50 }] }, donorToken);
  assert('Donor blocked from Blood Bank inventory endpoint (403)', unauthorizedBB.status === 403);

  // Seeker attempts to fulfill a request owned by someone else
  const unauthorizedFulfill = await request('PUT', `/api/requests/${testReqId}`, { status: 'Fulfilled' }, seekerToken);
  assert('Non-owner Seeker blocked from altering Hospital request (403)', unauthorizedFulfill.status === 403);

  // 14. Donor Search and Leaflet Map Integration
  console.log('\n--- Test 14: Donor Search & Proximity Calculations ---');
  const donorSearch = await request('GET', `/api/donors/search?blood_group=${encodeURIComponent('O+')}&city=Mumbai`);
  assert('Donor search returns results', donorSearch.status === 200 && donorSearch.data.donors?.length > 0);
  const firstDonor = donorSearch.data.donors[0];
  assert('Donor has geolocation coordinates', !!firstDonor.coords && typeof firstDonor.coords.lat === 'number');
  assert('Donor has calculated proximity distance', firstDonor.distance_km !== undefined);

  // 15. Existing Database Records Preserved
  console.log('\n--- Test 15: Existing Database Records Preserved ---');
  const allUsers = await request('GET', '/api/admin/users', null, adminLogin.data.token);
  assert('Admin can view all users', allUsers.status === 200 && allUsers.data.users?.length >= 20);
  const seededSeeker = allUsers.data.users.find(u => u.email === 'seeker@gmail.com');
  const seededHospital = allUsers.data.users.find(u => u.email === 'hospital@citycare.com');
  const seededBB = allUsers.data.users.find(u => u.email === 'bloodbank@mira.org');
  assert('Seeded Seeker preserved', !!seededSeeker);
  assert('Seeded Hospital preserved', !!seededHospital);
  assert('Seeded Blood Bank preserved', !!seededBB);

  // Safeguard: Restore blood bank inventory to ensure tests do not permanently deplete stock
  if (initialInvProfile.data?.bank?.inventory) {
    const baselineInventory = initialInvProfile.data.bank.inventory.map(i => ({
      blood_group: i.blood_group,
      units_available: i.units_available
    }));
    await request('PUT', '/api/bloodbank/inventory', { inventory: baselineInventory }, bbToken);
    console.log('  🛡️ Data Protection: Blood Bank inventory restored to baseline after tests.');
  }

  console.log('\n===========================================================');
  console.log(`   TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===========================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
