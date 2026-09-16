const PDFDocument = require("pdfkit");
const { computeTab3Scoring } = require("./scoring");

function toSafeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

const ZONE_TAGLINES = {
  Green: "GREEN — Strong alignment and healthy dynamics",
  Amber: "AMBER — Patterns worth exploring",
  Red: "RED — High friction and unvoiced risks",
};

const ZONE_COLORS = {
  Green: { primary: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" },
  Amber: { primary: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
  Red: { primary: "#B91C1C", bg: "#FEF2F2", border: "#FECACA" },
};

function drawHeader(doc) {
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000000").text("LEAN IN COACHING", 40, 35);
  doc.font("Helvetica").fontSize(9).fillColor("#666666").text("Small practical shifts. Not complexity.", 40, 50);
  doc.moveTo(40, 65).lineTo(555, 65).lineWidth(0.5).strokeColor("#DDDDDD").stroke();
}

function drawFooter(doc, pageNum = 1, totalPages = 3) {
  const footerY = 760;
  doc.moveTo(40, footerY).lineTo(555, footerY).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
  const copyrightText =
    "This report is intended as a starting point for reflection, not a formal diagnostic assessment. © Lean-In Coaching Ltd, 2026. All rights reserved.";
  doc.font("Helvetica").fontSize(7.5).fillColor("#9CA3AF").text(copyrightText, 40, footerY + 8, {
    width: 515,
    align: "center",
  });
}

function generateAssessmentPdf(payload) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40, autoFirstPage: true });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        resolve(Buffer.concat(buffers));
      });

      const firstName = toSafeText(payload?.firstName || payload?.firstname || payload?.respondent, "Participant");
      const reportDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const qResponses = Array.isArray(payload?.questionResponses) ? payload.questionResponses : [];
      const scoring = computeTab3Scoring(qResponses);

      const zone = scoring.zone;
      const zoneTagline = ZONE_TAGLINES[zone] || `ZONE — ${zone}`;
      const zColor = ZONE_COLORS[zone] || ZONE_COLORS.Amber;
      const overallScoreDisplay = `${scoring.rawTotal} / 91 (${scoring.overallPctDisplay}%)`;

      const oneWords = Array.isArray(payload?.oneWordAnswers) && payload.oneWordAnswers.length
        ? payload.oneWordAnswers.join(", ")
        : (typeof payload?.oneWordAnswers === "string" ? payload.oneWordAnswers : "");

      // ==========================================
      // PAGE 1: EXECUTIVE SUMMARY & SCORE OVERVIEW
      // ==========================================
      drawHeader(doc);
      let y = 80;

      // Title & Greeting
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#000000").text("Your Leadership Reset Report", 40, y);
      y += 26;

      doc.font("Helvetica").fontSize(9.5).fillColor("#222222").text(`Hi ${firstName},`, 40, y);
      doc.font("Helvetica").fontSize(8.5).fillColor("#4B5563").text(`Participant: ${firstName} • Date: ${reportDate}`, 40, y + 14);
      y += 28;

      const introText =
        "Thanks for taking the time to work through this. What follows is a first read on how decisions get made in your leadership team right now — not a verdict, and not the full picture. Think of it as a starting point for a conversation, not the end of one.";
      doc.font("Helvetica").fontSize(9).fillColor("#444444").text(introText, 40, y, { width: 515, lineGap: 2.5 });
      y += 38;

      // Overall Score & Zone Card
      const cardHeight = 90;
      doc.roundedRect(40, y, 515, cardHeight, 6).fillAndStroke(zColor.bg, zColor.border);

      doc.font("Helvetica-Bold").fontSize(20).fillColor(zColor.primary).text(overallScoreDisplay, 55, y + 14);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(zColor.primary).text(zoneTagline, 55, y + 38);

      doc.font("Helvetica").fontSize(8.5).fillColor("#333333").text(scoring.zoneSummary, 55, y + 54, { width: 485, lineGap: 2 });
      y += cardHeight + 18;

      // Category Percentage Breakdown ("Where the room stands, by theme")
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000").text("Where the room stands, by theme", 40, y);
      y += 18;

      const themes = [
        { name: "Decision Making", pct: scoring.categoryScores["Decision Making"].pctDisplay, raw: scoring.categoryScores["Decision Making"].raw, max: 28 },
        { name: "Conversation Patterns", pct: scoring.categoryScores["Conversation Patterns"].pctDisplay, raw: scoring.categoryScores["Conversation Patterns"].raw, max: 28 },
        { name: "Leader Signals", pct: scoring.categoryScores["Leader Signals"].pctDisplay, raw: scoring.categoryScores["Leader Signals"].raw, max: 35 },
      ];

      themes.forEach((theme) => {
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#111111").text(theme.name, 40, y);
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(zColor.primary).text(`${theme.raw}/${theme.max} (${theme.pct}%)`, 40, y, { width: 515, align: "right" });
        y += 15;

        // Progress Bar
        doc.roundedRect(40, y, 515, 7, 3.5).fill("#E5E7EB");
        const fillWidth = Math.max(10, Math.min(515, (theme.pct / 100) * 515));
        doc.roundedRect(40, y, fillWidth, 7, 3.5).fill(zColor.primary);
        y += 16;
      });

      const themeFootnote =
        "These three areas each capture a different part of how decisions actually get made in your team — who speaks, who's heard, and how your own signals shape the room.";
      doc.font("Helvetica-Oblique").fontSize(8).fillColor("#666666").text(themeFootnote, 40, y, { width: 515, lineGap: 2 });
      y += 28;

      // Two shifts worth trying
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000").text("Two shifts worth trying", 40, y);
      y += 18;

      const actionsList = [
        { num: 1, category: scoring.weakestCategory.toUpperCase(), text: scoring.actions.pdfAction1 },
        { num: 2, category: scoring.secondWeakestCategory.toUpperCase(), text: scoring.actions.pdfAction2 },
      ];

      actionsList.forEach((act) => {
        const actBoxHeight = 46;
        doc.roundedRect(40, y, 515, actBoxHeight, 4).fillAndStroke("#F9FAFB", "#E5E7EB");

        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827").text(`${act.num}. ${act.category}`, 50, y + 8);
        doc.font("Helvetica").fontSize(8).fillColor("#374151").text(act.text, 50, y + 21, { width: 495, lineGap: 2 });

        y += actBoxHeight + 8;
      });

      const shiftFootnote =
        "Small, specific shifts like these tend to move the needle faster than a big restructure — that's deliberate. Try one at a time.";
      doc.font("Helvetica-Oblique").fontSize(8).fillColor("#666666").text(shiftFootnote, 40, y, { width: 515 });

      drawFooter(doc, 1, 3);

      // ==========================================
      // PAGE 2: DIAGNOSTIC QUESTIONS & ANSWERS BREAKDOWN
      // ==========================================
      doc.addPage();
      drawHeader(doc);
      y = 80;

      doc.font("Helvetica-Bold").fontSize(14).fillColor("#000000").text("Diagnostic Answers & Response Breakdown", 40, y);
      y += 20;

      // One Word Baseline Box
      if (oneWords) {
        doc.roundedRect(40, y, 515, 38, 5).fillAndStroke("#EFF6FF", "#BFDBFE");
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#1E40AF").text("Qualitative Baseline (3 Words):", 50, y + 8);
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#1D4ED8").text(`"${oneWords}"`, 50, y + 21);
        y += 48;
      }

      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text("Diagnostic Questions & Selected Answers", 40, y);
      y += 16;

      if (qResponses.length > 0) {
        qResponses.forEach((qItem, index) => {
          // Check pagination space
          if (y > 700) {
            drawFooter(doc);
            doc.addPage();
            drawHeader(doc);
            y = 80;
          }

          const qNum = index + 1;
          const section = toSafeText(qItem?.section, "Diagnostic Question");
          const qText = toSafeText(qItem?.question, `Question ${qNum}`);
          const answerText = toSafeText(qItem?.answer, "No response provided");
          const score = Number.isFinite(Number(qItem?.score)) ? Number(qItem.score) : 0;

          // Question Box
          doc.roundedRect(40, y, 515, 48, 4).fillAndStroke("#F9FAFB", "#E5E7EB");
          
          doc.font("Helvetica-Bold").fontSize(8).fillColor("#4B5563").text(`Q${qNum}. [${section.toUpperCase()}]`, 48, y + 6);
          doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827").text(qText, 48, y + 17, { width: 430, height: 12, ellipsis: true });
          
          doc.font("Helvetica-Bold").fontSize(8).fillColor(zColor.primary).text(`Score: ${score}`, 480, y + 6, { align: "right" });

          // Selected Answer Bar
          doc.roundedRect(48, y + 30, 499, 14, 3).fill("#EEF2FF");
          doc.font("Helvetica").fontSize(7.5).fillColor("#3730A3").text(`Selected: ${answerText}`, 54, y + 33, { width: 485, ellipsis: true });

          y += 54;
        });
      } else {
        doc.font("Helvetica").fontSize(9).fillColor("#666666").text("No individual question responses recorded.", 40, y);
        y += 30;
      }

      drawFooter(doc);

      // ==========================================
      // PAGE 3: DEBRIEF & GOOGLE CALENDAR CTA
      // ==========================================
      if (y > 550) {
        doc.addPage();
        drawHeader(doc);
        y = 80;
      } else {
        y += 20;
      }

      doc.font("Helvetica-Bold").fontSize(13).fillColor("#000000").text("What this doesn't tell you", 40, y);
      y += 22;

      const page2Body =
        "This snapshot is based on your own view of your team. It's a useful starting point, but it doesn't capture what your team would say if asked the same questions — which is often where the real insight is. That's exactly what a full Leadership Reset conversation is designed to surface.";
      doc.font("Helvetica").fontSize(9.5).fillColor("#333333").text(page2Body, 40, y, { width: 515, lineGap: 3.5 });
      y += 60;

      // CTA Box
      const ctaHeight = 85;
      doc.roundedRect(40, y, 515, ctaHeight, 6).fillAndStroke("#F3F4F6", "#D1D5DB");

      const calendarUrl = process.env.CALENDAR_URL || "https://calendar.app.google/TG1ro9zZP4sCwJJx8";
      const btnWidth = 230;
      const btnHeight = 32;
      const btnX = 182;
      const btnY = y + 18;

      doc.roundedRect(btnX, btnY, btnWidth, btnHeight, 4).fill("#0066FF");
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#FFFFFF").text("Book a 20-minute conversation →", btnX, btnY + 10, {
        width: btnWidth,
        align: "center",
      });

      // Add clickable link annotation to CTA button
      doc.link(btnX, btnY, btnWidth, btnHeight, calendarUrl);

      const ctaSubtext =
        "No pressure, no pitch. Just a chance to look at what you've found together and figure out if it's worth going further.";
      doc.font("Helvetica").fontSize(8).fillColor("#555555").text(ctaSubtext, 55, y + 58, {
        width: 485,
        align: "center",
      });

      drawFooter(doc);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateAssessmentPdf };
