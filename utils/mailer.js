const { URLSearchParams } = require('url');
const { generateAssessmentPdf } = require("./pdfGenerator");

// Microsoft Graph (client credentials) config — Graph-only (no SMTP fallback)
const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID || process.env.AZURE_TENANT_ID || '';
const GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '';
const GRAPH_FROM = process.env.GRAPH_FROM || process.env.MAIL_FROM || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";


async function sendViaGraph(to, subject, html, attachments = []) {
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET || !GRAPH_FROM) {
    console.error('Graph mailer not configured; missing Graph env variables. Aborting send to', to);
    return false;
  }

  try {
    const tokenUrl = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', GRAPH_CLIENT_ID);
    params.append('client_secret', GRAPH_CLIENT_SECRET);
    params.append('scope', 'https://graph.microsoft.com/.default');

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => '');
      console.error('Graph token request failed', tokenRes.status, txt);
      return false;
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      console.error('No access token from Graph token response');
      return false;
    }

    const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(GRAPH_FROM)}/sendMail`;
    const body = {
      message: {
        subject,
        body: { contentType: "HTML", content: html, },
        toRecipients: [{ emailAddress: { address: to, }, },], attachments,
      },
      saveToSentItems: false,
    };

    const sendRes = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!sendRes.ok) {
      const txt = await sendRes.text().catch(() => '');
      console.error('Graph sendMail failed', sendRes.status, txt);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error sending via Graph', err && err.message);
    return false;
  }
}

async function sendAssessmentResultEmail(to, payload) {
  if (!to) return false;

  const subject = "Your Leadership Assessment Results - Lean In Coaching";

  const html = renderAssessmentHtml(payload);

  const pdfBuffer = await generateAssessmentPdf(payload);

  const attachments = [
    {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "Leadership Assessment Report.pdf",
      contentType: "application/pdf",
      contentBytes: pdfBuffer.toString("base64"),
    },
  ];

  return await sendViaGraph(to, subject, html, attachments);
}

function renderAssessmentHtml(payload) {
  const name = String(payload?.respondent || `${payload?.firstName || ""} ${payload?.lastName || ""}`.trim()).trim();

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.7;padding:20px;max-width:640px;">
    <p style="margin:0 0 12px 0;">Dear <strong>${name || "Participant"}</strong>,</p>

    <p style="margin:0 0 12px 0;">
      Thank you for completing the <strong>Leadership Assessment</strong>.
    </p>

    <p style="margin:0 0 12px 0;">
      Your assessment report is attached as a PDF. Please review the results and key observations at your convenience.
    </p>

    <p style="margin:0 0 18px 0;">
      If you need any clarification, you may contact the Leadership Assessment team.
    </p>

    <p style="margin:0;">Kind regards,</p>
    <p style="margin:4px 0 0 0;"><strong>Leadership Assessment Team</strong></p>
  </div>
  `;
}

function renderDraftReminderHtml(payload) {
  const first = String(payload?.firstName || "").trim();
  const name = first || String(payload?.respondentName || "").trim() || "there";

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

async function sendAdminNotificationEmail(payload) {

  const pdfBuffer = await generateAssessmentPdf(payload);

  const attachments = [
    {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "Leadership Assessment Report.pdf",
      contentType: "application/pdf",
      contentBytes: pdfBuffer.toString("base64"),
    },
  ];
  return await sendViaGraph(ADMIN_EMAIL, "New Leadership Assessment Completed", renderAdminNotificationHtml(payload), attachments);
}

function renderAdminNotificationHtml(payload) {
  const name = String(payload?.respondent || `${payload?.firstName || ""} ${payload?.lastName || ""}`.trim()).trim();

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.7;padding:20px;max-width:680px;">
  <h2 style="margin:0;color:#1f4e79;">New Leadership Assessment Completed</h2>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">

  <p style="margin:0 0 10px 0;">
    <strong>${name || "Participant"}</strong> (${payload?.email || "-"}) has completed the
    <strong>Leadership Assessment</strong>.
  </p>

  <p style="margin:0 0 10px 0;">The completed assessment report is attached as a PDF for review.</p>

  <p style="margin:0 0 16px 0;">Please log in to the Admin Portal to review the submission.</p>

  <div style="margin:22px 0;">
    <a href="https://leadership-assesments-sigma.vercel.app/login" style="background:#1f4e79;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;display:inline-block;font-weight:bold;">
      Open Admin Portal
    </a>
  </div>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">

  <p style="font-size:12px;color:#6b7280;margin:0;">
    This is an automated notification from the <strong>Leadership Assessment System</strong>. Please do not reply to this email.
  </p>

  <p style="margin:16px 0 0 0;">Kind regards,<br><strong>Leadership Assessment Team</strong></p>

</div>
`;
}

module.exports = { sendAssessmentResultEmail, sendDraftReminderEmail, renderAdminNotificationHtml, sendAdminNotificationEmail };
