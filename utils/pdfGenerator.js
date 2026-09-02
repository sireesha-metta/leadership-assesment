const PDFDocument = require("pdfkit");

function toSafeText(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toSafeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function drawSectionTitle(doc, title) {
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(title);

  doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).lineWidth(1).strokeColor("#e2e8f0").stroke();

  doc.moveDown(0.8);
}

function ensureSpace(doc, minHeight = 120) {
  if (doc.y + minHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
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

function buildResponses(payload) {
  const byRow = payload?.answersByRow && typeof payload.answersByRow === "object" ? payload.answersByRow : {};
  const existingResponses = Array.isArray(payload?.questionResponses) ? payload.questionResponses : [];

  const existingMap = new Map();
  existingResponses.forEach((item, idx) => {
    if (item && (item.question || item.number || item.rowIndex)) {
      const key = item.rowIndex || item.number || (idx + 1);
      existingMap.set(String(key), item);
    }
  });

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
      answer: finalAnswer || "-",
      score: existingItem?.score ?? null,
      weight: existingItem?.weight ?? q.weight,
      weightedScore: existingItem?.weightedScore ?? null,
    };
  });
}

function formatMetric(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : "-";
}

function generateAssessmentPdf(payload) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        resolve(Buffer.concat(buffers));
      });

      const name = toSafeText(
        payload?.respondent || `${payload?.firstName || ""} ${payload?.lastName || ""}`.trim(),
        "Participant"
      );
      const email = toSafeText(payload?.email);
      const submittedDate = payload?.submittedAt ? String(payload.submittedAt).split("T")[0] : new Date().toISOString().split("T")[0];
      const totalScore = toSafeNumber(payload?.totalScore);
      const totalWeightedScore = toSafeNumber(payload?.totalWeightedScore);
      const responses = buildResponses(payload);

      doc.font("Helvetica-Bold").fontSize(24).fillColor("#0b2f5b").text("Leadership Assessment Report", { align: "center" });

      doc.font("Helvetica").fontSize(10).fillColor("#475569").text("Confidential assessment summary", { align: "center" });

      doc.moveDown();

      drawSectionTitle(doc, "Respondent Details");
      doc.font("Helvetica").fontSize(11).fillColor("#111827");
      doc.text(`Name: ${name}`);
      doc.text(`Email: ${email}`);
      doc.text(`Submitted: ${submittedDate}`);

      doc.moveDown();

      const booking = payload?.bookingDetails || {};
      const scheduledDate = booking.scheduledDate || payload?.scheduledDate;
      const scheduledTime = booking.scheduledTime || payload?.scheduledTime || "-";
      const timeZone = booking.timeZone || payload?.timeZone || "-";

      if (scheduledDate) {
        drawSectionTitle(doc, "Scheduled Discussion Details");
        doc.font("Helvetica").fontSize(11).fillColor("#111827");
        doc.text(`Topic: 20 mins Discussion with Lorraine Burns`);
        doc.text(`Date: ${scheduledDate}`);
        doc.text(`Time: ${scheduledTime}`);
        doc.text(`Time Zone: ${timeZone}`);
        doc.moveDown();
      }

      drawSectionTitle(doc, "Assessment Summary");
      doc.font("Helvetica").fontSize(11).fillColor("#111827");
      doc.text(`Total Score: ${totalScore}`);
      doc.text(`Total Weighted Score: ${totalWeightedScore}/100`);

      doc.moveDown();

      drawSectionTitle(doc, "Responses");

      if (responses.length === 0) {
        doc.font("Helvetica-Oblique").fontSize(11).fillColor("#64748b").text("No detailed responses were available for this submission.");
      }

      responses.forEach((item, index) => {
        ensureSpace(doc, 140);

        const question = toSafeText(item?.question);
        const answer = toSafeText(item?.answer);
        const score = formatMetric(item?.score);
        const weight = formatMetric(item?.weight);
        const weightedScore = formatMetric(item?.weightedScore);

        const boxTop = doc.y;
        const boxLeft = 50;
        const boxWidth = 495;
        const boxHeight = 108;

        doc.save().roundedRect(boxLeft, boxTop, boxWidth, boxHeight, 6).fillAndStroke("#f8fafc", "#e2e8f0").restore();

        doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(`Question ${item?.number || index + 1}`, boxLeft + 12, boxTop + 10);

        doc.font("Helvetica").fontSize(10.5).fillColor("#1f2937").text(question, boxLeft + 12, boxTop + 28, { width: boxWidth - 24 });

        const answerTop = doc.y + 4;
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a").text("Answer:", boxLeft + 12, answerTop);

        doc.font("Helvetica").fontSize(10.5).fillColor("#1f2937").text(answer, boxLeft + 60, answerTop, { width: boxWidth - 72 });

        doc.font("Helvetica").fontSize(10).fillColor("#334155").text(`Score: ${score}   |   Weight: ${weight}   |   Weighted Score: ${weightedScore}`, boxLeft + 12, boxTop + boxHeight - 20);

        doc.y = boxTop + boxHeight + 14;
      });

      ensureSpace(doc, 90);

      doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(1).strokeColor("#e2e8f0").stroke();

      doc.moveDown();
      doc.font("Helvetica").fontSize(10).fillColor("#475569").text("Thank you for completing the Leadership Assessment.", { align: "center" });

      doc.font("Helvetica-Bold").fontSize(10).fillColor("#1e293b").text("Leadership Assessment Team", { align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateAssessmentPdf };
