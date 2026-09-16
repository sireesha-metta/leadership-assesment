const nodemailer = require("nodemailer");
const { URLSearchParams } = require("url");
const { generateAssessmentPdf } = require("./pdfGenerator");
const { computeTab3Scoring } = require("./scoring");

const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID || process.env.AZURE_TENANT_ID || "";
const GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID || process.env.AZURE_CLIENT_ID || "";
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || "";
const GRAPH_FROM = process.env.GRAPH_FROM || process.env.MAIL_FROM || "testpoc@Solventek.com";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "sireeshametta@gmail.com";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";

function createSmtpTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

async function sendViaGraph(to, subject, html, attachments = []) {
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET || !GRAPH_FROM) {
    return false;
  }

  try {
    const tokenUrl = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", GRAPH_CLIENT_ID);
    params.append("client_secret", GRAPH_CLIENT_SECRET);
    params.append("scope", "https://graph.microsoft.com/.default");

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!tokenRes.ok) return false;

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) return false;

    const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(GRAPH_FROM)}/sendMail`;
    const body = {
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        attachments,
      },
      saveToSentItems: false,
    };

    const sendRes = await fetch(sendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return sendRes.ok;
  } catch (err) {
    console.error("Error sending via Graph:", err && err.message);
    return false;
  }
}

async function sendViaSmtp(to, subject, html, pdfBuffer = null) {
  const transporter = createSmtpTransporter();
  if (!transporter) return false;

  try {
    const mailOptions = {
      from: `"Lean In Coaching" <${GRAPH_FROM || "testpoc@Solventek.com"}>`,
      to,
      subject,
      html,
      attachments: pdfBuffer
        ? [
            {
              filename: "Your Leadership Reset Report.pdf",
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ]
        : [],
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent via SMTP:", info.messageId);
    return true;
  } catch (err) {
    console.error("Error sending via SMTP:", err && err.message);
    return false;
  }
}

async function sendAssessmentResultEmail(to, payload) {
  if (!to) return false;

  const subject = "Your Leadership Reset Report - Lean In Coaching";
  const html = renderAssessmentHtml(payload);

  let pdfBuffer = null;
  try {
    pdfBuffer = await generateAssessmentPdf(payload);
  } catch (err) {
    console.error("PDF generation error for respondent email:", err);
  }

  const graphAttachments = pdfBuffer
    ? [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: "Your Leadership Reset Report.pdf",
          contentType: "application/pdf",
          contentBytes: pdfBuffer.toString("base64"),
        },
      ]
    : [];

  const graphSuccess = await sendViaGraph(to, subject, html, graphAttachments);
  if (graphSuccess) {
    console.log("Respondent report email sent via Graph API to:", to);
    return true;
  }

  const smtpSuccess = await sendViaSmtp(to, subject, html, pdfBuffer);
  if (smtpSuccess) {
    return true;
  }

  console.warn("Mailers failed or not configured for sendAssessmentResultEmail to:", to);
  return false;
}

async function sendAdminNotificationEmail(payload) {
  const adminRecipient = ADMIN_EMAIL || "sireeshametta@gmail.com";
  const rawName = String(payload?.respondent || `${payload?.firstName || ""} ${payload?.lastName || ""}`.trim()).trim() || "Participant";
  const subject = `[NEW SUBMISSION] Leadership Reset Diagnostic - ${rawName}`;
  const html = renderAdminNotificationHtml(payload);

  let pdfBuffer = null;
  try {
    pdfBuffer = await generateAssessmentPdf(payload);
  } catch (e) {
    console.error("PDF generation error for admin email:", e);
  }

  const graphAttachments = pdfBuffer
    ? [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: `Leadership_Reset_Report_${rawName.replace(/\s+/g, "_")}.pdf`,
          contentType: "application/pdf",
          contentBytes: pdfBuffer.toString("base64"),
        },
      ]
    : [];

  const graphSuccess = await sendViaGraph(adminRecipient, subject, html, graphAttachments);
  if (graphSuccess) {
    console.log("Admin notification email sent via Graph API to:", adminRecipient);
    return true;
  }

  const smtpSuccess = await sendViaSmtp(adminRecipient, subject, html, pdfBuffer);
  if (smtpSuccess) {
    return true;
  }

  return false;
}

function renderAssessmentHtml(payload) {
  const rawName = String(payload?.firstName || payload?.firstname || payload?.respondent || "").trim();
  const displayName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : "Participant";
  const reportDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const qResponses = Array.isArray(payload?.questionResponses) ? payload.questionResponses : [];
  const scoring = computeTab3Scoring(qResponses);

  const zone = scoring.zone;
  const zoneTaglines = {
    Green: "GREEN — Strong alignment and healthy dynamics",
    Amber: "AMBER — Patterns worth exploring",
    Red: "RED — High friction and unvoiced risks",
  };
  const zoneColors = {
    Green: { bg: "#F0FDF4", border: "#BBF7D0", text: "#15803D" },
    Amber: { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309" },
    Red: { bg: "#FEF2F2", border: "#FECACA", text: "#B91C1C" },
  };

  const zCol = zoneColors[zone] || zoneColors.Amber;
  const zTagline = zoneTaglines[zone] || `ZONE — ${zone}`;

  const dmPct = scoring.categoryScores["Decision Making"].pctDisplay;
  const cpPct = scoring.categoryScores["Conversation Patterns"].pctDisplay;
  const lsPct = scoring.categoryScores["Leader Signals"].pctDisplay;

  const calendarUrl = process.env.CALENDAR_URL || "https://calendar.app.google/TG1ro9zZP4sCwJJx8";

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; padding: 28px; color: #1f2937; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px;">
    
    <!-- Header -->
    <div style="text-align: left; margin-bottom: 20px;">
      <h2 style="color: #000000; margin: 0; font-size: 20px; font-weight: bold; letter-spacing: 0.5px;">LEAN IN COACHING</h2>
      <p style="color: #666666; margin: 4px 0 0 0; font-size: 13px;">Small practical shifts. Not complexity.</p>
    </div>

    <div style="border-top: 1px solid #eeeeee; margin: 16px 0 24px 0;"></div>

    <!-- Title & Greeting -->
    <h1 style="font-size: 22px; font-weight: bold; color: #111827; margin: 0 0 16px 0;">Your Leadership Reset Report</h1>
    
    <p style="font-size: 15px; color: #1f2937; margin: 0 0 6px 0;">Hi ${displayName},</p>
    <p style="font-size: 12px; color: #4b5563; margin: 0 0 16px 0;">Participant: ${displayName} • Date: ${reportDate}</p>
    
    <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin: 0 0 24px 0;">
      Thanks for taking the time to work through this. What follows is a first read on how decisions get made in your leadership team right now — not a verdict, and not the full picture. Think of it as a starting point for a conversation, not the end of one.
    </p>

    <!-- Overall Score & Zone Box -->
    <div style="background-color: ${zCol.bg}; border: 1px solid ${zCol.border}; border-radius: 8px; padding: 20px; margin-bottom: 28px;">
      <div style="font-size: 28px; font-weight: bold; color: ${zCol.text}; margin-bottom: 6px;">
        ${scoring.rawTotal} / 91
      </div>
      <div style="font-size: 14px; font-weight: bold; color: ${zCol.text}; margin-bottom: 8px;">
        ${zTagline}
      </div>
      <p style="font-size: 13px; color: #374151; margin: 0; line-height: 1.5;">
        ${scoring.zoneSummary}
      </p>
    </div>

    <!-- Category Breakdown -->
    <h3 style="font-size: 15px; font-weight: bold; color: #111827; margin: 0 0 16px 0;">Where the room stands, by theme</h3>

    <div style="margin-bottom: 14px;">
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 4px;">
        <tr>
          <td style="font-size: 13px; font-weight: bold; color: #111111; text-align: left;">Decision Making</td>
          <td style="font-size: 13px; font-weight: bold; color: ${zCol.text}; text-align: right;">${scoring.categoryScores["Decision Making"].raw}/28 (${dmPct}%)</td>
        </tr>
      </table>
      <div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden;">
        <div style="background-color: ${zCol.text}; height: 8px; width: ${dmPct}%;"></div>
      </div>
    </div>

    <div style="margin-bottom: 14px;">
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 4px;">
        <tr>
          <td style="font-size: 13px; font-weight: bold; color: #111111; text-align: left;">Conversation Patterns</td>
          <td style="font-size: 13px; font-weight: bold; color: ${zCol.text}; text-align: right;">${scoring.categoryScores["Conversation Patterns"].raw}/28 (${cpPct}%)</td>
        </tr>
      </table>
      <div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden;">
        <div style="background-color: ${zCol.text}; height: 8px; width: ${cpPct}%;"></div>
      </div>
    </div>

    <div style="margin-bottom: 18px;">
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 4px;">
        <tr>
          <td style="font-size: 13px; font-weight: bold; color: #111111; text-align: left;">Leader Signals</td>
          <td style="font-size: 13px; font-weight: bold; color: ${zCol.text}; text-align: right;">${scoring.categoryScores["Leader Signals"].raw}/35 (${lsPct}%)</td>
        </tr>
      </table>
      <div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden;">
        <div style="background-color: ${zCol.text}; height: 8px; width: ${lsPct}%;"></div>
      </div>
    </div>

    <p style="font-size: 12px; color: #6b7280; font-style: italic; line-height: 1.5; margin: 0 0 28px 0;">
      These three areas each capture a different part of how decisions actually get made in your team — who speaks, who's heard, and how your own signals shape the room.
    </p>

    <!-- Two Shifts Worth Trying -->
    <h3 style="font-size: 15px; font-weight: bold; color: #111827; margin: 0 0 16px 0;">Two shifts worth trying</h3>

    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 16px; margin-bottom: 12px;">
      <div style="font-size: 12px; font-weight: bold; color: #111827; text-transform: uppercase; margin-bottom: 6px;">
        1. ${scoring.weakestCategory}
      </div>
      <p style="font-size: 13px; color: #374151; margin: 0; line-height: 1.5;">
        ${scoring.actions.pdfAction1}
      </p>
    </div>

    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 16px; margin-bottom: 24px;">
      <div style="font-size: 12px; font-weight: bold; color: #111827; text-transform: uppercase; margin-bottom: 6px;">
        2. ${scoring.secondWeakestCategory}
      </div>
      <p style="font-size: 13px; color: #374151; margin: 0; line-height: 1.5;">
        ${scoring.actions.pdfAction2}
      </p>
    </div>

    <!-- Diagnostic Answers & Q/A Section -->
    <h3 style="font-size: 15px; font-weight: bold; color: #111827; margin: 0 0 14px 0;">Your Submitted Answers & Baseline</h3>
    
    ${
      Array.isArray(payload?.oneWordAnswers) && payload.oneWordAnswers.length
        ? `<div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px;">
             <strong>Qualitative Baseline (3 Words):</strong> "${payload.oneWordAnswers.join(", ")}"
           </div>`
        : ""
    }

    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; margin-bottom: 28px;">
      <p style="font-size: 12px; font-weight: bold; color: #374151; margin: 0 0 8px 0;">Question Responses (${qResponses.length} Questions):</p>
      <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #4b5563; line-height: 1.6;">
        ${qResponses
          .map(
            (q, idx) =>
              `<li style="margin-bottom: 6px;">
                <strong>Q${idx + 1} (${q.section || "Theme"}):</strong> ${q.question || ""}<br/>
                <span style="color: #1e40af; font-weight: 500;">✓ Selected: ${q.answer || "No answer"}</span>
               </li>`
          )
          .join("")}
      </ul>
    </div>

    <!-- Attached PDF Banner -->
    <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 16px; margin-bottom: 28px;">
      <p style="font-size: 13px; font-weight: bold; color: #1d4ed8; margin: 0 0 4px 0;">
        📄 Attached PDF Report
      </p>
      <p style="font-size: 12px; color: #1e40af; margin: 0;">
        Your complete multi-page <strong>Your Leadership Reset Report.pdf</strong> (including full score breakdown, actions, and Q/A response details) is attached to this email.
      </p>
    </div>

    <!-- CTA Button -->
    <div style="text-align: center; margin-bottom: 28px;">
      <a href="${calendarUrl}" target="_blank" style="background-color: #0066ff; color: #ffffff; text-decoration: none; padding: 14px 36px; font-size: 15px; font-weight: bold; border-radius: 6px; display: inline-block; box-shadow: 0 2px 4px rgba(0,102,255,0.2);">
        Book a 20-minute conversation →
      </a>
      <p style="font-size: 12px; color: #6b7280; margin: 10px 0 0 0;">
        No pressure, no pitch. Just a chance to look at what you've found together.
      </p>
    </div>

    <!-- Footer -->
    <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; text-align: center; font-size: 11px; color: #9ca3af; line-height: 1.5;">
      This report is intended as a starting point for reflection, not a formal diagnostic assessment. © Lean-In Coaching Ltd, 2026. All rights reserved.
    </div>

  </div>
  `;
}

function renderAdminNotificationHtml(payload) {
  const name = String(payload?.respondent || `${payload?.firstName || ""} ${payload?.lastName || ""}`.trim()).trim() || "Participant";
  const email = payload?.email || "-";
  const mobile = payload?.mobile || "-";

  const qResponses = Array.isArray(payload?.questionResponses) ? payload.questionResponses : [];
  const scoring = computeTab3Scoring(qResponses);

  const oneWordList = Array.isArray(payload?.oneWordAnswers) && payload.oneWordAnswers.length
    ? payload.oneWordAnswers.join(", ")
    : (typeof payload?.oneWordAnswers === "string" ? payload.oneWordAnswers : "Not provided");

  const dmPct = scoring.categoryScores["Decision Making"].pctDisplay;
  const cpPct = scoring.categoryScores["Conversation Patterns"].pctDisplay;
  const lsPct = scoring.categoryScores["Leader Signals"].pctDisplay;

  const dmRaw = scoring.categoryScores["Decision Making"].raw;
  const cpRaw = scoring.categoryScores["Conversation Patterns"].raw;
  const lsRaw = scoring.categoryScores["Leader Signals"].raw;

  const booking = payload?.bookingDetails || {};
  const scheduledDate = booking.scheduledDate || payload?.scheduledDate || "Self-scheduled via Google Calendar";

  const zone = scoring.zone;
  const zoneTaglines = {
    Green: "GREEN — Strong alignment and healthy dynamics",
    Amber: "AMBER — Patterns worth exploring",
    Red: "RED — High friction and unvoiced risks",
  };
  const zoneColors = {
    Green: { bg: "#F0FDF4", border: "#BBF7D0", text: "#15803D" },
    Amber: { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309" },
    Red: { bg: "#FEF2F2", border: "#FECACA", text: "#B91C1C" },
  };

  const zCol = zoneColors[zone] || zoneColors.Amber;
  const zTagline = zoneTaglines[zone] || `ZONE — ${zone}`;

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; line-height: 1.6; padding: 24px; max-width: 680px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px;">
    
    <!-- Admin Header Banner -->
    <div style="background-color: #111827; color: #c8a85b; padding: 18px 24px; border-radius: 8px 8px 0 0;">
      <h2 style="margin: 0; font-size: 20px; font-weight: bold; letter-spacing: 0.5px;">LEAN IN COACHING — ADMIN NOTIFICATION</h2>
      <p style="margin: 4px 0 0 0; color: #ffffff; font-size: 13px;">New Leadership Reset Diagnostic Submission & PDF Report</p>
    </div>

    <div style="padding: 24px 8px;">
      
      <!-- Respondent Info Table -->
      <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 16px; font-weight: bold; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px;">
        👤 Respondent Information
      </h3>

      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
        <tr>
          <td style="padding: 6px 0; font-weight: bold; color: #4b5563; width: 150px;">Full Name:</td>
          <td style="padding: 6px 0; font-weight: bold; color: #111827;">${name}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: bold; color: #4b5563;">Email Address:</td>
          <td style="padding: 6px 0; color: #0066ff;"><a href="mailto:${email}">${email}</a></td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: bold; color: #4b5563;">Mobile / Contact:</td>
          <td style="padding: 6px 0; color: #374151;">${mobile}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: bold; color: #4b5563;">Submission Date:</td>
          <td style="padding: 6px 0; color: #374151;">${new Date().toLocaleString()}</td>
        </tr>
      </table>

      <!-- Overall Score & Zone Box -->
      <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 16px; font-weight: bold; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px;">
        📊 Assessment Results & Diagnostic Scores
      </h3>

      <div style="background-color: ${zCol.bg}; border: 1px solid ${zCol.border}; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <div style="font-size: 26px; font-weight: bold; color: ${zCol.text}; margin-bottom: 6px;">
          Overall Score: ${scoring.rawTotal} / 91 (${scoring.overallPctDisplay}%)
        </div>
        <div style="font-size: 14px; font-weight: bold; color: ${zCol.text}; margin-bottom: 8px;">
          ${zTagline}
        </div>
        <p style="font-size: 13px; color: #374151; margin: 0; line-height: 1.5;">
          ${scoring.zoneSummary}
        </p>
      </div>

      <!-- Theme Breakdown Progress Bars -->
      <h4 style="font-size: 14px; font-weight: bold; color: #111827; margin: 0 0 12px 0;">Where the room stands, by theme</h4>

      <div style="margin-bottom: 12px;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 4px;">
          <tr>
            <td style="font-size: 13px; font-weight: bold; color: #111111; text-align: left;">Decision Making</td>
            <td style="font-size: 13px; font-weight: bold; color: ${zCol.text}; text-align: right;">${dmRaw}/28 (${dmPct}%)</td>
          </tr>
        </table>
        <div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden;">
          <div style="background-color: ${zCol.text}; height: 8px; width: ${dmPct}%;"></div>
        </div>
      </div>

      <div style="margin-bottom: 12px;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 4px;">
          <tr>
            <td style="font-size: 13px; font-weight: bold; color: #111111; text-align: left;">Conversation Patterns</td>
            <td style="font-size: 13px; font-weight: bold; color: ${zCol.text}; text-align: right;">${cpRaw}/28 (${cpPct}%)</td>
          </tr>
        </table>
        <div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden;">
          <div style="background-color: ${zCol.text}; height: 8px; width: ${cpPct}%;"></div>
        </div>
      </div>

      <div style="margin-bottom: 20px;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 4px;">
          <tr>
            <td style="font-size: 13px; font-weight: bold; color: #111111; text-align: left;">Leader Signals</td>
            <td style="font-size: 13px; font-weight: bold; color: ${zCol.text}; text-align: right;">${lsRaw}/35 (${lsPct}%)</td>
          </tr>
        </table>
        <div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden;">
          <div style="background-color: ${zCol.text}; height: 8px; width: ${lsPct}%;"></div>
        </div>
      </div>

      <!-- Two Recommended Shifts -->
      <h4 style="font-size: 14px; font-weight: bold; color: #111827; margin: 0 0 12px 0;">Recommended Action Shifts</h4>

      <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; margin-bottom: 10px;">
        <div style="font-size: 11px; font-weight: bold; color: #111827; text-transform: uppercase; margin-bottom: 4px;">
          1. ${scoring.weakestCategory} (Primary Area for Shift)
        </div>
        <p style="font-size: 13px; color: #374151; margin: 0; line-height: 1.5;">
          ${scoring.actions.pdfAction1}
        </p>
      </div>

      <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; margin-bottom: 24px;">
        <div style="font-size: 11px; font-weight: bold; color: #111827; text-transform: uppercase; margin-bottom: 4px;">
          2. ${scoring.secondWeakestCategory}
        </div>
        <p style="font-size: 13px; color: #374151; margin: 0; line-height: 1.5;">
          ${scoring.actions.pdfAction2}
        </p>
      </div>

      <!-- 3 One-Word Answers -->
      <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 16px; font-weight: bold; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px;">
        💬 Qualitative Baseline: 3 One-Word Answers
      </h3>
      <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
        <p style="font-size: 15px; font-weight: bold; color: #1e40af; margin: 0;">
          "${oneWordList}"
        </p>
      </div>

      <!-- Q/A Responses Breakdown -->
      <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 16px; font-weight: bold; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px;">
        📝 Detailed Question & Answer Breakdown
      </h3>
      <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 16px; margin-bottom: 24px;">
        <p style="font-size: 12px; font-weight: bold; color: #374151; margin: 0 0 8px 0;">Participant Responses (${qResponses.length} Questions):</p>
        <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #4b5563; line-height: 1.6;">
          ${qResponses
            .map(
              (q, idx) =>
                `<li style="margin-bottom: 6px;">
                  <strong>Q${idx + 1} (${q.section || "Theme"}):</strong> ${q.question || ""}<br/>
                  <span style="color: #1e40af; font-weight: 500;">✓ Selected Answer: ${q.answer || "No answer"}</span>
                 </li>`
            )
            .join("")}
        </ul>
      </div>

      <!-- Discussion Booking Info -->
      <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 16px; font-weight: bold; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px;">
        📅 Discussion Booking Status
      </h3>
      <p style="font-size: 14px; color: #374151; margin: 0 0 24px 0;">
        ${scheduledDate}
      </p>

      <!-- Attached PDF Report Notice -->
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="font-size: 14px; font-weight: bold; color: #15803d; margin: 0 0 4px 0;">
          📎 Attached PDF Report
        </p>
        <p style="font-size: 12px; color: #166534; margin: 0;">
          The complete multi-page PDF report <strong>Leadership_Reset_Report_${name.replace(/\s+/g, "_")}.pdf</strong> (including full diagnostic scores, action shifts, and Q/A breakdown) is attached to this email.
        </p>
      </div>

    </div>

    <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 12px; color: #6b7280; text-align: center;">
      Automated Admin Notification from <strong>Leadership Assessment System</strong>
    </div>
  </div>
  `;
}

function renderDraftReminderHtml(payload) {
  const first = String(payload?.firstName || "").trim();
  const name = first || String(payload?.respondentName || "").trim() || "Participant";

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.5">
      <p>Hi ${name},</p>
      <p>You did not complete your Leadership Assessment yet.</p>
      <p>Please complete that in next 8 hours for better result.</p>
      <p style="margin-top:24px">Thanks & Regards,<br/>Leadership Assessment Team</p>
    </div>
  `;
}

async function sendDraftReminderEmail(to, payload) {
  if (!to) return false;
  const subject = "Reminder: Complete your Leadership Assessment";
  const html = renderDraftReminderHtml(payload || {});
  return await sendViaGraph(to, subject, html);
}

async function sendCancellationUserEmail(to, payload) {
  if (!to) return false;
  const subject = "Discussion Slot Cancelled - Lean In Coaching";
  let first = String(payload?.firstName || payload?.firstname || payload?.respondent || "").trim();

  const nameCapitalized = first ? first.charAt(0).toUpperCase() + first.slice(1) : "Participant";
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.7;padding:20px;max-width:640px;margin:0 auto;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:10px;">
      <h3 style="color:#dc2626;margin-top:0;">Discussion Slot Cancelled</h3>
      <p style="font-size:15px;color:#374151;">Hi ${nameCapitalized},</p>
      <p style="font-size:14px;color:#4b5563;">Your discussion slot has been cancelled.</p>
    </div>
  `;
  return await sendViaGraph(to, subject, html, []);
}

async function sendCancellationAdminEmail(payload) {
  const adminRecipient = ADMIN_EMAIL || "sireeshametta@gmail.com";
  const name = String(payload?.respondent || payload?.firstName || "Participant").trim();
  const email = String(payload?.email || "").trim();
  const subject = `[CANCELLED] Discussion Slot Cancelled - ${name}`;
  const html = `<p>${name} (${email}) has cancelled their slot.</p>`;
  return await sendViaGraph(adminRecipient, subject, html, []);
}

module.exports = {
  sendAssessmentResultEmail,
  sendDraftReminderEmail,
  renderAdminNotificationHtml,
  sendAdminNotificationEmail,
  sendCancellationUserEmail,
  sendCancellationAdminEmail,
};
