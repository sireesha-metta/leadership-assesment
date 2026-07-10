const DEFAULT_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbytHuWxCiTwSTM-1gbpt2UgWzGXWDhZD-QqllAyC6Tcy_xxrdD--Kk2QBjYGcXbubfY/exec";
const UPSTREAM_TIMEOUT_MS = Number(process.env.GOOGLE_SCRIPT_TIMEOUT_MS || 30000);
const UPSTREAM_RETRY_COUNT = Number(process.env.GOOGLE_SCRIPT_RETRY_COUNT || 1);
const db = require("../config/db");
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
    respondent: String(input.respondent || "Anonymous"),
    submittedAt: input.submittedAt || new Date().toISOString(),
    mode: "template-update",
    totalScore: Number(input.totalScore || 0),
    totalWeightedScore: Number(input.totalWeightedScore || 0),
    answersByRow: { ...(input.answersByRow || {}) },
    answersByQuestion: {},
    questionResponses: Array.isArray(input.questionResponses)
      ? input.questionResponses
      : [],
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
    respondent: String(input.respondent || "Anonymous"),
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
  return {
    respondent: String(input.respondent || "Anonymous").trim() || "Anonymous",
    mobile: String(input.mobile || "").trim(),
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
      respondent_id BIGINT UNSIGNED NOT NULL,
      assessment_type VARCHAR(80) NOT NULL,
      respondent_name VARCHAR(255) NULL,
      mobile VARCHAR(32) NULL,
      submitted_at DATETIME NULL,
      total_score DECIMAL(12, 2) NOT NULL DEFAULT 0,
      total_weighted_score DECIMAL(12, 2) NOT NULL DEFAULT 0,
      submission_payload LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_submission_once (respondent_id, assessment_type)
    )`
  );
}

async function getSubmissionRecordByRespondentId(respondentId) {
  await ensureSubmissionsTable();

  const [rows] = await db.execute(
    `SELECT respondent_name, mobile, submitted_at, total_score, total_weighted_score, submission_payload
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
    mobile: String(parsedPayload?.mobile || row.mobile || "").trim(),
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
      (respondent_id, assessment_type, respondent_name, mobile, submitted_at, total_score, total_weighted_score, submission_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      respondentId,
      ASSESSMENT_TYPE,
      payload.respondent,
      payload.mobile,
      payload.submittedAt,
      payload.totalScore,
      payload.totalWeightedScore,
      JSON.stringify(payload),
    ]
  );
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
    const existingSubmission = await getSubmissionRecordByRespondentId(req.user.id);

    if (existingSubmission) {
      return res.status(409).json({
        success: false,
        alreadySubmitted: true,
        message: "Assessment already submitted. You can only submit once.",
        data: existingSubmission,
      });
    }

    const scriptUrl = process.env.GOOGLE_SCRIPT_URL || DEFAULT_SCRIPT_URL;
    const normalizedPayload = normalizeSubmissionPayload(req.body || {});
    const outgoingPayload = buildScriptPayload(normalizedPayload);

    const upstream = await fetchWithTimeoutAndRetry(scriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(outgoingPayload),
    });

    const rawText = await upstream.text();
    const parsed = parseTextResult(rawText);

    const normalizedText = String(parsed.text || "").trim().toLowerCase();
    const acceptedByUpstream =
      parsed?.json?.success === true ||
      normalizedText === "success" ||
      normalizedText.includes("saved") ||
      normalizedText.includes("updated") ||
      normalizedText.includes("success");

    if (acceptedByUpstream) {
      await saveSubmissionRecord(req.user.id, normalizedPayload);
    }

    // Return text so existing frontend text-based success check keeps working.
    if (parsed.text) {
      return res.status(200).send(parsed.text);
    }

    return res.status(200).json(parsed.json);
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
    const scriptUrl = process.env.GOOGLE_SCRIPT_URL || DEFAULT_SCRIPT_URL;
    const upstream = await fetchWithTimeoutAndRetry(`${scriptUrl}?action=getSubmissions`, {
      method: "GET",
    });
    const payload = await upstream.text();

    try {
      const parsed = JSON.parse(payload);

      if (Array.isArray(parsed?.submissions)) {
        parsed.submissions = parsed.submissions.map((entry) => ({
          ...entry,
          timestamp: entry.timestamp || entry.submittedAt || null,
          questions: entry.questions || entry.questionResponses || [],
        }));
      }

      return res.status(200).json(parsed);
    } catch {
      return res.status(200).send(payload);
    }
  } catch (error) {
    console.error(error);
    return res.status(502).json({
      success: false,
      message: "Failed to fetch submissions from Google Sheet endpoint",
      details: error.message,
    });
  }
};
