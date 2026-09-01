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

  // PDF report attachment to user commented out per requirement:
  // const pdfBuffer = await generateAssessmentPdf(payload);
  // const attachments = [
  //   {
  //     "@odata.type": "#microsoft.graph.fileAttachment",
  //     name: "Leadership Assessment Report.pdf",
  //     contentType: "application/pdf",
  //     contentBytes: pdfBuffer.toString("base64"),
  //   },
  // ];

  return await sendViaGraph(to, subject, html, []);
}

function renderAssessmentHtml(payload) {
  const firstName = String(payload?.firstName || payload?.respondent || "there").trim().toLowerCase();
  // Capitalize first letter
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  const booking = payload?.bookingDetails || {};
  const scheduledTime = booking.scheduledTime || "08:00pm";
  const timeZone = booking.timeZone || "India, Sri Lanka Time";
  
  // Format fallback date if not provided
  let scheduledDate = booking.scheduledDate;
  if (!scheduledDate) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    scheduledDate = tomorrow.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  const calendarUrl = booking.calendarUrl || "https://calendly.com/leanin-coaching/30min";
  const rescheduleUrl = booking.rescheduleUrl || "https://calendly.com/leanin-coaching/30min";
  const cancelUrl = booking.cancelUrl || "https://calendly.com/leanin-coaching/30min";

  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #222222; background-color: #ffffff;">
    
    <!-- Top Header Logo -->
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="https://images.squarespace-cdn.com/content/v1/688fa63bb2679a2af766c186/9333d345-db92-4d96-a86a-638de0360a1a/lean-in-logo.webp" alt="Lorraine Burns" style="max-height: 48px; width: auto; display: inline-block;" />
    </div>

    <!-- Dashed Line -->
    <div style="border-top: 1px dashed #d1d5db; margin: 24px 0;"></div>

    <!-- Greeting -->
    <p style="font-size: 16px; color: #111827; margin: 0 0 20px 0; line-height: 1.5;">
      Hi ${displayName},
    </p>

    <!-- Main Schedule Message -->
    <p style="font-size: 17px; color: #1f2937; line-height: 1.6; margin: 0 0 28px 0;">
      Your 20 mins Discussion with Lorraine Burns at ${scheduledTime} (${timeZone}) on ${scheduledDate} is scheduled.
    </p>

    <!-- Subtext -->
    <p style="font-size: 14px; font-weight: 700; color: #111827; text-align: center; margin: 0 0 20px 0; line-height: 1.5;">
      This event should automatically show up on your calendar. If needed, you can still add it manually:
    </p>

    <!-- Add to Calendar Button -->
    <div style="text-align: center; margin: 0 0 36px 0;">
      <a href="${calendarUrl}" target="_blank" style="background-color: #0066ff; color: #ffffff; text-decoration: none; padding: 14px 44px; font-size: 16px; font-weight: 600; border-radius: 4px; display: inline-block; box-shadow: 0 2px 4px rgba(0,102,255,0.2);">
        Add to Calendar
      </a>
    </div>

    <!-- Reschedule / Cancel Section Header -->
    <p style="font-size: 14px; font-weight: 700; color: #111827; text-align: center; margin: 0 0 16px 0;">
      Make changes to this event:
    </p>

    <!-- Buttons -->
    <div style="text-align: center; margin: 0 0 32px 0;">
      <a href="${rescheduleUrl}" target="_blank" style="border: 1px solid #d1d5db; background-color: #ffffff; color: #4b5563; text-decoration: none; padding: 10px 32px; font-size: 14px; font-weight: 500; border-radius: 4px; display: inline-block; margin-right: 12px;">
        Reschedule
      </a>
      <a href="${cancelUrl}" target="_blank" style="border: 1px solid #d1d5db; background-color: #ffffff; color: #4b5563; text-decoration: none; padding: 10px 32px; font-size: 14px; font-weight: 500; border-radius: 4px; display: inline-block;">
        Cancel
      </a>
    </div>

    <!-- Bottom Dashed Line -->
    <div style="border-top: 1px dashed #d1d5db; margin-top: 24px;"></div>

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

function buildGoogleCalendarUrl(title, details, dateStr, timeStr) {
  try {
    if (!dateStr || dateStr === "Not scheduled") return null;
    let cleanDate = dateStr;
    if (cleanDate.includes(',')) {
      const parts = cleanDate.split(',');
      cleanDate = parts.length > 1 ? parts.slice(1).join(',').trim() : cleanDate;
    }
    let formattedTime = (timeStr || '9:00 AM').toUpperCase().trim();
    formattedTime = formattedTime.replace(/([0-9]+:[0-9]+)\s*([AP]M)/, '$1 $2');
    if (!formattedTime.includes('AM') && !formattedTime.includes('PM')) {
      formattedTime += ' AM';
    }

    const startDate = new Date(cleanDate + ' ' + formattedTime);
    if (isNaN(startDate.getTime())) return null;

    const endDate = new Date(startDate.getTime() + 20 * 60 * 1000);
    const formatUtc = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${formatUtc(startDate)}/${formatUtc(endDate)}&details=${encodeURIComponent(details)}`;
  } catch (e) {
    return null;
  }
}

function renderAdminNotificationHtml(payload) {
  const name = String(payload?.respondent || `${payload?.firstName || ""} ${payload?.lastName || ""}`.trim()).trim() || "Participant";
  const email = payload?.email || "-";
  const userIdentifier = `${name} (${email})`;

  const booking = payload?.bookingDetails || {};
  const scheduledTime = booking.scheduledTime || payload?.scheduledTime || "-";
  const timeZone = booking.timeZone || payload?.timeZone || "-";
  const scheduledDate = booking.scheduledDate || payload?.scheduledDate || "Not scheduled";

  const eventTitle = `20 mins Discussion with Lorraine Burns - ${name}`;
  const eventDetails = `Leadership Assessment 20 mins Discussion with ${userIdentifier}.\nScheduled Date: ${scheduledDate}\nScheduled Time: ${scheduledTime} (${timeZone})`;

  const googleCalUrl = buildGoogleCalendarUrl(eventTitle, eventDetails, scheduledDate, scheduledTime);
  const calendarActionUrl = googleCalUrl || booking.calendarUrl || "https://calendly.com/leanin-coaching/30min";

  const meetingConfirmationText = (scheduledDate && scheduledDate !== "Not scheduled")
    ? `${userIdentifier}'s 20 mins Discussion with Lorraine Burns at ${scheduledTime} (${timeZone}) on ${scheduledDate} is scheduled.`
    : null;

  const meetingSection = meetingConfirmationText ? `
  <div style="background-color:#f0f7ff;border:1px solid #cce3ff;border-radius:8px;padding:18px;margin:20px 0;">
    <h3 style="margin:0 0 10px 0;color:#1f4e79;font-size:15px;font-weight:bold;">📅 Participant Meeting Confirmation</h3>
    <p style="font-size:15px;color:#1f2937;margin:0 0 14px 0;line-height:1.5;font-weight:600;">
      ${meetingConfirmationText}
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151;border-top:1px dashed #cce3ff;padding-top:10px;">
      <tr>
        <td style="padding:6px 0;width:120px;font-weight:bold;color:#4b5563;">Participant:</td>
        <td style="padding:6px 0;font-weight:600;color:#111827;">${userIdentifier}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-weight:bold;color:#4b5563;">Topic:</td>
        <td style="padding:4px 0;">20 mins Discussion with Lorraine Burns</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-weight:bold;color:#4b5563;">Date:</td>
        <td style="padding:4px 0;font-weight:bold;color:#1f4e79;">${scheduledDate}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-weight:bold;color:#4b5563;">Time:</td>
        <td style="padding:4px 0;font-weight:bold;color:#1f4e79;">${scheduledTime}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-weight:bold;color:#4b5563;">Time Zone:</td>
        <td style="padding:4px 0;">${timeZone}</td>
      </tr>
    </table>

    <div style="margin-top:18px;text-align:center;">
      <a href="${calendarActionUrl}" target="_blank" style="background-color:#0066ff;color:#ffffff;text-decoration:none;padding:12px 28px;font-size:14px;font-weight:bold;border-radius:6px;display:inline-block;box-shadow:0 2px 4px rgba(0,102,255,0.2);">
        📅 Add to Calendar
      </a>
    </div>
  </div>
  ` : '';

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.7;padding:20px;max-width:680px;">
  <h2 style="margin:0;color:#1f4e79;">New Leadership Assessment Completed</h2>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">

  <p style="margin:0 0 10px 0;">
    <strong>${name}</strong> (${email}) has completed the <strong>Leadership Assessment</strong>.
  </p>

  ${meetingSection}

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
