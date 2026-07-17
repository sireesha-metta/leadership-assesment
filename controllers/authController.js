const jwt = require("jsonwebtoken");
const db = require("../config/db");

function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "admin") return "ADMIN";
  if (normalized === "respondent") return "RESPONDENT";
  return String(role || "").trim().toUpperCase();
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeMobileDigits(mobile) {
  const digits = String(mobile || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase() === "inactive" ? "Inactive" : "Active";
}

async function ensureAssessmentSubmissionTable() {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS assessment_submissions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      respondent_id BIGINT UNSIGNED NULL,
      assessment_type VARCHAR(80) NOT NULL,
      respondent_name VARCHAR(255) NULL,
      email VARCHAR(255) NULL,
      submitted_at DATETIME NULL,
      total_score DECIMAL(12, 2) NOT NULL DEFAULT 0,
      total_weighted_score DECIMAL(12, 2) NOT NULL DEFAULT 0,
      submission_payload LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_submission_once (respondent_id, assessment_type),
      KEY idx_submission_email (email),
      KEY idx_submission_created_at (created_at)
    )`
  );

  const [emailColumns] = await db.execute(`SHOW COLUMNS FROM assessment_submissions LIKE 'email'`);
  if (emailColumns.length === 0) {
    await db.execute(`ALTER TABLE assessment_submissions ADD COLUMN email VARCHAR(255) NULL`);
  }

  const [mobileColumns] = await db.execute(`SHOW COLUMNS FROM assessment_submissions LIKE 'mobile'`);
  if (mobileColumns.length > 0) {
    await db.execute(`ALTER TABLE assessment_submissions DROP COLUMN mobile`);
  }

  const [respondentIdColumns] = await db.execute(`SHOW COLUMNS FROM assessment_submissions LIKE 'respondent_id'`);
  if (respondentIdColumns.length > 0 && respondentIdColumns[0].Null === 'NO') {
    await db.execute(`ALTER TABLE assessment_submissions MODIFY respondent_id BIGINT UNSIGNED NULL`);
  }
}

async function hasAssessmentSubmissionForIdentity({ respondentId, email }) {
  const normalizedRespondentId = Number(respondentId);

  if (Number.isFinite(normalizedRespondentId) && normalizedRespondentId > 0) {
    await ensureAssessmentSubmissionTable();

    const [submissionRows] = await db.execute(
      `SELECT 1 FROM assessment_submissions WHERE respondent_id = ? AND assessment_type = ? LIMIT 1`,
      [normalizedRespondentId, "leadership_reset"]
    );

    if (submissionRows.length > 0) {
      return true;
    }
  }

  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return false;
  }

  await ensureAssessmentSubmissionTable();

  const [rows] = await db.execute(
    `SELECT 1 FROM assessment_submissions WHERE assessment_type = ? AND LOWER(TRIM(email)) = ? LIMIT 1`,
    ["leadership_reset", normalizedEmail]
  );

  return rows.length > 0;
}

function buildAssessmentTempPassword() {
  return `TmpA${Date.now()}z9`;
}

async function listUsersByRole(role) {
  const [rows] = await db.execute(
    `SELECT id, firstname, lastname, mobile, email, status, created_at, updated_at
     FROM Respondent
     WHERE role = ?
     ORDER BY id DESC`,
    [role]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    firstName: row.firstname || "",
    lastName: row.lastname || "",
    mobile: row.mobile || "",
    email: row.email || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: normalizeStatus(row.status),
  }));
}

async function updateUserByRoleAndId(role, id, payload) {
  const fields = [];
  const values = [];

  if (payload.firstName !== undefined) {
    fields.push("firstname = ?");
    values.push(String(payload.firstName || "").trim());
  }

  if (payload.lastName !== undefined) {
    fields.push("lastname = ?");
    values.push(String(payload.lastName || "").trim());
  }

  if (payload.mobile !== undefined) {
    fields.push("mobile = ?");
    values.push(normalizeMobileDigits(payload.mobile));
  }

  if (payload.email !== undefined) {
    fields.push("email = ?");
    values.push(normalizeEmail(payload.email));
  }

  if (payload.status !== undefined) {
    fields.push("status = ?");
    values.push(normalizeStatus(payload.status));
  }

  if (fields.length === 0) {
    return { success: false, reason: "NO_FIELDS" };
  }

  values.push(Number(id), role);

  const [result] = await db.execute(
    `UPDATE Respondent
     SET ${fields.join(", ")}
     WHERE id = ? AND role = ?`,
    values
  );

  return { success: Number(result?.affectedRows || 0) > 0 };
}

async function deleteUserByRoleAndId(role, id) {
  const [result] = await db.execute(
    "DELETE FROM Respondent WHERE id = ? AND role = ?",
    [Number(id), role]
  );

  return Number(result?.affectedRows || 0) > 0;
}

exports.login = async (req, res) => {
  try {
    const { email, password, identifier, loginId, mobile } = req.body || {};
    const rawIdentifier = String(identifier || loginId || email || mobile || "").trim();
    const normalizedEmail = rawIdentifier.toLowerCase();
    const numericIdentifier = rawIdentifier.replace(/\D/g, "");
    const phone10 = numericIdentifier.length >= 10 ? numericIdentifier.slice(-10) : numericIdentifier;

    if (!rawIdentifier || !password) {
      return res.status(400).json({ success: false, message: "Email/mobile and password are required" });
    }

    const normalizedMobile = phone10 || rawIdentifier;
    const [rows] = await db.execute(
      `SELECT *
       FROM Respondent
       WHERE status = 'Active'
         AND (
           LOWER(TRIM(email)) = ?
           OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(CAST(mobile AS CHAR)), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', '') = ?
           OR RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(CAST(mobile AS CHAR)), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10) = ?
         )`,
      [normalizedEmail, normalizedMobile, normalizedMobile]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const passwordText = String(password).trim();
    const matchedUser = rows.find(
      (row) => String(row.password || "").trim() === passwordText
    );

    if (!matchedUser) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

  const user = matchedUser;
  const normalizedRole = normalizeRole(user.role);
  const token = signToken({ id: user.id, role: normalizedRole, email: user.email });
    const decoded = jwt.decode(token);
    const expiresAt = decoded?.exp ? decoded.exp * 1000 : null;

    return res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          role: normalizedRole,
          mobile: user.mobile || "",
        },
        expiresAt,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.register = async (req, res) => {
  try {
    const { firstName, lastName, mobile, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const [existing] = await db.execute(
      "SELECT id FROM Respondent WHERE email = ?",
      [String(email).trim().toLowerCase()]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }

    const [result] = await db.execute(
      "INSERT INTO Respondent (firstname, lastname, mobile, email, password, role, status) VALUES (?, ?, ?, ?, ?, 'RESPONDENT', 'Active')",
      [firstName, lastName, mobile || "", String(email).trim().toLowerCase(), password]
    );

    return res.status(201).json({ success: true, message: "Registration successful", id: result.insertId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.upsertAssessmentRespondent = async (req, res) => {
  try {
    const { firstName, lastName, mobile, email } = req.body || {};

    const normalizedFirstName = String(firstName || "").trim();
    const normalizedLastName = String(lastName || "").trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedMobile = normalizeMobileDigits(mobile);

    if (!normalizedFirstName || !normalizedLastName || !normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "First name, last name and email are required.",
      });
    }

    if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }

    if (normalizedMobile && !/^[6-9]\d{9}$/.test(normalizedMobile)) {
      return res.status(400).json({ success: false, message: "Enter a valid 10-digit mobile number." });
    }

    const [existingByEmail] = await db.execute(
      "SELECT id, role, firstname, lastname, mobile, status FROM Respondent WHERE LOWER(TRIM(email)) = ? LIMIT 1",
      [normalizedEmail]
    );

    const alreadyCompleted = await hasAssessmentSubmissionForIdentity({
      respondentId: existingByEmail?.[0]?.id || null,
      email: normalizedEmail,
    });

    if (alreadyCompleted) {
      return res.status(409).json({
        success: false,
        alreadySubmitted: true,
        message: "Assessment already submitted. Assignment already done.",
      });
    }

    if (existingByEmail.length > 0) {
      const existing = existingByEmail[0];

      const existingFirstName = String(existing.firstname || "").trim();
      const existingLastName = String(existing.lastname || "").trim();
      const existingMobile = normalizeMobileDigits(existing.mobile);
      const existingStatus = normalizeStatus(existing.status);

      const isSameRecord =
        existingFirstName === normalizedFirstName &&
        existingLastName === normalizedLastName &&
        existingMobile === normalizedMobile &&
        existingStatus === "Active";

      if (isSameRecord) {
        return res.json({
          success: true,
          message: "Respondent already up to date.",
          data: {
            id: Number(existing.id),
            firstname: existingFirstName,
            lastname: existingLastName,
            email: normalizedEmail,
            mobile: existingMobile,
            role: normalizeRole(existing.role),
          },
        });
      }

      await db.execute(
        `UPDATE Respondent
         SET firstname = ?, lastname = ?, mobile = ?, status = 'Active'
         WHERE id = ?`,
        [normalizedFirstName, normalizedLastName, normalizedMobile, Number(existing.id)]
      );

      return res.json({
        success: true,
        message: "Respondent details saved.",
        data: {
          id: Number(existing.id),
          firstname: normalizedFirstName,
          lastname: normalizedLastName,
          email: normalizedEmail,
          mobile: normalizedMobile,
          role: normalizeRole(existing.role),
        },
      });
    }

    const generatedPassword = buildAssessmentTempPassword();

    const [insertResult] = await db.execute(
      "INSERT INTO Respondent (firstname, lastname, mobile, email, password, role, status) VALUES (?, ?, ?, ?, ?, 'RESPONDENT', 'Active')",
      [normalizedFirstName, normalizedLastName, normalizedMobile, normalizedEmail, generatedPassword]
    );

    return res.status(201).json({
      success: true,
      message: "Respondent created and saved.",
      data: {
        id: insertResult.insertId,
        firstname: normalizedFirstName,
        lastname: normalizedLastName,
        email: normalizedEmail,
        mobile: normalizedMobile,
        role: "RESPONDENT",
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createRespondent = async (req, res) => {
  try {
    const { firstName, lastName, mobile, email, password } = req.body || {};

    const normalizedFirstName = String(firstName || "").trim();
    const normalizedLastName = String(lastName || "").trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedMobile = normalizeMobileDigits(mobile);
    const normalizedPassword = String(password || "");

    if (!normalizedFirstName || !normalizedLastName || !normalizedEmail || !normalizedPassword) {
      return res.status(400).json({ success: false, message: "First name, last name, email and password are required." });
    }

    if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }

    if (normalizedPassword.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(normalizedPassword)) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 chars and include uppercase, lowercase and number." });
    }

    if (normalizedMobile && !/^[6-9]\d{9}$/.test(normalizedMobile)) {
      return res.status(400).json({ success: false, message: "Enter a valid 10-digit mobile number." });
    }

    const [existingByEmail] = await db.execute(
      "SELECT id FROM Respondent WHERE LOWER(TRIM(email)) = ? LIMIT 1",
      [normalizedEmail]
    );

    if (existingByEmail.length > 0) {
      return res.status(400).json({ success: false, message: "Email already exists." });
    }

    if (normalizedMobile) {
      const [existingByMobile] = await db.execute(
        `SELECT id
         FROM Respondent
         WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(CAST(mobile AS CHAR)), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10) = ?
         LIMIT 1`,
        [normalizedMobile]
      );

      if (existingByMobile.length > 0) {
        return res.status(400).json({ success: false, message: "Mobile number already exists." });
      }
    }

    const [result] = await db.execute(
      "INSERT INTO Respondent (firstname, lastname, mobile, email, password, role, status) VALUES (?, ?, ?, ?, ?, 'RESPONDENT', 'Active')",
      [normalizedFirstName, normalizedLastName, normalizedMobile, normalizedEmail, normalizedPassword]
    );

    return res.status(201).json({
      success: true,
      message: "Respondent created successfully.",
      data: {
        id: result.insertId,
        firstname: normalizedFirstName,
        lastname: normalizedLastName,
        email: normalizedEmail,
        mobile: normalizedMobile,
        role: "RESPONDENT",
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.me = async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, firstname, lastname, email, role, mobile FROM Respondent WHERE id = ?",
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = rows[0];
    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          role: normalizeRole(user.role),
          mobile: user.mobile || "",
        },
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.logout = async (_req, res) => {
  return res.json({ success: true });
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required." });
    }

    const [rows] = await db.execute(
      "SELECT id, password FROM Respondent WHERE id = ?",
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (String(currentPassword) !== String(rows[0].password)) {
      return res.status(403).json({ success: false, message: "Current password is incorrect." });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters." });
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(String(newPassword))) {
      return res.status(400).json({ success: false, message: "Password must contain uppercase, lowercase and number." });
    }

    await db.execute("UPDATE Respondent SET password = ? WHERE id = ?", [String(newPassword), req.user.id]);
    return res.json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPassword = String(newPassword || "");

    if (!normalizedEmail || !normalizedPassword) {
      return res.status(400).json({ success: false, message: "Email and new password are required." });
    }

    const [rows] = await db.execute(
      "SELECT id FROM Respondent WHERE email = ? AND status = 'Active'",
      [normalizedEmail]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found for this email." });
    }

    await db.execute(
      "UPDATE Respondent SET password = ? WHERE id = ?",
      [normalizedPassword, rows[0].id]
    );

    return res.json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, mobile } = req.body || {};

    if (!String(firstName || "").trim() || !String(lastName || "").trim()) {
      return res.status(400).json({ success: false, message: "First name and last name are required." });
    }

    await db.execute(
      "UPDATE Respondent SET firstname = ?, lastname = ?, mobile = ? WHERE id = ?",
      [
        String(firstName).trim(),
        String(lastName).trim(),
        String(mobile || "").trim(),
        req.user.id,
      ]
    );

    const [rows] = await db.execute(
      "SELECT id, firstname, lastname, email, role, mobile FROM Respondent WHERE id = ?",
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = rows[0];
    return res.json({
      success: true,
      message: "Profile updated successfully.",
      data: {
        user: {
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          role: normalizeRole(user.role),
          mobile: user.mobile || "",
        },
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createAdmin = async (req, res) => {
  try {
    const { firstName, lastName, mobile, email, password } = req.body || {};

    const normalizedFirstName = String(firstName || "").trim();
    const normalizedLastName = String(lastName || "").trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedMobile = normalizeMobileDigits(mobile);
    const normalizedPassword = String(password || "");

    if (!normalizedFirstName || !normalizedLastName || !normalizedEmail || !normalizedPassword) {
      return res.status(400).json({ success: false, message: "First name, last name, email and password are required." });
    }

    if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }

    if (normalizedPassword.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(normalizedPassword)) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 chars and include uppercase, lowercase and number." });
    }

    if (normalizedMobile && !/^[6-9]\d{9}$/.test(normalizedMobile)) {
      return res.status(400).json({ success: false, message: "Enter a valid 10-digit mobile number." });
    }

    const [existingByEmail] = await db.execute(
      "SELECT id FROM Respondent WHERE LOWER(TRIM(email)) = ? LIMIT 1",
      [normalizedEmail]
    );

    if (existingByEmail.length > 0) {
      return res.status(400).json({ success: false, message: "Email already exists." });
    }

    if (normalizedMobile) {
      const [existingByMobile] = await db.execute(
        `SELECT id
         FROM Respondent
         WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(CAST(mobile AS CHAR)), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10) = ?
         LIMIT 1`,
        [normalizedMobile]
      );

      if (existingByMobile.length > 0) {
        return res.status(400).json({ success: false, message: "Mobile number already exists." });
      }
    }

    const [result] = await db.execute(
      "INSERT INTO Respondent (firstname, lastname, mobile, email, password, role, status) VALUES (?, ?, ?, ?, ?, 'ADMIN', 'Active')",
      [normalizedFirstName, normalizedLastName, normalizedMobile, normalizedEmail, normalizedPassword]
    );

    return res.status(201).json({
      success: true,
      message: "Admin user created successfully.",
      data: {
        id: result.insertId,
        firstname: normalizedFirstName,
        lastname: normalizedLastName,
        email: normalizedEmail,
        mobile: normalizedMobile,
        role: "ADMIN",
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getAdmins = async (_req, res) => {
  try {
    const admins = await listUsersByRole("ADMIN");
    return res.json({
      success: true,
      data: admins,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const result = await updateUserByRoleAndId("ADMIN", id, payload);

    if (!result.success && result.reason === "NO_FIELDS") {
      return res.status(400).json({ success: false, message: "No fields provided to update." });
    }

    if (!result.success) {
      return res.status(404).json({ success: false, message: "Admin not found." });
    }

    return res.json({ success: true, message: "Admin updated successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await deleteUserByRoleAndId("ADMIN", id);

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Admin not found." });
    }

    return res.json({ success: true, message: "Admin deleted successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getRespondents = async (_req, res) => {
  try {
    const respondents = await listUsersByRole("RESPONDENT");
    return res.json({
      success: true,
      data: respondents,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateRespondent = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const result = await updateUserByRoleAndId("RESPONDENT", id, payload);

    if (!result.success && result.reason === "NO_FIELDS") {
      return res.status(400).json({ success: false, message: "No fields provided to update." });
    }

    if (!result.success) {
      return res.status(404).json({ success: false, message: "Respondent not found." });
    }

    return res.json({ success: true, message: "Respondent updated successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteRespondent = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await deleteUserByRoleAndId("RESPONDENT", id);

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Respondent not found." });
    }

    return res.json({ success: true, message: "Respondent deleted successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getAllDrafts = async (req, res) => {
  
  try {
    const [rows] = await db.query(`
      SELECT
          d.id,
          d.respondent_id,
          CONCAT(r.firstname, ' ', r.lastname) AS respondent_name,
          r.mobile,
          r.email,
          d.answered_count,
          d.assessment_type,
          d.created_at,
          d.updated_at
      FROM assessment_drafts d
      INNER JOIN respondent r
          ON d.respondent_id = r.id
      ORDER BY d.updated_at DESC
    `);

    res.json({
      success: true,
      drafts: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
       message: err.message,
      code: err.code,
    });
  }
};

