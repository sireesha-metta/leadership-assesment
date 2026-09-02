const DEFAULT_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbytHuWxCiTwSTM-1gbpt2UgWzGXWDhZD-QqllAyC6Tcy_xxrdD--Kk2QBjYGcXbubfY/exec";
const UPSTREAM_TIMEOUT_MS = Number(process.env.GOOGLE_SCRIPT_TIMEOUT_MS || 30000);
const UPSTREAM_RETRY_COUNT = Number(process.env.GOOGLE_SCRIPT_RETRY_COUNT || 1);
const db = require("../config/db");
const { sendAssessmentResultEmail, sendAdminNotificationEmail } = require("../utils/mailer");
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
    bookingDetails: input.bookingDetails || null,
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

  const normalizedEmail = String(payload.email || "").trim().toLowerCase();
  const normalizedRespondentId = Number(respondentId) > 0 ? respondentId : null;

  let existingRow = null;
  if (normalizedRespondentId) {
    const [rows] = await db.execute(
      `SELECT id, total_score, total_weighted_score, submission_payload FROM assessment_submissions WHERE respondent_id = ? AND assessment_type = ? LIMIT 1`,
      [normalizedRespondentId, ASSESSMENT_TYPE]
    );
    if (rows.length > 0) existingRow = rows[0];
  }
  if (!existingRow && normalizedEmail) {
    const [rows] = await db.execute(
      `SELECT id, total_score, total_weighted_score, submission_payload FROM assessment_submissions WHERE assessment_type = ? AND LOWER(TRIM(email)) = ? LIMIT 1`,
      [ASSESSMENT_TYPE, normalizedEmail]
    );
    if (rows.length > 0) existingRow = rows[0];
  }

  if (existingRow) {
    let existingPayload = {};
    try {
      existingPayload = typeof existingRow.submission_payload === "string"
        ? JSON.parse(existingRow.submission_payload)
        : existingRow.submission_payload || {};
    } catch (e) {}

    const incomingValidCount = countNonEmptyAnswers(payload.answersByRow, payload.questionResponses);

    const mergedAnswersByRow = (incomingValidCount > 0)
      ? payload.answersByRow
      : (existingPayload.answersByRow || {});

    const mergedQuestionResponses = (incomingValidCount > 0)
      ? payload.questionResponses
      : (existingPayload.questionResponses || []);

    const mergedTotalScore = Number(payload.totalScore || 0) > 0
      ? payload.totalScore
      : Number(existingRow.total_score || existingPayload.totalScore || 0);

    const mergedWeightedScore = Number(payload.totalWeightedScore || 0) > 0
      ? payload.totalWeightedScore
      : Number(existingRow.total_weighted_score || existingPayload.totalWeightedScore || 0);

    const mergedPayload = {
      ...existingPayload,
      ...payload,
      totalScore: mergedTotalScore,
      totalWeightedScore: mergedWeightedScore,
      answersByRow: mergedAnswersByRow,
      questionResponses: mergedQuestionResponses,
    };

    await db.execute(
      `UPDATE assessment_submissions
       SET respondent_name = ?,
           email = ?,
           submitted_at = ?,
           total_score = ?,
           total_weighted_score = ?,
           submission_payload = ?
       WHERE id = ?`,
      [
        mergedPayload.respondent,
        mergedPayload.email,
        mergedPayload.submittedAt,
        mergedTotalScore,
        mergedWeightedScore,
        JSON.stringify(mergedPayload),
        existingRow.id,
      ]
    );
  } else {
    await db.execute(
      `INSERT INTO assessment_submissions
        (respondent_id, assessment_type, respondent_name, email, submitted_at, total_score, total_weighted_score, submission_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedRespondentId,
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


const DEFAULT_QUESTIONS_LIST = [
  { rowIndex: 6, number: 1, question: "When your team discusses a decision, who typically speaks first?", weight: 2 },
  { rowIndex: 7, number: 2, question: "Think of a recent decision where something important emerged after the fact. What do you think stopped it surfacing in the room?", weight: 2 },
  { rowIndex: 8, number: 3, question: "How would you describe the pace of decisions in your leadership meetings?", weight: 1 },
  { rowIndex: 9, number: 4, question: "Are there people in your team you know have strong views but rarely voice them in meetings?", weight: 2 },
  { rowIndex: 12, number: 5, question: "Who challenges in your leadership meetings?", weight: 2 },
  { rowIndex: 13, number: 6, question: "When someone does push back in a discussion, how does the room typically respond?", weight: 2 },
  { rowIndex: 14, number: 7, question: "Are there topics in your leadership discussions that feel quietly off-limits — where challenge just doesn't happen?", weight: 1 },
  { rowIndex: 15, number: 8, question: "After meetings, do you hear different views from people in the corridor to what was said in the room?", weight: 2 },
  { rowIndex: 18, number: 9, question: "When you signal your own view early in a discussion, what tends to happen?", weight: 3 },
  { rowIndex: 19, number: 10, question: "Do you feel you hear from the people with the most relevant knowledge, or those most comfortable speaking?", weight: 3 },
  { rowIndex: 20, number: 11, question: "When a discussion goes in circles, what is your instinct?", weight: 2 },
  { rowIndex: 21, number: 12, question: "If you could change one thing about how your team makes complex decisions, what would it be?", weight: 1 },
];

function extractAnswerFromRowMap(byRow, q, idx) {
  if (!byRow || typeof byRow !== "object") return "";

  const qNum = q.number || (idx + 1);
  const rIdx = q.rowIndex;

  const candidateKeys = [
    rIdx, String(rIdx),
    idx, String(idx),
    qNum, String(qNum),
    `q${qNum}`, `q${idx + 1}`, `Q${qNum}`,
    `row${rIdx}`, `row_${rIdx}`,
  ];

  for (const key of candidateKeys) {
    const val = byRow[key];
    if (val !== undefined && val !== null && String(val).trim() !== "" && String(val).trim() !== "-") {
      return String(val).trim();
    }
  }

  return "";
}

function buildCompleteQuestionResponses(existingQuestionResponses, answersByRow) {
  const byRow = answersByRow && typeof answersByRow === "object" ? answersByRow : {};
  const existingMap = new Map();

  if (Array.isArray(existingQuestionResponses)) {
    existingQuestionResponses.forEach((item, idx) => {
      if (item && (item.question || item.number || item.rowIndex)) {
        const key = item.rowIndex || item.number || (idx + 1);
        existingMap.set(String(key), item);
      }
    });
  }

  return DEFAULT_QUESTIONS_LIST.map((q, idx) => {
    const existingItem = existingMap.get(String(q.rowIndex)) || existingMap.get(String(q.number));
    const extractedAns = extractAnswerFromRowMap(byRow, q, idx);
    const finalAnswer = (existingItem && String(existingItem.answer || "").trim() && String(existingItem.answer).trim() !== "-")
      ? String(existingItem.answer).trim()
      : extractedAns;

    return {
      rowIndex: q.rowIndex,
      number: q.number,
      question: q.question,
      answer: finalAnswer || "—",
      score: existingItem?.score ?? null,
      weight: existingItem?.weight ?? q.weight,
      weightedScore: existingItem?.weightedScore ?? null,
    };
  });
}

function normalizeSubmissionRow(row) {
  const payload = typeof row.submission_payload === "string"
    ? JSON.parse(row.submission_payload || "{}")
    : row.submission_payload || {};

  const submittedAt = payload.submittedAt || row.submitted_at || null;
  const timestamp = submittedAt || row.created_at || null;
  const fullQuestions = buildCompleteQuestionResponses(payload.questionResponses, payload.answersByRow);

  return {
    id: Number(row.id),
    source: Number(row.respondent_id) > 0 ? "internal" : "public",
    respondent: String(payload.respondent || row.respondent_name).trim(),
    email: String(row.email || payload.email || "").trim() || null,
    submittedAt,
    timestamp,
    totalScore: Number(payload.totalScore ?? row.total_score ?? 0),
    totalWeightedScore: Number(payload.totalWeightedScore ?? row.total_weighted_score ?? 0),
    questionResponses: fullQuestions,
    questions: fullQuestions,
    answersByRow: payload.answersByRow || {},
    createdAt: row.created_at,
  };
}

function countNonEmptyAnswers(answersByRow, questionResponses) {
  let count = 0;
  if (Array.isArray(questionResponses)) {
    count += questionResponses.filter((q) => q && String(q.answer || "").trim() !== "" && String(q.answer).trim() !== "—" && String(q.answer).trim() !== "-").length;
  }
  if (count > 0) return count;

  if (answersByRow && typeof answersByRow === "object") {
    Object.values(answersByRow).forEach((v) => {
      if (v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim() !== "—" && String(v).trim() !== "-") {
        count += 1;
      }
    });
  }
  return count;
}

async function findBestScoresForEmail(email) {
  if (!email) return null;
  const normalizedEmail = String(email).trim().toLowerCase();

  const [rows] = await db.execute(
    `SELECT total_score, total_weighted_score, submission_payload
     FROM assessment_submissions
     WHERE LOWER(TRIM(email)) = ?
     ORDER BY id DESC`,
    [normalizedEmail]
  );

  for (const row of rows) {
    let payload = {};
    try {
      payload = typeof row.submission_payload === "string" ? JSON.parse(row.submission_payload) : row.submission_payload || {};
    } catch (e) {}

    const qResp = Array.isArray(payload.questionResponses) ? payload.questionResponses : [];
    const aByRow = payload.answersByRow || {};
    const validCount = countNonEmptyAnswers(aByRow, qResp);

    if (validCount > 0) {
      return {
        totalScore: Number(row.total_score || payload.totalScore || 0),
        totalWeightedScore: Number(row.total_weighted_score || payload.totalWeightedScore || 0),
        answersByRow: aByRow,
        questionResponses: qResp,
      };
    }
  }

  const [draftRows] = await db.execute(
    `SELECT draft_payload FROM assessment_drafts
     WHERE draft_payload LIKE ?
     ORDER BY id DESC LIMIT 1`,
    [`%${normalizedEmail}%`]
  );

  if (draftRows.length > 0) {
    let dp = {};
    try {
      dp = typeof draftRows[0].draft_payload === "string" ? JSON.parse(draftRows[0].draft_payload) : draftRows[0].draft_payload || {};
    } catch (e) {}

    const validDraftCount = countNonEmptyAnswers(dp.answersByRow, dp.questionResponses);
    if (validDraftCount > 0) {
      return {
        totalScore: Number(dp.totalScore || 0),
        totalWeightedScore: Number(dp.totalWeightedScore || 0),
        answersByRow: dp.answersByRow || {},
        questionResponses: Array.isArray(dp.questionResponses) ? dp.questionResponses : [],
      };
    }
  }

  return null;
}

async function fetchSubmissionsFromDatabase() {
  await ensureSubmissionsTable();

  const [rows] = await db.execute(
    `SELECT id, respondent_id, respondent_name, email, submitted_at, total_score, total_weighted_score, submission_payload, created_at
     FROM assessment_submissions
     ORDER BY submitted_at DESC, id DESC`
  );

  const result = [];
  for (const r of rows) {
    const norm = normalizeSubmissionRow(r);
    const validCount = countNonEmptyAnswers(norm.answersByRow, norm.questionResponses);

    if ((norm.totalScore === 0 || validCount === 0) && norm.email) {
      const best = await findBestScoresForEmail(norm.email);
      if (best) {
        if (best.totalScore > 0) {
          norm.totalScore = best.totalScore;
          norm.totalWeightedScore = best.totalWeightedScore;
        }
        if (countNonEmptyAnswers(best.answersByRow, best.questionResponses) > 0) {
          norm.answersByRow = best.answersByRow;
          const fullBestQuestions = buildCompleteQuestionResponses(best.questionResponses, best.answersByRow);
          norm.questionResponses = fullBestQuestions;
          norm.questions = fullBestQuestions;
        }
      }
    }
    result.push(norm);
  }

  return result;
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

    if (!normalizedPayload.firstName || normalizedPayload.firstName === "there" || normalizedPayload.firstName === "Lookup") {
      const { findRespondentByEmail } = require("./authController");
      const { toDecryptedRespondent } = require("../utils/dataSecurity");
      const existingResp = await findRespondentByEmail(normalizedPayload.email);
      if (existingResp) {
        const decrypted = toDecryptedRespondent(existingResp);
        const f = String(decrypted.firstname || "").trim();
        const l = String(decrypted.lastname || "").trim();
        if (f) normalizedPayload.firstName = f;
        if (l) normalizedPayload.lastName = l;
        if (f || l) normalizedPayload.respondent = `${f} ${l}`.trim();
      }
    }
    const existingSubmission = await findExistingAssessmentSubmission({
      respondentId: req.user?.id,
      email: normalizedPayload.email,
    });

    const isReschedule = Boolean(req.body?.isReschedule || req.body?.bookingDetails?.isReschedule || existingSubmission);

    const incomingValidCount = countNonEmptyAnswers(normalizedPayload.answersByRow, normalizedPayload.questionResponses);

    if (isReschedule || incomingValidCount === 0) {
      const best = await findBestScoresForEmail(normalizedPayload.email);
      if (best) {
        if (incomingValidCount === 0) {
          normalizedPayload.answersByRow = best.answersByRow;
          normalizedPayload.questionResponses = buildCompleteQuestionResponses(best.questionResponses, best.answersByRow);
        }
        if (normalizedPayload.totalScore === 0 && best.totalScore > 0) {
          normalizedPayload.totalScore = best.totalScore;
          normalizedPayload.totalWeightedScore = best.totalWeightedScore;
        }
      }
    }

    const { isSlotBookedOrBlocked } = require("../utils/slotService");
    const booking = normalizedPayload.bookingDetails || {};
    if (booking.scheduledDate && booking.scheduledTime) {
      const isUnavailable = await isSlotBookedOrBlocked(booking.scheduledDate, booking.scheduledTime);
      if (isUnavailable) {
        return res.status(409).json({
          success: false,
          message: `The time slot ${booking.scheduledTime} on ${booking.scheduledDate} was just booked by another user or is unavailable. Please choose another time slot.`,
        });
      }
    }

    const scriptUrl = process.env.GOOGLE_SCRIPT_URL || DEFAULT_SCRIPT_URL;
    const outgoingPayload = buildScriptPayload(normalizedPayload);

    let acceptedByUpstream = false;
    let parsed = null;
    let rawText = null;

    if (!isReschedule) {
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
    } else {
      acceptedByUpstream = true;
      parsed = { json: { success: true, message: "Skipped duplicate Google Sheet append on reschedule." }, text: "success" };
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
    let adminMailSent = false;

    try {
      const recipient = normalizedPayload.email;
      if (recipient) {
        mailSent = await sendAssessmentResultEmail(recipient, {
          respondent: normalizedPayload.respondent,
          firstName: normalizedPayload.firstName,
          lastName: normalizedPayload.lastName,
          email: normalizedPayload.email,
          totalScore: normalizedPayload.totalScore,
          totalWeightedScore: normalizedPayload.totalWeightedScore,
          submittedAt: normalizedPayload.submittedAt,
          answersByRow: normalizedPayload.answersByRow,
          questionResponses: normalizedPayload.questionResponses,
          bookingDetails: normalizedPayload.bookingDetails,
        });
      }
      try {
        adminMailSent =await sendAdminNotificationEmail({
          respondent: normalizedPayload.respondent,
          firstName: normalizedPayload.firstName,
          lastName: normalizedPayload.lastName,
          email: normalizedPayload.email,
          totalScore: normalizedPayload.totalScore,
          totalWeightedScore: normalizedPayload.totalWeightedScore,
          submittedAt: normalizedPayload.submittedAt,
          answersByRow: normalizedPayload.answersByRow,
          questionResponses: normalizedPayload.questionResponses,
          bookingDetails: normalizedPayload.bookingDetails,
        });
      } catch (err) {
        console.error("Failed to send admin notification:", err.message);
      }

    } catch (e) {
      mailSent = false;
      adminMailSent = false;
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

