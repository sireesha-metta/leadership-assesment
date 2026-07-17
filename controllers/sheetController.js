const DEFAULT_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbytHuWxCiTwSTM-1gbpt2UgWzGXWDhZD-QqllAyC6Tcy_xxrdD--Kk2QBjYGcXbubfY/exec";
const UPSTREAM_TIMEOUT_MS = Number(process.env.GOOGLE_SCRIPT_TIMEOUT_MS || 30000);
const UPSTREAM_RETRY_COUNT = Number(process.env.GOOGLE_SCRIPT_RETRY_COUNT || 1);
const db = require("../config/db");
const { sendAssessmentResultEmail } = require("../utils/mailer");
const ASSESSMENT_TYPE = "leadership_reset";

const ROW_TO_QKEY = {
  6: "q1",
  7: "q2",
  8: "q3",
  9: "q4",
  12: "q5",
  13: "q6",
  14: "q7",
  15: "q8",
  18: "q9",
  19: "q10",
  20: "q11",
  21: "q12",
};

const QUESTION_ROWS = [6, 7, 8, 9, 12, 13, 14, 15, 18, 19, 20, 21];

function buildScriptPayload(input) {
  const payload = {
    respondent: String(input.respondent),
    firstName: String(input.firstName || "").trim(),
    lastName: String(input.lastName || "").trim(),
    email: String(input.email || "").trim(),
    respondentId: Number(input.respondentId || 0),
    submittedAt: input.submittedAt || new Date().toISOString(),
    mode: "template-update",
    totalScore: Number(input.totalScore || 0),
    totalWeightedScore: Number(input.totalWeightedScore || 0),
    answersByRow: { ...(input.answersByRow || {}) },
    answersByQuestion: {},
    questionResponses: Array.isArray(input.questionResponses) ? input.questionResponses : [],
  };

  QUESTION_ROWS.forEach((rowIdx) => {
    const qKey = ROW_TO_QKEY[rowIdx];
    const rowValue = payload.answersByRow[rowIdx] || payload.answersByRow[String(rowIdx)] || "";
    payload[qKey] = rowValue;
    payload.answersByRow[rowIdx] = rowValue;
  });

  payload.questionResponses.forEach((item) => {
    if (item && item.question) {
      payload.answersByQuestion[item.question] = item.answer || "";
    }
  });

  return payload;
}

async function fetchWithTimeoutAndRetry(url, options = {}) {
  let lastError;

  for (let attempt = 0; attempt <= UPSTREAM_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === UPSTREAM_RETRY_COUNT) break;
    }
  }

  throw lastError;
}

function parseTextResult(rawText) {
  const text = String(rawText || "").trim();

  try {
    return {
      json: JSON.parse(text),
      text,
    };
  } catch {
    const normalized = text.toLowerCase();
    return {
      json: {
        success:
          normalized === "success" ||
          normalized.includes("saved") ||
          normalized.includes("updated"),
        message: text,
      },
      text,
    };
  }
}

function normalizeDraftPayload(input) {
  return {
    respondent: String(input.respondent),
    savedAt: input.savedAt || new Date().toISOString(),
    answersByRow: { ...(input.answersByRow || {}) },
    answeredCount: Number(input.answeredCount || 0),
    totalQuestions: Number(input.totalQuestions || 0),
    totalScore: Number(input.totalScore || 0),
    totalWeightedScore: Number(input.totalWeightedScore || 0),
    questionResponses: Array.isArray(input.questionResponses) ? input.questionResponses : [],
  };
}

function normalizePublicDraftPayload(input) {
  return {
    respondentId: Number(input.respondentId || 0),
    respondent: String(input.respondent),
    savedAt: input.savedAt || new Date().toISOString(),
    answersByRow: { ...(input.answersByRow || {}) },
    answeredCount: Number(input.answeredCount || 0),
    totalQuestions: Number(input.totalQuestions || 0),
    totalScore: Number(input.totalScore || 0),
    totalWeightedScore: Number(input.totalWeightedScore || 0),
    questionResponses: Array.isArray(input.questionResponses) ? input.questionResponses : [],
  };
}

function normalizeSubmissionPayload(input) {
  const firstName = String(input.firstName || "").trim();
  const lastName = String(input.lastName || "").trim();
  const respondentName = String(input.respondent || `${firstName} ${lastName}`.trim()).trim();

  return {
    respondent: respondentName,
    firstName,
    lastName,
    email: String(input.email || "").trim(),
    respondentId: Number(input.respondentId || 0),
    submittedAt: input.submittedAt || new Date().toISOString(),
    totalScore: Number(input.totalScore || 0),
    totalWeightedScore: Number(input.totalWeightedScore || 0),
    answersByRow: { ...(input.answersByRow || {}) },
    questionResponses: Array.isArray(input.questionResponses) ? input.questionResponses : [],
  };
}

async function ensureSubmissionsTable() {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS assessment_submissions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      respondent_id BIGINT UNSIGNED NULL,
      assessment_type VARCHAR(80) NOT NULL,
      respondent_name VARCHAR(255) NULL,
      email VARCHAR(255) NULL,
      submitted_at DATETIME NULL,
      total_score DECIMAL(12, 2) NOT NULL DEFAULT 0,
      total_weighted_score DECIMAL(12, 2) NOT NULL DEFAULT 0,
      submission_payload LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_submission_respondent_type (respondent_id, assessment_type),
      KEY idx_submission_email (email),
      KEY idx_submission_created_at (created_at)
    )`
  );

  const [emailColumns] = await db.execute(`SHOW COLUMNS FROM assessment_submissions LIKE 'email'`);
  if (emailColumns.length === 0) {
    await db.execute(`ALTER TABLE assessment_submissions ADD COLUMN email VARCHAR(255) NULL`);
  }

  const [mobileColumns] = await db.execute(`SHOW COLUMNS FROM assessment_submissions LIKE 'mobile'`);
  if (mobileColumns.length > 0) {
    await db.execute(`ALTER TABLE assessment_submissions DROP COLUMN mobile`);
  }

  const [respondentIdColumns] = await db.execute(`SHOW COLUMNS FROM assessment_submissions LIKE 'respondent_id'`);
  if (respondentIdColumns.length > 0 && respondentIdColumns[0].Null === 'NO') {
    await db.execute(`ALTER TABLE assessment_submissions MODIFY respondent_id BIGINT UNSIGNED NULL`);
  }
}

async function getSubmissionRecordByRespondentId(respondentId) {
  await ensureSubmissionsTable();

  const [rows] = await db.execute(
    `SELECT respondent_name, submitted_at, total_score, total_weighted_score, submission_payload
     FROM assessment_submissions
     WHERE respondent_id = ? AND assessment_type = ?
     LIMIT 1`,
    [respondentId, ASSESSMENT_TYPE]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  let parsedPayload = null;

  try {
    parsedPayload = typeof row.submission_payload === "string"
      ? JSON.parse(row.submission_payload)
      : row.submission_payload;
  } catch {
    parsedPayload = null;
  }

  return {
    respondent: String(parsedPayload?.respondent || row.respondent_name || "").trim(),
    submittedAt: parsedPayload?.submittedAt || row.submitted_at || null,
    totalScore: Number(parsedPayload?.totalScore ?? row.total_score ?? 0),
    totalWeightedScore: Number(parsedPayload?.totalWeightedScore ?? row.total_weighted_score ?? 0),
    questionResponses: Array.isArray(parsedPayload?.questionResponses) ? parsedPayload.questionResponses : [],
    answersByRow: parsedPayload?.answersByRow || {},
  };
}

async function saveSubmissionRecord(respondentId, payload) {
  await ensureSubmissionsTable();

  await db.execute(
    `INSERT INTO assessment_submissions
      (respondent_id, assessment_type, respondent_name, email, submitted_at, total_score, total_weighted_score, submission_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(respondentId) > 0 ? respondentId : null,
      ASSESSMENT_TYPE,
      payload.respondent,
      payload.email,
      payload.submittedAt,
      payload.totalScore,
      payload.totalWeightedScore,
      JSON.stringify(payload),
    ]
  );
}

async function findExistingAssessmentSubmission({ respondentId, email }) {
  const normalizedRespondentId = Number(respondentId);

  await ensureSubmissionsTable();

  if (Number.isFinite(normalizedRespondentId) && normalizedRespondentId > 0) {
    const [rows] = await db.execute(
      `SELECT id, respondent_id, respondent_name, email, submitted_at, total_score, total_weighted_score, submission_payload, created_at
       FROM assessment_submissions
       WHERE respondent_id = ? AND assessment_type = ?
       LIMIT 1`,
      [normalizedRespondentId, ASSESSMENT_TYPE]
    );

    if (rows.length > 0) {
      return rows[0];
    }
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    return null;
  }

  const [rows] = await db.execute(
    `SELECT id, respondent_id, respondent_name, email, submitted_at, total_score, total_weighted_score, submission_payload, created_at
     FROM assessment_submissions
     WHERE assessment_type = ? AND LOWER(TRIM(email)) = ?
     LIMIT 1`,
    [ASSESSMENT_TYPE, normalizedEmail]
  );

  return rows.length > 0 ? rows[0] : null;
}


function normalizeSubmissionRow(row) {
  const payload = typeof row.submission_payload === "string"
    ? JSON.parse(row.submission_payload || "{}")
    : row.submission_payload || {};

  const submittedAt = payload.submittedAt || row.submitted_at || null;
  const timestamp = submittedAt || row.created_at || null;

  return {
    id: Number(row.id),
    source: Number(row.respondent_id) > 0 ? "internal" : "public",
    respondent: String(payload.respondent || row.respondent_name).trim(),
    email: String(row.email || payload.email || "").trim() || null,
    submittedAt,
    timestamp,
    totalScore: Number(payload.totalScore ?? row.total_score ?? 0),
    totalWeightedScore: Number(payload.totalWeightedScore ?? row.total_weighted_score ?? 0),
    questionResponses: Array.isArray(payload.questionResponses) ? payload.questionResponses : [],
    questions: Array.isArray(payload.questionResponses) ? payload.questionResponses : [],
    answersByRow: payload.answersByRow || {},
    createdAt: row.created_at,
  };
}

async function fetchSubmissionsFromDatabase() {
  await ensureSubmissionsTable();

  const [rows] = await db.execute(
    `SELECT id, respondent_id, respondent_name, email, submitted_at, total_score, total_weighted_score, submission_payload, created_at
     FROM assessment_submissions
     ORDER BY submitted_at DESC, id DESC`
  );

  return rows.map(normalizeSubmissionRow);
}

async function deleteSubmissionById(id) {
  await ensureSubmissionsTable();

  const [result] = await db.execute(
    `DELETE FROM assessment_submissions WHERE id = ?`,
    [id]
  );

  return { deleted: Number(result?.affectedRows || 0) > 0 };
}

exports.saveDraft = async (req, res) => {
  try {
    const payload = normalizeDraftPayload(req.body || {});

    if (!payload.respondent.trim()) {
      return res.status(400).json({ success: false, message: "Respondent name is required." });
    }

    if (Object.keys(payload.answersByRow).length === 0) {
      return res.status(400).json({ success: false, message: "At least one answer is required to save a draft." });
    }

    await db.execute(
      `INSERT INTO assessment_drafts
        (respondent_id, assessment_type, respondent_name, answered_count, draft_payload)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        respondent_name = VALUES(respondent_name),
        answered_count = VALUES(answered_count),
        draft_payload = VALUES(draft_payload),
        updated_at = CURRENT_TIMESTAMP`,
      [
        req.user.id,
        "leadership_reset",
        payload.respondent,
        payload.answeredCount,
        JSON.stringify(payload),
      ]
    );

    return res.json({
      success: true,
      message: `Draft saved. You answered ${payload.answeredCount} questions.`,
      data: payload,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to save draft",
      details: error.message,
    });
  }
};

exports.savePublicDraft = async (req, res) => {
  try {
    const payload = normalizePublicDraftPayload(req.body || {});

    if (!Number.isFinite(payload.respondentId) || payload.respondentId <= 0) {
      return res.status(400).json({ success: false, message: "Valid respondentId is required." });
    }

    await db.execute(
      `INSERT INTO assessment_drafts
        (respondent_id, assessment_type, respondent_name, answered_count, draft_payload)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        respondent_name = VALUES(respondent_name),
        answered_count = VALUES(answered_count),
        draft_payload = VALUES(draft_payload),
        updated_at = CURRENT_TIMESTAMP`,
      [
        payload.respondentId,
        "leadership_reset",
        payload.respondent,
        payload.answeredCount,
        JSON.stringify(payload),
      ]
    );

    return res.json({
      success: true,
      message: `Draft saved. You answered ${payload.answeredCount} questions.`,
      data: payload,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to save public draft",
      details: error.message,
    });
  }
};

exports.getDraft = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT respondent_name, answered_count, draft_payload, updated_at
       FROM assessment_drafts
       WHERE respondent_id = ? AND assessment_type = ?`,
      [req.user.id, "leadership_reset"]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "No draft found." });
    }

    const row = rows[0];
    const payload = typeof row.draft_payload === "string"
      ? JSON.parse(row.draft_payload)
      : row.draft_payload;

    return res.json({
      success: true,
      data: {
        ...payload,
        respondent: payload.respondent || row.respondent_name,
        answeredCount: Number(payload.answeredCount || row.answered_count || 0),
        savedAt: payload.savedAt || row.updated_at,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to load draft",
      details: error.message,
    });
  }
};

exports.getPublicDraft = async (req, res) => {
  try {
    const respondentId = Number(req.params.respondentId || 0);

    if (!Number.isFinite(respondentId) || respondentId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid respondentId is required.' });
    }

    const [rows] = await db.execute(
      `SELECT respondent_name, answered_count, draft_payload, updated_at
       FROM assessment_drafts
       WHERE respondent_id = ? AND assessment_type = ?`,
      [respondentId, "leadership_reset"]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No draft found.' });
    }

    const row = rows[0];
    const payload = typeof row.draft_payload === 'string' ? JSON.parse(row.draft_payload) : row.draft_payload;

    return res.json({
      success: true,
      data: {
        ...payload,
        respondent: payload.respondent || row.respondent_name,
        answeredCount: Number(payload.answeredCount || row.answered_count || 0),
        savedAt: payload.savedAt || row.updated_at,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Failed to load public draft', details: error.message });
  }
};

exports.deletePublicDraft = async (req, res) => {
  try {
    const { respondentId } = req.params;

    const [result] = await db.execute(
      `DELETE FROM assessment_drafts
       WHERE respondent_id = ? AND assessment_type = ?`,
      [respondentId, "leadership_reset"]
    );

    return res.json({
      success: true,
      message: result.affectedRows > 0 ? "Draft cleared." : "No draft found to clear.",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to clear draft",
      details: error.message,
    });
  }
};

exports.deleteDraft = async (req, res) => {
  try {
    const [result] = await db.execute(
      `DELETE FROM assessment_drafts
       WHERE respondent_id = ? AND assessment_type = ?`,
      [req.user.id, "leadership_reset"]
    );

    return res.json({
      success: true,
      message: result.affectedRows > 0 ? "Draft cleared." : "No draft found to clear.",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to clear draft",
      details: error.message,
    });
  }
};

exports.submitAssessment = async (req, res) => {
  try {
    const normalizedPayload = normalizeSubmissionPayload(req.body || {});
    const existingSubmission = await findExistingAssessmentSubmission({
      respondentId: req.user?.id,
      email: normalizedPayload.email,
    });

    if (existingSubmission) {
      return res.status(409).json({
        success: false,
        alreadySubmitted: true,
        message: "Assessment already submitted. You can only submit once.",
        data: existingSubmission,
      });
    }

    const scriptUrl = process.env.GOOGLE_SCRIPT_URL || DEFAULT_SCRIPT_URL;
    const outgoingPayload = buildScriptPayload(normalizedPayload);

    let acceptedByUpstream = false;
    let parsed = null;
    let rawText = null;

    try {
      const upstream = await fetchWithTimeoutAndRetry(scriptUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(outgoingPayload),
      });

      rawText = await upstream.text();
      parsed = parseTextResult(rawText);

      const normalizedText = String(parsed.text || "").trim().toLowerCase();
      acceptedByUpstream =
        parsed?.json?.success === true ||
        normalizedText === "success" ||
        normalizedText.includes("saved") ||
        normalizedText.includes("updated") ||
        normalizedText.includes("success");
    } catch (upstreamError) {
      console.error('Failed to submit to Google Script upstream:', upstreamError.message || upstreamError);
      rawText = upstreamError.message || String(upstreamError);
      parsed = { json: { success: false, message: rawText }, text: rawText };
    }

    let dbSaved = false;
    try {
      await saveSubmissionRecord(normalizedPayload.respondentId, normalizedPayload);
      dbSaved = true;
    } catch (dbError) {
      console.error('Failed to save assessment submission to database:', dbError.message || dbError);
      return res.status(500).json({
        success: false,
        dbSaved: false,
        sheetSuccess: acceptedByUpstream,
        message: 'Failed to save assessment submission to the database.',
        details: dbError.message,
      });
    }

    let mailSent = false;

    try {
      const recipient = normalizedPayload.email;
      if (recipient) {
        mailSent = await sendAssessmentResultEmail(recipient, {
          firstName: normalizedPayload.firstName,
          lastName: normalizedPayload.lastName,
          totalScore: normalizedPayload.totalScore,
          totalWeightedScore: normalizedPayload.totalWeightedScore,
          submittedAt: normalizedPayload.submittedAt,
          questionResponses: normalizedPayload.questionResponses,
        });
      }
    } catch (e) {
      mailSent = false;
      console.error("Failed to send assessment email:", e?.message);
    }

    // remove any draft for this respondent when auth is present
    if (req.user && Number.isFinite(req.user.id) && req.user.id > 0) {
      try {
        await db.execute(
          `DELETE FROM assessment_drafts WHERE respondent_id = ? AND assessment_type = ?`,
          [req.user.id, ASSESSMENT_TYPE]
        );
      } catch (e) {
        console.error('Failed to remove draft after submission:', e.message);
      }
    }

    // Return text so existing frontend text-based success check keeps working.
    // if (parsed && parsed.text) {
    //   return res.status(200).send(parsed.text);
    // }

    const responsePayload = {
      success: acceptedByUpstream,
      dbSaved: true,
      sheetSuccess: acceptedByUpstream,
      mailSent,
      message: acceptedByUpstream
        ? (parsed?.json?.message || rawText || "Assessment submitted successfully.")
        : (parsed?.json?.message || rawText || "Saved to DB but failed to submit to Google Sheet."),
    };
    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error(error);
    return res.status(502).json({
      success: false,
      message: "Failed to submit data to Google Sheet endpoint",
      details: error.message,
    });
  }
};

exports.getSubmissionStatus = async (req, res) => {
  try {
    if (!req.user || !Number.isFinite(req.user.id) || req.user.id <= 0) {
      return res.status(400).json({ success: false, message: 'Authenticated user required to check submission status.' });
    }

    const submission = await getSubmissionRecordByRespondentId(req.user.id);

    if (!submission) {
      return res.json({ success: true, submitted: false });
    }

    return res.json({
      success: true,
      submitted: true,
      data: submission,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch submission status",
      details: error.message,
    });
  }
};

exports.getSubmissions = async (_req, res) => {
  try {
    const submissions = await fetchSubmissionsFromDatabase();

    return res.status(200).json({
      success: true,
      submissions,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to load submissions from the database.",
      details: error.message,
    });
  }
};

exports.deleteSubmission = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: "Invalid submission id." });
    }

    const result = await deleteSubmissionById(id);
    if (!result.deleted) {
      return res.status(404).json({ success: false, message: "Submission not found." });
    }

    return res.json({
      success: true,
      message: "Submission deleted.",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete submission.",
      details: error.message,
    });
  }
};

