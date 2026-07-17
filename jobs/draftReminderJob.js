const db = require("../config/db");
const { sendDraftReminderEmail } = require("../utils/mailer");

const ASSESSMENT_TYPE = "leadership_reset";
let draftReminderRunInProgress = false;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function ensureDraftReminderColumns() {
  const [sentAtColumns] = await db.execute("SHOW COLUMNS FROM assessment_drafts LIKE 'reminder_sent_at'");
  if (sentAtColumns.length === 0) {
    await db.execute("ALTER TABLE assessment_drafts ADD COLUMN reminder_sent_at DATETIME NULL");
  }

  const [attemptColumns] = await db.execute("SHOW COLUMNS FROM assessment_drafts LIKE 'reminder_attempts'");
  if (attemptColumns.length === 0) {
    await db.execute("ALTER TABLE assessment_drafts ADD COLUMN reminder_attempts INT NOT NULL DEFAULT 0");
  }

  const [errorColumns] = await db.execute("SHOW COLUMNS FROM assessment_drafts LIKE 'reminder_last_error'");
  if (errorColumns.length === 0) {
    await db.execute("ALTER TABLE assessment_drafts ADD COLUMN reminder_last_error VARCHAR(500) NULL");
  }
}

async function fetchPendingDraftReminders(afterHours, batchSize, maxAttempts) {
  const safeAfterHours = toPositiveInt(afterHours, 8);
  const safeBatchSize = toPositiveInt(batchSize, 100);
  const safeMaxAttempts = toPositiveInt(maxAttempts, 1);

  const [rows] = await db.execute(
    `SELECT
      d.id,
      d.respondent_id,
      d.respondent_name,
      d.answered_count,
      d.updated_at,
      d.draft_payload,
      r.email,
      r.firstname,
      r.lastname
     FROM assessment_drafts d
     INNER JOIN respondent r ON r.id = d.respondent_id
     LEFT JOIN assessment_submissions s
       ON s.assessment_type = d.assessment_type
      AND (
        (s.respondent_id IS NOT NULL AND s.respondent_id = d.respondent_id)
        OR (s.respondent_id IS NULL AND LOWER(TRIM(s.email)) = LOWER(TRIM(r.email)))
      )
     WHERE d.assessment_type = ?
       AND d.answered_count > 0
       AND s.id IS NULL
       AND r.email IS NOT NULL
       AND TRIM(r.email) <> ''
       AND d.updated_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)
       AND IFNULL(d.reminder_attempts, 0) < ?
       AND (d.reminder_sent_at IS NULL OR d.reminder_sent_at < d.updated_at)
     ORDER BY d.updated_at ASC
     LIMIT ${safeBatchSize}`,
    [ASSESSMENT_TYPE, safeAfterHours, safeMaxAttempts]
  );

  return rows;
}

function parseDraftPayload(rawPayload) {
  if (!rawPayload) return {};

  if (typeof rawPayload === "string") {
    try {
      return JSON.parse(rawPayload);
    } catch {
      return {};
    }
  }

  return rawPayload;
}

async function markReminderSuccess(draftId) {
  await db.execute(
    `UPDATE assessment_drafts
     SET reminder_sent_at = UTC_TIMESTAMP(),
         reminder_attempts = IFNULL(reminder_attempts, 0) + 1,
         reminder_last_error = NULL
     WHERE id = ?`,
    [draftId]
  );
}

async function markReminderFailure(draftId, errorMessage) {
  await db.execute(
    `UPDATE assessment_drafts
     SET reminder_attempts = IFNULL(reminder_attempts, 0) + 1,
         reminder_last_error = ?
     WHERE id = ?`,
    [String(errorMessage || "Unknown error").slice(0, 500), draftId]
  );
}

async function runDraftReminderCycle(options = {}) {
  if (draftReminderRunInProgress) {
    return {
      success: false,
      skipped: true,
      reason: "A reminder cycle is already running.",
      processed: 0,
      sent: 0,
      failed: 0,
    };
  }

  const { force = false } = options;
  const enabled = String(process.env.DRAFT_REMINDER_ENABLED || "true").trim().toLowerCase();
  if (!force && (enabled === "false" || enabled === "0" || enabled === "no")) {
    return {
      success: false,
      skipped: true,
      reason: "Draft reminder job is disabled by configuration.",
      processed: 0,
      sent: 0,
      failed: 0,
    };
  }

  const afterHours = toPositiveInt(process.env.DRAFT_REMINDER_AFTER_HOURS, 8);
  const batchSize = toPositiveInt(process.env.DRAFT_REMINDER_BATCH_SIZE, 100);
  const maxAttempts = toPositiveInt(process.env.DRAFT_REMINDER_MAX_ATTEMPTS, 1);
  let currentStep = "initialization";

  draftReminderRunInProgress = true;

  try {
    currentStep = "ensure columns";
    await ensureDraftReminderColumns();

    currentStep = "fetch pending reminders";
    const pendingRows = await fetchPendingDraftReminders(afterHours, batchSize, maxAttempts);

    if (!pendingRows.length) {
      return {
        success: true,
        skipped: false,
        reason: "No pending draft reminders.",
        processed: 0,
        sent: 0,
        failed: 0,
      };
    }

    let sentCount = 0;
    let failedCount = 0;

    for (const row of pendingRows) {
      currentStep = `send reminder for draft id ${row.id}`;
      const payload = parseDraftPayload(row.draft_payload);
      const totalQuestions = Number(payload?.totalQuestions || 12);

      const sent = await sendDraftReminderEmail(String(row.email || "").trim(), {
        firstName: row.firstname,
        respondentName: row.respondent_name || `${row.firstname || ""} ${row.lastname || ""}`.trim(),
        answeredCount: Number(row.answered_count || 0),
        totalQuestions,
        lastSavedAt: row.updated_at,
      });

      if (sent) {
        currentStep = `mark reminder success for draft id ${row.id}`;
        await markReminderSuccess(row.id);
        sentCount += 1;
      } else {
        currentStep = `mark reminder failure for draft id ${row.id}`;
        await markReminderFailure(row.id, "Failed to send reminder email.");
        failedCount += 1;
      }
    }

    console.log(`Draft reminder cycle completed. Processed ${pendingRows.length} draft(s).`);
    return {
      success: true,
      skipped: false,
      reason: null,
      processed: pendingRows.length,
      sent: sentCount,
      failed: failedCount,
    };
  } catch (error) {
    console.error(`Draft reminder cycle failed at step: ${currentStep}`, error);
    return {
      success: false,
      skipped: false,
      reason: `Failed at ${currentStep}: ${error.message || "Draft reminder cycle failed."}`,
      processed: 0,
      sent: 0,
      failed: 0,
    };
  } finally {
    draftReminderRunInProgress = false;
  }
}

function startDraftReminderJob() {
  const enabled = String(process.env.DRAFT_REMINDER_ENABLED || "true").trim().toLowerCase();
  if (enabled === "false" || enabled === "0" || enabled === "no") {
    console.log("Draft reminder job disabled.");
    return;
  }

  const intervalMinutes = 60;
  const intervalMs = intervalMinutes * 60 * 1000;

  // Run once on startup and then on an interval.
  runDraftReminderCycle();
  setInterval(runDraftReminderCycle, intervalMs);

  console.log(`Draft reminder job started. Interval: ${intervalMinutes} minute(s).`);
}

module.exports = {
  startDraftReminderJob,
  runDraftReminderCycle,
};
