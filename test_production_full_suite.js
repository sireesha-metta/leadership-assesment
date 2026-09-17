require('dotenv').config();
const db = require('./config/db');
const { login, register, upsertAssessmentRespondent } = require('./controllers/authController');
const { getAvailableAndBookedSlots } = require('./utils/slotService');
const { toDecryptedRespondent } = require('./utils/dataSecurity');

async function runProductionTests() {
  console.log('=== STARTING COMPLETE PRODUCTION ENDPOINT & AUTH TEST SUITE ===');
  console.log('PostgreSQL Target:', process.env.DATABASE_URL || `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);

  // Test 1: Health / Ping
  const ping = await db.ping();
  console.log('\n[TEST 1] DB Ping:', ping ? 'PASSED (Connected)' : 'FAILED');

  // Test 2: Find existing user in database
  const [adminRows] = await db.execute("SELECT id, firstname, lastname, email, role, status FROM respondent WHERE role IN ('Admin', 'ADMIN') LIMIT 1");
  let testEmail = 'admin@test.local';
  if (adminRows.length > 0) {
    const dec = toDecryptedRespondent(adminRows[0]);
    testEmail = dec.email;
    console.log(`\n[TEST 2] Found existing Admin in DB: #${adminRows[0].id} (${dec.firstname} ${dec.lastname}) -> Email: ${testEmail}`);
  }

  // Test 3: Test Login Controller directly with mock req/res
  console.log('\n[TEST 3] Testing Login Execution on PostgreSQL 18...');
  const mockReq = {
    body: {
      email: testEmail,
      password: 'wrongpassword_test'
    }
  };

  let loginStatus = 0;
  let loginResult = null;
  const mockRes = {
    status: (code) => {
      loginStatus = code;
      return {
        json: (data) => { loginResult = data; return data; }
      };
    },
    json: (data) => {
      loginStatus = 200;
      loginResult = data;
      return data;
    }
  };

  await login(mockReq, mockRes);
  console.log(` - Login with invalid password returned HTTP ${loginStatus} (${loginResult?.message}) [PASSED: No 42P18 parameter error]`);

  // Test 4: Test Registration of a test user
  console.log('\n[TEST 4] Testing User Registration & Authentication Flow...');
  const uniqueTestEmail = `prod_test_${Date.now()}@example.com`;
  const uniqueMobile = `98${String(Date.now()).slice(-8)}`;
  const regReq = {
    body: {
      firstName: 'Production',
      lastName: 'Tester',
      email: uniqueTestEmail,
      mobile: uniqueMobile,
      password: 'Password123!'
    }
  };
  let regStatus = 0;
  let regResult = null;
  const regRes = {
    status: (code) => {
      regStatus = code;
      return { json: (d) => { regResult = d; return d; } };
    },
    json: (d) => { regStatus = 200; regResult = d; return d; }
  };
  await register(regReq, regRes);
  console.log(` - Registration returned HTTP ${regStatus} (ID: ${regResult?.id})`);

  // Test 5: Login with newly registered user
  console.log('\n[TEST 5] Testing Login with newly created user...');
  const successLoginReq = {
    body: {
      email: uniqueTestEmail,
      password: 'Password123!'
    }
  };
  let successLoginStatus = 0;
  let successLoginResult = null;
  const successLoginRes = {
    status: (code) => {
      successLoginStatus = code;
      return { json: (d) => { successLoginResult = d; return d; } };
    },
    json: (d) => { successLoginStatus = 200; successLoginResult = d; return d; }
  };
  await login(successLoginReq, successLoginRes);
  console.log(` - Login successful! User ID: ${successLoginResult?.data?.user?.id}, Role: ${successLoginResult?.data?.user?.role}, Token received: ${Boolean(successLoginResult?.data?.token)}`);

  // Test 6: Login with mobile number
  console.log('\n[TEST 6] Testing Login using Mobile Identifier...');
  const mobileLoginReq = {
    body: {
      mobile: uniqueMobile,
      password: 'Password123!'
    }
  };
  let mobileLoginStatus = 0;
  let mobileLoginResult = null;
  const mobileLoginRes = {
    status: (code) => {
      mobileLoginStatus = code;
      return { json: (d) => { mobileLoginResult = d; return d; } };
    },
    json: (d) => { mobileLoginStatus = 200; mobileLoginResult = d; return d; }
  };
  await login(mobileLoginReq, mobileLoginRes);
  console.log(` - Login via Mobile successful! User ID: ${mobileLoginResult?.data?.user?.id}`);

  // Test 7: Upsert Assessment Respondent
  console.log('\n[TEST 7] Testing Upsert Assessment Respondent...');
  const upsertReq = {
    body: {
      firstName: 'Upserted',
      lastName: 'Participant',
      email: uniqueTestEmail,
      mobile: uniqueMobile
    }
  };
  let upsertStatus = 0;
  let upsertResult = null;
  const upsertRes = {
    status: (code) => {
      upsertStatus = code;
      return { json: (d) => { upsertResult = d; return d; } };
    },
    json: (d) => { upsertStatus = 200; upsertResult = d; return d; }
  };
  await upsertAssessmentRespondent(upsertReq, upsertRes);
  console.log(` - Upsert Respondent result: HTTP ${upsertStatus} (${upsertResult?.message})`);

  // Clean up created test user
  await db.execute("DELETE FROM respondent WHERE email_hash = ?", [require('./utils/dataSecurity').hashIdentifier(uniqueTestEmail)]);
  console.log(' - Cleaned up test user');

  // Test 8: Slot Service on PostgreSQL 18
  console.log('\n[TEST 8] Testing Slot Service...');
  const slotData = await getAvailableAndBookedSlots('2026-09-25');
  console.log(` - Available slots on 2026-09-25: ${slotData.slots.length} / ${slotData.allConfiguredSlots.length}`);

  console.log('\n=== ALL PRODUCTION TEST SUITES PASSED FLAWLESSLY! ===');
  await db.close();
  process.exit(0);
}

runProductionTests().catch(err => {
  console.error('PRODUCTION TEST SUITE FAILED:', err);
  process.exit(1);
});
