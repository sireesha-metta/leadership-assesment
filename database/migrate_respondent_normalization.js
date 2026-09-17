const db = require("../config/db");
const {
  ensureRespondentSecuritySchema,
  toDecryptedRespondent,
  hashIdentifier,
} = require("../utils/dataSecurity");

function cleanDraftPayload(rawPayload) {
  if (!rawPayload) return {};
  let parsed = typeof rawPayload === "string" ? JSON.parse(rawPayload) : { ...rawPayload };

  // Retain non-identity assessment draft data
  const cleaned = {
    respondentId: Number(parsed.respondentId || 0) || undefined,
    savedAt: parsed.savedAt || new Date().toISOString(),
    answeredCount: Number(parsed.answeredCount || 0),
    totalQuestions: Number(parsed.totalQuestions || 0),
    totalScore: Number(parsed.totalScore || 0),
    totalWeightedScore: Number(parsed.totalWeightedScore || 0),
    answersByRow: parsed.answersByRow || {},
    questionResponses: Array.isArray(parsed.questionResponses) ? parsed.questionResponses : [],
  };

  // Remove undefined properties
  Object.keys(cleaned).forEach((k) => {
    if (cleaned[k] === undefined) delete cleaned[k];
  });

  return cleaned;
}

function cleanSubmissionPayload(rawPayload) {
  if (!rawPayload) return {};
  let parsed = typeof rawPayload === "string" ? JSON.parse(rawPayload) : { ...rawPayload };

  // Retain non-identity assessment submission data
  const cleaned = {
    respondentId: Number(parsed.respondentId || 0) || undefined,
    submittedAt: parsed.submittedAt || new Date().toISOString(),
    totalScore: Number(parsed.totalScore || 0),
    totalWeightedScore: Number(parsed.totalWeightedScore || 0),
    answersByRow: parsed.answersByRow || {},
    questionResponses: Array.isArray(parsed.questionResponses) ? parsed.questionResponses : [],
    bookingDetails: parsed.bookingDetails || null,
    isCancelled: parsed.isCancelled || undefined,
  };

  // If bookingDetails has redundant identity copies, we clean them
  if (cleaned.bookingDetails && typeof cleaned.bookingDetails === "object") {
    const b = { ...cleaned.bookingDetails };
    // Keep booking timing and calendar links
    cleaned.bookingDetails = b;
  }

  // Remove undefined properties
  Object.keys(cleaned).forEach((k) => {
    if (cleaned[k] === undefined) delete cleaned[k];
  });

  return cleaned;
}

async function runMigration() {
  console.log("=== STARTING RESPONDENT NORMALIZATION MIGRATION ===");

  await ensureRespondentSecuritySchema(db);

  // 1. Audit and Map Assessment Drafts
  console.log("\n1. Auditing & Normalizing assessment_drafts...");
  const [draftColumns] = await db.execute("SHOW COLUMNS FROM assessment_drafts");
  const draftColumnNames = draftColumns.map((c) => c.Field);
  console.log("Current assessment_drafts columns:", draftColumnNames);

  const [drafts] = await db.execute("SELECT * FROM assessment_drafts");
  console.log(`Found ${drafts.length} assessment_drafts records.`);

  for (const draft of drafts) {
    let respId = Number(draft.respondent_id);
    let cleanedPayload = cleanDraftPayload(draft.draft_payload);

    // Validate if respondent_id exists in respondent table
    let [respRows] = await db.execute("SELECT id FROM respondent WHERE id = ?", [respId]);
    if (respRows.length === 0) {
      console.warn(`[DRAFT ${draft.id}] respondent_id ${respId} not found in respondent table.`);
    }

    await db.execute(
      "UPDATE assessment_drafts SET draft_payload = ? WHERE id = ?",
      [JSON.stringify(cleanedPayload), draft.id]
    );
  }

  // 2. Audit and Map Assessment Submissions
  console.log("\n2. Auditing & Normalizing assessment_submissions...");
  const [subColumns] = await db.execute("SHOW COLUMNS FROM assessment_submissions");
  const subColumnNames = subColumns.map((c) => c.Field);
  console.log("Current assessment_submissions columns:", subColumnNames);

  const [submissions] = await db.execute("SELECT * FROM assessment_submissions");
  console.log(`Found ${submissions.length} assessment_submissions records.`);

  for (const sub of submissions) {
    let respId = Number(sub.respondent_id);
    const emailVal = sub.email ? String(sub.email).trim().toLowerCase() : null;

    // Check if respondent_id exists
    let [respRows] = respId > 0 ? await db.execute("SELECT id FROM respondent WHERE id = ?", [respId]) : [[]];

    if (respRows.length === 0 && emailVal) {
      // Try resolving by email hash
      const emailHash = hashIdentifier(emailVal);
      const [hashRows] = await db.execute("SELECT id FROM respondent WHERE email_hash = ? LIMIT 1", [emailHash]);
      if (hashRows.length > 0) {
        respId = hashRows[0].id;
        console.log(`[SUBMISSION ${sub.id}] Reconciled missing/invalid respondent_id to ${respId} via email hash.`);
        await db.execute("UPDATE assessment_submissions SET respondent_id = ? WHERE id = ?", [respId, sub.id]);
      } else {
        console.warn(`[SUBMISSION ${sub.id}] No matching respondent found for email: ${emailVal}`);
      }
    }

    let cleanedPayload = cleanSubmissionPayload(sub.submission_payload);
    cleanedPayload.respondentId = respId || undefined;

    await db.execute(
      "UPDATE assessment_submissions SET submission_payload = ? WHERE id = ?",
      [JSON.stringify(cleanedPayload), sub.id]
    );
  }

  // 3. Drop Redundant Columns in assessment_drafts
  console.log("\n3. Dropping redundant columns from assessment_drafts...");
  if (draftColumnNames.includes("respondent_name")) {
    await db.execute("ALTER TABLE assessment_drafts DROP COLUMN respondent_name");
    console.log("✓ Dropped assessment_drafts.respondent_name");
  }

  // 4. Drop Redundant Columns in assessment_submissions
  console.log("\n4. Dropping redundant columns from assessment_submissions...");
  if (subColumnNames.includes("respondent_name")) {
    await db.execute("ALTER TABLE assessment_submissions DROP COLUMN respondent_name");
    console.log("✓ Dropped assessment_submissions.respondent_name");
  }
  if (subColumnNames.includes("email")) {
    await db.execute("ALTER TABLE assessment_submissions DROP COLUMN email");
    console.log("✓ Dropped assessment_submissions.email");
  }
  if (subColumnNames.includes("mobile")) {
    await db.execute("ALTER TABLE assessment_submissions DROP COLUMN mobile");
    console.log("✓ Dropped assessment_submissions.mobile");
  }

  // Enforce respondent_id NOT NULL if clean
  try {
    await db.execute("ALTER TABLE assessment_submissions MODIFY respondent_id BIGINT UNSIGNED NOT NULL");
    console.log("✓ Enforced assessment_submissions.respondent_id NOT NULL");
  } catch (err) {
    console.warn("Notice when modifying respondent_id NOT NULL:", err.message);
  }

  // 5. Audit and Drop Redundant Columns in file_upload_history
  console.log("\n5. Checking file_upload_history...");
  const [uploadHistTables] = await db.execute("SHOW TABLES LIKE 'file_upload_history'");
  if (uploadHistTables.length > 0) {
    const [uploadColumns] = await db.execute("SHOW COLUMNS FROM file_upload_history");
    const uploadColumnNames = uploadColumns.map((c) => c.Field);
    if (uploadColumnNames.includes("uploaded_by_name")) {
      await db.execute("ALTER TABLE file_upload_history DROP COLUMN uploaded_by_name");
      console.log("✓ Dropped file_upload_history.uploaded_by_name");
    }
  }

  // 6. Final Validation Queries
  console.log("\n6. Running Final Validation Queries...");
  const [orphanDrafts] = await db.execute(`
    SELECT COUNT(*) AS count
    FROM assessment_drafts d
    LEFT JOIN respondent r ON r.id = d.respondent_id
    WHERE r.id IS NULL
  `);
  console.log("Orphan drafts count (expected 0):", orphanDrafts[0].count);

  const [orphanSubmissions] = await db.execute(`
    SELECT COUNT(*) AS count
    FROM assessment_submissions s
    LEFT JOIN respondent r ON r.id = s.respondent_id
    WHERE r.id IS NULL
  `);
  console.log("Orphan submissions count (expected 0):", orphanSubmissions[0].count);

  console.log("\n=== MIGRATION COMPLETED SUCCESSFULLY ===");
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

module.exports = { runMigration };
