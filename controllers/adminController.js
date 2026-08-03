const pool = require("../config/db");
const { generateRespondentsExcel, generateSubmissionsExcel } = require("../utils/xlGenerator");
const { ensureRespondentSecuritySchema, toDecryptedRespondent } = require("../utils/dataSecurity");

exports.exportRespondents = async (req, res) => {
  try {
    await ensureRespondentSecuritySchema(pool);

    const [respondents] = await pool.query(`
    SELECT
        id,
        firstname,
        lastname,
        email,
        role,
        status,
        created_at
    FROM Respondent
    ORDER BY created_at DESC
  `);

    const decryptedRespondents = respondents.map((row) => {
      const pii = toDecryptedRespondent(row);
      return {
        ...row,
        firstname: pii.firstname,
        lastname: pii.lastname,
        email: String(pii.email || "").trim().toLowerCase(),
      };
    });

    const buffer = await generateRespondentsExcel(decryptedRespondents);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Respondents_${Date.now()}.xlsx`
    );

    return res.send(buffer);
  } catch (error) {
    console.error("Export Respondents Error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to export respondents.",
    });
  }
};

exports.exportSubmissions = async (req, res) => {
  try {
    const [assessment_submissions] = await pool.query(`
      SELECT
        id,
        respondent_id,
        respondent_name,
        email,
        assessment_type,
        submitted_at,
        total_score,
        total_weighted_score,
        submission_payload,
        created_at
      FROM assessment_submissions
      ORDER BY submitted_at DESC
    `);

    const buffer = await generateSubmissionsExcel(assessment_submissions);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Submissions_${Date.now()}.xlsx`
    );

    res.send(buffer);

  } catch (err) {
    console.error("Export Submissions Error:", err);
    res.status(500).json({
      success: false,
      message: "Unable to export submissions."
    });
  }
};