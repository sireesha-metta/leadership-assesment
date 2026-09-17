const fs = require("fs");
const path = require("path");
const { generateAssessmentPdf } = require("./pdfGenerator");

async function testPdf() {
  console.log("=== TESTING PDF REPORT GENERATION ===");

  const samplePayload = {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane.doe@example.com",
    submittedAt: "2026-09-15T10:00:00.000Z",
    questionResponses: [
      { section: "DECISION MAKING", weightedScore: 6 },
      { section: "DECISION MAKING", weightedScore: 6 },
      { section: "DECISION MAKING", weightedScore: 4 },
      { section: "DECISION MAKING", weightedScore: 4 }, // 20 / 28 = 71%
      { section: "CONVERSATION PATTERNS", weightedScore: 6 },
      { section: "CONVERSATION PATTERNS", weightedScore: 6 },
      { section: "CONVERSATION PATTERNS", weightedScore: 6 },
      { section: "CONVERSATION PATTERNS", weightedScore: 4 }, // 22 / 28 = 79%
      { section: "LEADER SIGNALS", weightedScore: 9 },
      { section: "LEADER SIGNALS", weightedScore: 9 },
      { section: "LEADER SIGNALS", weightedScore: 4 },
      { section: "LEADER SIGNALS", weightedScore: 2 }, // 24 / 35 = 69%
    ],
  };

  try {
    const pdfBuffer = await generateAssessmentPdf(samplePayload);
    const outputPath = path.join(__dirname, "test_output_report.pdf");
    fs.writeFileSync(outputPath, pdfBuffer);
    console.log(`✅ PDF generated successfully! Saved to: ${outputPath} (${pdfBuffer.length} bytes)`);
  } catch (err) {
    console.error("❌ PDF generation failed:", err);
  }
}

testPdf();
