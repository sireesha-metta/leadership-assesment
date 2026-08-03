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

function buildResponses(payload) {
  const directResponses = Array.isArray(payload?.questionResponses) ? payload.questionResponses : [];
  if (directResponses.length > 0) {
    return directResponses;
  }

  const byRow = payload?.answersByRow && typeof payload.answersByRow === "object" ? payload.answersByRow : {};

  return Object.entries(byRow).filter(([, answer]) => String(answer ?? "").trim()).sort((a, b) => Number(a[0]) - Number(b[0])).map(([rowIndex, answer], idx) => ({
    rowIndex: Number(rowIndex), number: idx + 1, question: `Question (Row ${rowIndex})`, answer: String(answer), score: null, weight: null, weightedScore: null,
  }));
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
