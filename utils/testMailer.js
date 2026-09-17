const { sendAssessmentResultEmail } = require("./mailer");

async function testMailer() {
  console.log("=== TESTING MAILER LOGIC ===");

  const samplePayload = {
    firstName: "Jane",
    lastName: "Doe",
    email: "test.participant@example.com",
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
    const res = await sendAssessmentResultEmail("test.participant@example.com", samplePayload);
    console.log("Mailer test completed. Returned:", res);
  } catch (err) {
    console.error("Mailer test error:", err);
  }
}

testMailer();
