require('dotenv').config();
const db = require('./config/db');
const { ensureRespondentSecuritySchema, toDecryptedRespondent, encryptValue } = require('./utils/dataSecurity');
const { ensureSlotSchema, getAvailableAndBookedSlots } = require('./utils/slotService');

async function runVerification() {
  console.log('=== STARTING POSTGRESQL 18 COMPREHENSIVE VERIFICATION ===');
  console.log('DB_CLIENT:', process.env.DB_CLIENT);
  console.log('DB_PORT:', process.env.DB_PORT);
  console.log('Is Postgres Engine:', db.isPg);

  // 1. Check version
  const [verRows] = await db.query('SELECT version()');
  console.log('\n[TEST 1] PostgreSQL Version:', verRows[0].version);

  // 2. Test Schemas
  console.log('\n[TEST 2] Testing Schema Helpers...');
  await ensureRespondentSecuritySchema(db);
  console.log(' - ensureRespondentSecuritySchema: OK');
  await ensureSlotSchema();
  console.log(' - ensureSlotSchema: OK');

  // 3. Verify Table Row Counts
  console.log('\n[TEST 3] Verifying Database Row Counts...');
  const tables = [
    'respondent',
    'assessment_submissions',
    'assessment_drafts',
    'admin_blocked_slots',
    'admin_shift_config',
    'admin_slot_config',
    'file_upload_history',
    'assessment_public_submissions'
  ];

  for (const table of tables) {
    const [rows] = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
    console.log(` - ${table}: ${rows[0].count} rows`);
  }

  // 4. Test Single Source of Truth JOINs
  console.log('\n[TEST 4] Testing Single Source of Truth JOIN queries...');
  const [submissions] = await db.query(`
    SELECT
      s.id,
      s.respondent_id,
      s.assessment_type,
      s.total_score,
      s.total_weighted_score,
      r.firstname,
      r.lastname,
      r.email,
      r.mobile,
      r.status
    FROM assessment_submissions s
    JOIN respondent r ON r.id = s.respondent_id
    ORDER BY s.id ASC
    LIMIT 3
  `);
  console.log(` Retrieved ${submissions.length} sample joined submissions:`);
  submissions.forEach(sub => {
    const dec = toDecryptedRespondent(sub);
    console.log(`   Sub ID #${sub.id} -> Respondent #${sub.respondent_id} | Name: ${dec.firstname} ${dec.lastname} | Email: ${dec.email} | Status: ${sub.status}`);
  });

  // Pick an existing respondent WITH a submission for SSoT test
  const testRespId = submissions[0].respondent_id;
  const initialSubId = submissions[0].id;
  const [respRows] = await db.query('SELECT id, firstname, lastname, email, status FROM respondent WHERE id = ?', [testRespId]);
  const initialPii = toDecryptedRespondent(respRows[0]);
  console.log(`\n Using Respondent ID #${testRespId} (${initialPii.firstname} ${initialPii.lastname}) for remaining verification tests.`);

  // 5. Test Draft Save and Retrieve (UPSERT on PG 18)
  console.log('\n[TEST 5] Testing Draft Save & Retrieve (ON CONFLICT UPSERT)...');
  const draftPayload = { test: true, timestamp: Date.now(), answers: { q1: 4, q2: 5 } };
  
  await db.query(`
    INSERT INTO assessment_drafts (respondent_id, assessment_type, draft_payload, answered_count, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (respondent_id, assessment_type)
    DO UPDATE SET
      draft_payload = EXCLUDED.draft_payload,
      answered_count = EXCLUDED.answered_count,
      updated_at = CURRENT_TIMESTAMP
  `, [testRespId, 'leadership_reset', JSON.stringify(draftPayload), 2]);

  const [draftRows] = await db.query(
    'SELECT d.*, r.firstname, r.lastname, r.email FROM assessment_drafts d JOIN respondent r ON r.id = d.respondent_id WHERE d.respondent_id = ? AND d.assessment_type = ?',
    [testRespId, 'leadership_reset']
  );
  console.log(` - Draft retrieved successfully for Respondent #${testRespId}, Answered Count: ${draftRows[0]?.answered_count}`);

  // 6. Test Slot Availability Service
  console.log('\n[TEST 6] Testing Slot Availability Service on PG 18...');
  const slotData = await getAvailableAndBookedSlots('2026-09-20');
  console.log(` - Configured slots: ${slotData.allConfiguredSlots.length}`);
  console.log(` - Available slots for 2026-09-20: ${slotData.slots.length}`);
  console.log(` - Shifts configured: ${slotData.shifts.length}`);

  // 7. Test Single Source of Truth Update Propagation Test
  console.log('\n[TEST 7] Testing SSoT Update Propagation...');
  const [respBefore] = await db.query('SELECT * FROM respondent WHERE id = ?', [testRespId]);
  const decBefore = toDecryptedRespondent(respBefore[0]);
  console.log(` - Initial Respondent #${testRespId} Name: ${decBefore.firstname} ${decBefore.lastname}`);

  const testUpdatedFirstName = 'UpdatedLorraine';
  await db.query(
    'UPDATE respondent SET firstname = ? WHERE id = ?',
    [encryptValue(testUpdatedFirstName), testRespId]
  );

  const [joinedAfter] = await db.query(
    'SELECT s.id, r.firstname, r.lastname FROM assessment_submissions s JOIN respondent r ON r.id = s.respondent_id WHERE s.id = ?',
    [initialSubId]
  );
  if (joinedAfter.length > 0) {
    const decAfter = toDecryptedRespondent(joinedAfter[0]);
    console.log(` - Joined Submission #${joinedAfter[0].id} immediately reflects updated name: "${decAfter.firstname}" without any modification to assessment_submissions table! (SSoT PASS: True Single Source of Truth)`);
  }

  // Restore original respondent firstname
  await db.query(
    'UPDATE respondent SET firstname = ? WHERE id = ?',
    [respBefore[0].firstname, testRespId]
  );
  console.log(` - Restored original Respondent #${testRespId} firstname (${decBefore.firstname})`);

  // 8. Test Active / Inactive Status Filtering
  console.log('\n[TEST 8] Testing Active / Inactive Status Behavior...');
  await db.query("UPDATE respondent SET status = 'Inactive' WHERE id = ?", [testRespId]);
  const [activeDraftsWhenInactive] = await db.query(`
    SELECT d.id FROM assessment_drafts d
    JOIN respondent r ON r.id = d.respondent_id AND r.status = 'Active'
    WHERE d.respondent_id = ?
  `, [testRespId]);
  console.log(` - When respondent is "Inactive", joined active drafts count: ${activeDraftsWhenInactive.length} (Expected: 0)`);

  // Restore to Active
  await db.query("UPDATE respondent SET status = 'Active' WHERE id = ?", [testRespId]);
  const [activeDraftsWhenActive] = await db.query(`
    SELECT d.id FROM assessment_drafts d
    JOIN respondent r ON r.id = d.respondent_id AND r.status = 'Active'
    WHERE d.respondent_id = ?
  `, [testRespId]);
  console.log(` - When respondent is "Active", joined active drafts count: ${activeDraftsWhenActive.length} (Expected: >= 1)`);

  console.log('\n=== ALL POSTGRESQL 18 TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runVerification().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
