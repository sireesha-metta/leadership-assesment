const { URLSearchParams } = require('url');

// Microsoft Graph (client credentials) config — Graph-only (no SMTP fallback)
const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID || process.env.AZURE_TENANT_ID || '';
const GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '';
const GRAPH_FROM = process.env.GRAPH_FROM || process.env.MAIL_FROM || ''; // user principal name or id to send as

async function sendViaGraph(to, subject, html) {
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET || !GRAPH_FROM) {
    console.error('Graph mailer not configured; missing Graph env variables. Aborting send to', to);
    return false;
  }

  try {
    // obtain token using client credentials flow
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
        body: { contentType: 'HTML', content: html },
        toRecipients: [ { emailAddress: { address: to } } ],
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

function renderAssessmentHtml(payload) {
  const totalScore = Number(payload.totalScore || 0);
  const totalWeightedScore = Number(payload.totalWeightedScore || 0);
  // const submittedAt = payload.submittedAt || new Date().toISOString();
  const submittedAt = payload.submittedAt ? payload.submittedAt.replace("T", " ").split(".")[0]
  : new Date().toISOString().replace("T", " ").split(".")[0];
  const first = String(payload?.firstName || payload?.first || '').trim();
  const last = String(payload?.lastName || payload?.last || '').trim();
  const name = [first, last].filter(Boolean).join(' ');

  let rowsHtml = '';
  const qArr = Array.isArray(payload.questionResponses) ? payload.questionResponses : [];
  if (qArr.length) {
    rowsHtml = qArr.map((item, i) => {
      const q = item.question || `Q${i + 1}`;
      const a = String(item.answer || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const s = Number(item.score || 0);
      const w = Number(item.weight || 0);
      
      return `<tr><td style="padding:6px;border:1px solid #ddd">${q}</td><td style="padding:6px;border:1px solid #ddd">${a}</td><td style="padding:6px;border:1px solid #ddd;text-align:right">${s}</td><td style="padding:6px;border:1px solid #ddd;text-align:right">${w}</td></tr>`;
    }).join('');
  }

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222">
      <h4>Hi ${name},</h4>
      <h4 style="color:#1f2937">Your Leadership Assessment Results</h4>
      <p><strong>Total score:</strong> ${totalScore}</p>
      <p><strong>Total weighted score:</strong> ${totalWeightedScore}/100</p>
      <p>Submitted: ${submittedAt}</p>
      ${rowsHtml ? `<table style="border-collapse:collapse;margin-top:10px;width:100%"><thead><tr><th style="padding:6px;border:1px solid #ddd;text-align:left">Question</th><th style="padding:6px;border:1px solid #ddd;text-align:left">Answer</th><th style="padding:6px;border:1px solid #ddd;text-align:right">Score</th><th style="padding:6px;border:1px solid #ddd;text-align:right">Weight</th></tr></thead><tbody>${rowsHtml}</tbody></table>` : ''}
    </div>
    <h4>Thanks & Regards,</h4>
    <h4>Leadership Assessment Team</h4>
  `;

}

async function sendAssessmentResultEmail(to, payload) {
  if (!to) return false;  
  const subject = `Reg:Your Leadership Assessment Results` ;
  const html = renderAssessmentHtml(payload);
  return await sendViaGraph(to, subject, html);
}

module.exports = { sendAssessmentResultEmail };
