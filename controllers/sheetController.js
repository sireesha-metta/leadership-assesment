const DEFAULT_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbytHuWxCiTwSTM-1gbpt2UgWzGXWDhZD-QqllAyC6Tcy_xxrdD--Kk2QBjYGcXbubfY/exec";
const UPSTREAM_TIMEOUT_MS = Number(process.env.GOOGLE_SCRIPT_TIMEOUT_MS || 30000);
const UPSTREAM_RETRY_COUNT = Number(process.env.GOOGLE_SCRIPT_RETRY_COUNT || 1);

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

exports.submitAssessment = async (req, res) => {
  try {
    const scriptUrl = process.env.GOOGLE_SCRIPT_URL || DEFAULT_SCRIPT_URL;
    const outgoingPayload = buildScriptPayload(req.body || {});

    const upstream = await fetchWithTimeoutAndRetry(scriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(outgoingPayload),
    });

    const rawText = await upstream.text();
    const parsed = parseTextResult(rawText);

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
