const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { sendAssessmentResultEmail, sendAdminNotificationEmail } = require("./mailer");

async function testBothEmails() {
  console.log("=== TESTING BOTH RESPONDENT & ADMIN EMAILS ===");

  const samplePayload = {
    firstName: "Jane",
    lastName: "Doe",
    respondent: "Jane Doe",
    email: "test.respondent@example.com",
    mobile: "+1 555-0199",
    submittedAt: "2026-09-15T10:00:00.000Z",
    oneWordAnswers: ["Focused", "Collaborative", "Agile"],
    questionResponses: [
      { section: "DECISION MAKING", weightedScore: 6 },
      { section: "DECISION MAKING", weightedScore: 6 },
      { section: "DECISION MAKING", weightedScore: 4 },
      { section: "DECISION MAKING", weightedScore: 4 }, // 20/28
      { section: "CONVERSATION PATTERNS", weightedScore: 6 },
      { section: "CONVERSATION PATTERNS", weightedScore: 6 },
      { section: "CONVERSATION PATTERNS", weightedScore: 6 },
      { section: "CONVERSATION PATTERNS", weightedScore: 4 }, // 22/28
      { section: "LEADER SIGNALS", weightedScore: 9 },
      { section: "LEADER SIGNALS", weightedScore: 9 },
      { section: "LEADER SIGNALS", weightedScore: 4 },
      { section: "LEADER SIGNALS", weightedScore: 2 }, // 24/35
    ],
  };

  const adminEmail = process.env.ADMIN_EMAIL || "sireeshametta@gmail.com";

  console.log("1. Sending Respondent Email to:", adminEmail);
  const resUser = await sendAssessmentResultEmail(adminEmail, samplePayload);
  console.log("   Result:", resUser);

  console.log("\n2. Sending Admin Notification Email to:", adminEmail);
  const resAdmin = await sendAdminNotificationEmail(samplePayload);
  console.log("   Result:", resAdmin);
}

testBothEmails();
