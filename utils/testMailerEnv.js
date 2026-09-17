const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { sendAssessmentResultEmail } = require("./mailer");

async function testMailerWithEnv() {
  console.log("=== TESTING MAILER WITH GRAPH API ENV ===");
  console.log("GRAPH_FROM:", process.env.GRAPH_FROM);
  console.log("GRAPH_TENANT_ID:", process.env.GRAPH_TENANT_ID);

  const samplePayload = {
    firstName: "Jane",
    lastName: "Doe",
    email: "sireeshametta@gmail.com",
    submittedAt: "2026-09-15T10:00:00.000Z",
    questionResponses: [
      { section: "DECISION MAKING", weightedScore: 6 },
      { section: "DECISION MAKING", weightedScore: 6 },
      { section: "DECISION MAKING", weightedScore: 4 },
      { section: "DECISION MAKING", weightedScore: 4 },
      { section: "CONVERSATION PATTERNS", weightedScore: 6 },
      { section: "CONVERSATION PATTERNS", weightedScore: 6 },
      { section: "CONVERSATION PATTERNS", weightedScore: 6 },
      { section: "CONVERSATION PATTERNS", weightedScore: 4 },
      { section: "LEADER SIGNALS", weightedScore: 9 },
      { section: "LEADER SIGNALS", weightedScore: 9 },
      { section: "LEADER SIGNALS", weightedScore: 4 },
      { section: "LEADER SIGNALS", weightedScore: 2 },
    ],
  };

  try {
    const res = await sendAssessmentResultEmail(process.env.ADMIN_EMAIL || "sireeshametta@gmail.com", samplePayload);
    console.log("\n>>> Graph API sendAssessmentResultEmail Result:", res);
  } catch (err) {
    console.error("\n>>> Mailer Exception:", err);
  }
}

testMailerWithEnv();
