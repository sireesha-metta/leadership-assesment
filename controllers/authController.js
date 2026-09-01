const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const {
  ensureRespondentSecuritySchema,
  protectRespondentFields,
  toDecryptedRespondent,
  hashIdentifier,
  hashMobileIdentifier,
  isBcryptHash,
} = require("../utils/dataSecurity");

let respondentSecurityReadyPromise = null;

async function ensureRespondentSecurityReady() {
  if (!respondentSecurityReadyPromise) {
    respondentSecurityReadyPromise = ensureRespondentSecuritySchema(db).catch((error) => {
      respondentSecurityReadyPromise = null;
      throw error;
    });
  }

  return respondentSecurityReadyPromise;
}

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
  await ensureAssessmentSubmissionTable();

  const normalizedEmail = normalizeEmail(email);
  const normalizedRespondentId = Number(respondentId);

  // 1. Check assessment_submissions table by respondent_id
  if (Number.isFinite(normalizedRespondentId) && normalizedRespondentId > 0) {
    const [rows] = await db.execute(
      `SELECT id, submitted_at, created_at FROM assessment_submissions WHERE respondent_id = ? AND assessment_type = ? ORDER BY id DESC LIMIT 1`,
      [normalizedRespondentId, "leadership_reset"]
    );
    if (rows.length > 0) {
      return {
        submitted_at: rows[0].submitted_at || rows[0].created_at,
        created_at: rows[0].created_at,
      };
    }
  }

  // 2. Check assessment_submissions table by email
  if (normalizedEmail) {
    const [rows] = await db.execute(
      `SELECT id, submitted_at, created_at FROM assessment_submissions WHERE assessment_type = ? AND LOWER(TRIM(email)) = ? ORDER BY id DESC LIMIT 1`,
      ["leadership_reset", normalizedEmail]
    );
    if (rows.length > 0) {
      return {
        submitted_at: rows[0].submitted_at || rows[0].created_at,
        created_at: rows[0].created_at,
      };
    }
  }

  // 3. Fallback: Check assessment_drafts table by email
  if (normalizedEmail) {
    try {
      const [draftRows] = await db.execute(
        `SELECT id, saved_at, updated_at, created_at FROM assessment_drafts WHERE LOWER(TRIM(email)) = ? ORDER BY id DESC LIMIT 1`,
        [normalizedEmail]
      );
      if (draftRows.length > 0) {
        return {
          submitted_at: draftRows[0].saved_at || draftRows[0].updated_at || draftRows[0].created_at,
          created_at: draftRows[0].created_at,
        };
      }
    } catch (e) {
      // ignore
    }
  }

  // 4. Fallback: Check Respondent table by email
  if (normalizedEmail) {
    try {
      const existingByEmail = await findRespondentByEmail(normalizedEmail);
      if (existingByEmail) {
        return {
          submitted_at: existingByEmail.created_at || existingByEmail.updated_at || new Date().toISOString(),
          created_at: existingByEmail.created_at,
        };
      }
    } catch (e) {
      // ignore
    }
  }

  return null;
}

function buildAssessmentTempPassword() {
  return `TmpA${Date.now()}z9`;
}

function mapRespondentForApi(row) {
  const decrypted = toDecryptedRespondent(row || {});
  return {
    id: Number(decrypted.id),
    firstName: String(decrypted.firstname || "").trim(),
    lastName: String(decrypted.lastname || "").trim(),
    mobile: String(decrypted.mobile || "").trim(),
    email: String(decrypted.email || "").trim().toLowerCase(),
    createdAt: decrypted.created_at,
    updatedAt: decrypted.updated_at,
    status: normalizeStatus(decrypted.status),
    role: normalizeRole(decrypted.role),
  };
}

async function findRespondentByEmail(email) {
  const emailHash = hashIdentifier(normalizeEmail(email));
  if (!emailHash) return null;

  const [rows] = await db.execute(
    `SELECT * FROM Respondent WHERE email_hash = ? LIMIT 1`,
    [emailHash]
  );

  return rows.length > 0 ? rows[0] : null;
}

async function findRespondentByMobile(mobile) {
  const mobileHash = hashMobileIdentifier(normalizeMobileDigits(mobile));
  if (!mobileHash) return null;

  const [rows] = await db.execute(
    `SELECT * FROM Respondent WHERE mobile_hash = ? LIMIT 1`,
    [mobileHash]
  );

  return rows.length > 0 ? rows[0] : null;
}

async function listUsersByRole(role) {
  await ensureRespondentSecurityReady();

  const [rows] = await db.execute(
    `SELECT id, firstname, lastname, mobile, email, status, created_at, updated_at
     FROM Respondent
     WHERE role = ?
     ORDER BY id DESC`,
    [role]
  );

  return rows.map((row) => {
    const mapped = mapRespondentForApi({ ...row, role });
    return {
      id: mapped.id,
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      mobile: mapped.mobile,
      email: mapped.email,
      createdAt: mapped.createdAt,
      updatedAt: mapped.updatedAt,
      status: mapped.status,
    };
  });
}

async function updateUserByRoleAndId(role, id, payload) {
  await ensureRespondentSecurityReady();

  const fields = [];
  const values = [];

  if (payload.firstName !== undefined) {
    fields.push("firstname = ?");
    values.push(protectRespondentFields({ firstName: payload.firstName }).firstname);
  }

  if (payload.lastName !== undefined) {
    fields.push("lastname = ?");
    values.push(protectRespondentFields({ lastName: payload.lastName }).lastname);
  }

  if (payload.mobile !== undefined) {
    const normalizedMobile = normalizeMobileDigits(payload.mobile);
    if (normalizedMobile) {
      const existingByMobile = await findRespondentByMobile(normalizedMobile);
      if (existingByMobile && Number(existingByMobile.id) !== Number(id)) {
        return { success: false, reason: "DUPLICATE_MOBILE" };
      }
    }

    const protectedFields = protectRespondentFields({ mobile: normalizedMobile });
    fields.push("mobile = ?");
    values.push(protectedFields.mobile);
    fields.push("mobile_hash = ?");
    values.push(protectedFields.mobile_hash);
  }

  if (payload.email !== undefined) {
    const normalizedEmail = normalizeEmail(payload.email);
    const existingByEmail = await findRespondentByEmail(normalizedEmail);
    if (existingByEmail && Number(existingByEmail.id) !== Number(id)) {
      return { success: false, reason: "DUPLICATE_EMAIL" };
    }

    const protectedFields = protectRespondentFields({ email: normalizedEmail });
    fields.push("email = ?");
    values.push(protectedFields.email);
    fields.push("email_hash = ?");
    values.push(protectedFields.email_hash);
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

async function createProtectedRespondent({ firstName, lastName, mobile, email, password, role }) {
  await ensureRespondentSecurityReady();

  const normalizedFirstName = String(firstName || "").trim();
  const normalizedLastName = String(lastName || "").trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedMobile = normalizeMobileDigits(mobile);

  const existingByEmail = await findRespondentByEmail(normalizedEmail);
  if (existingByEmail) {
    return { success: false, reason: "DUPLICATE_EMAIL" };
  }

  if (normalizedMobile) {
    const existingByMobile = await findRespondentByMobile(normalizedMobile);
    if (existingByMobile) {
      return { success: false, reason: "DUPLICATE_MOBILE" };
    }
  }

  const protectedFields = protectRespondentFields({
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    email: normalizedEmail,
    mobile: normalizedMobile,
  });
  const passwordHash = await bcrypt.hash(String(password || ""), 12);

  const [result] = await db.execute(
    `INSERT INTO Respondent
      (firstname, lastname, mobile, email, email_hash, mobile_hash, password, role, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
    [
      protectedFields.firstname,
      protectedFields.lastname,
      protectedFields.mobile,
      protectedFields.email,
      protectedFields.email_hash,
      protectedFields.mobile_hash,
      passwordHash,
      role,
    ]
  );

  return {
    success: true,
    id: result.insertId,
    user: {
      firstname: normalizedFirstName,
      lastname: normalizedLastName,
      email: normalizedEmail,
      mobile: normalizedMobile,
      role,
    },
  };
}

async function compareAndUpgradePassword(userId, storedPassword, candidatePassword) {
  const stored = String(storedPassword || "");
  const input = String(candidatePassword || "");

  if (isBcryptHash(stored)) {
    return bcrypt.compare(input, stored);
  }

  const matched = stored === input;
  if (matched) {
    const upgradedHash = await bcrypt.hash(input, 12);
    await db.execute("UPDATE Respondent SET password = ? WHERE id = ?", [upgradedHash, Number(userId)]);
  }

  return matched;
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
    await ensureRespondentSecurityReady();

    const { email, password, identifier, loginId, mobile } = req.body || {};
    const rawIdentifier = String(identifier || loginId || email || mobile || "").trim();
    const numericIdentifier = rawIdentifier.replace(/\D/g, "");
    const phone10 = numericIdentifier.length >= 10 ? numericIdentifier.slice(-10) : numericIdentifier;
    const emailHash = hashIdentifier(normalizeEmail(rawIdentifier));
    const mobileHash = hashMobileIdentifier(phone10 || rawIdentifier);

    if (!rawIdentifier || !password) {
      return res.status(400).json({ success: false, message: "Email/mobile and password are required" });
    }

    const [rows] = await db.execute(
      `SELECT *
       FROM Respondent
       WHERE status = 'Active'
         AND (
           (? IS NOT NULL AND email_hash = ?)
           OR (? IS NOT NULL AND mobile_hash = ?)
         )`,
      [emailHash, emailHash, mobileHash, mobileHash]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    let matchedUser = null;
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      const matched = await compareAndUpgradePassword(row.id, row.password, password);
      if (matched) {
        matchedUser = row;
        break;
      }
    }

    if (!matchedUser) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const user = toDecryptedRespondent(matchedUser);
    const normalizedRole = normalizeRole(user.role);
    const token = signToken({ id: user.id, role: normalizedRole, email: normalizeEmail(user.email) });
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
          email: normalizeEmail(user.email),
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
    await ensureRespondentSecurityReady();

    const { firstName, lastName, mobile, email, password } = req.body;
    const normalizedFirstName = String(firstName || "").trim();
    const normalizedLastName = String(lastName || "").trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedMobile = normalizeMobileDigits(mobile);
    const normalizedPassword = String(password || "");

    if (!normalizedFirstName || !normalizedLastName || !normalizedEmail || !normalizedPassword) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    if (normalizedPassword.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(normalizedPassword)) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 chars and include uppercase, lowercase and number." });
    }

    if (normalizedMobile && !/^[6-9]\d{9}$/.test(normalizedMobile)) {
      return res.status(400).json({ success: false, message: "Enter a valid 10-digit mobile number." });
    }

    const created = await createProtectedRespondent({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      mobile: normalizedMobile,
      email: normalizedEmail,
      password: normalizedPassword,
      role: "RESPONDENT",
    });

    if (!created.success && created.reason === "DUPLICATE_EMAIL") {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }

    if (!created.success && created.reason === "DUPLICATE_MOBILE") {
      return res.status(400).json({ success: false, message: "Mobile number already exists." });
    }

    if (!created.success) {
      return res.status(500).json({ success: false, message: "Unable to register user." });
    }

    return res.status(201).json({ success: true, message: "Registration successful", id: created.id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.upsertAssessmentRespondent = async (req, res) => {
  try {
    await ensureRespondentSecurityReady();

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

    const existingByEmail = await findRespondentByEmail(normalizedEmail);
    const existingRespondentId = existingByEmail ? Number(existingByEmail.id) : null;

    const alreadyCompleted = await hasAssessmentSubmissionForIdentity({
      respondentId: existingRespondentId,
      email: normalizedEmail,
    });

    if (alreadyCompleted) {
      const submittedAt = alreadyCompleted.submitted_at || alreadyCompleted.created_at || new Date().toISOString();
      return res.status(409).json({
        success: false,
        alreadySubmitted: true,
        message: "Assessment already submitted. Assignment already done.",
        data: {
          submittedAt,
        },
      });
    }

    if (existingByEmail) {
      const existing = toDecryptedRespondent(existingByEmail);

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
         SET firstname = ?, lastname = ?, mobile = ?, mobile_hash = ?, status = 'Active'
         WHERE id = ?`,
        [
          protectRespondentFields({ firstName: normalizedFirstName }).firstname,
          protectRespondentFields({ lastName: normalizedLastName }).lastname,
          protectRespondentFields({ mobile: normalizedMobile }).mobile,
          protectRespondentFields({ mobile: normalizedMobile }).mobile_hash,
          Number(existing.id),
        ]
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
    const passwordHash = await bcrypt.hash(generatedPassword, 12);
    const protectedFields = protectRespondentFields({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      mobile: normalizedMobile,
      email: normalizedEmail,
    });

    const [insertResult] = await db.execute(
      "INSERT INTO Respondent (firstname, lastname, mobile, email, email_hash, mobile_hash, password, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'RESPONDENT', 'Active')",
      [
        protectedFields.firstname,
        protectedFields.lastname,
        protectedFields.mobile,
        protectedFields.email,
        protectedFields.email_hash,
        protectedFields.mobile_hash,
        passwordHash,
      ]
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
    await ensureRespondentSecurityReady();

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

    const created = await createProtectedRespondent({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      mobile: normalizedMobile,
      email: normalizedEmail,
      password: normalizedPassword,
      role: "RESPONDENT",
    });

    if (!created.success && created.reason === "DUPLICATE_EMAIL") {
      return res.status(400).json({ success: false, message: "Email already exists." });
    }

    if (!created.success && created.reason === "DUPLICATE_MOBILE") {
      return res.status(400).json({ success: false, message: "Mobile number already exists." });
    }

    if (!created.success) {
      return res.status(500).json({ success: false, message: "Unable to create respondent." });
    }

    return res.status(201).json({
      success: true,
      message: "Respondent created successfully.",
      data: {
        id: created.id,
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
    await ensureRespondentSecurityReady();

    const [rows] = await db.execute(
      "SELECT id, firstname, lastname, email, role, mobile FROM Respondent WHERE id = ?",
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = toDecryptedRespondent(rows[0]);
    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname,
          email: normalizeEmail(user.email),
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
    await ensureRespondentSecurityReady();

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

    const isCurrentPasswordValid = await compareAndUpgradePassword(
      rows[0].id,
      rows[0].password,
      currentPassword
    );

    if (!isCurrentPasswordValid) {
      return res.status(403).json({ success: false, message: "Current password is incorrect." });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters." });
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(String(newPassword))) {
      return res.status(400).json({ success: false, message: "Password must contain uppercase, lowercase and number." });
    }

    const newPasswordHash = await bcrypt.hash(String(newPassword), 12);
    await db.execute("UPDATE Respondent SET password = ? WHERE id = ?", [newPasswordHash, req.user.id]);
    return res.json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    await ensureRespondentSecurityReady();

    const { email, newPassword } = req.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPassword = String(newPassword || "");
    const emailHash = hashIdentifier(normalizedEmail);

    if (!normalizedEmail || !normalizedPassword) {
      return res.status(400).json({ success: false, message: "Email and new password are required." });
    }

    const [rows] = await db.execute(
      "SELECT id FROM Respondent WHERE email_hash = ? AND status = 'Active'",
      [emailHash]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found for this email." });
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, 12);
    await db.execute(
      "UPDATE Respondent SET password = ? WHERE id = ?",
      [passwordHash, rows[0].id]
    );

    return res.json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    await ensureRespondentSecurityReady();

    const { firstName, lastName, mobile } = req.body || {};
    const normalizedFirstName = String(firstName || "").trim();
    const normalizedLastName = String(lastName || "").trim();
    const normalizedMobile = normalizeMobileDigits(mobile);

    if (!normalizedFirstName || !normalizedLastName) {
      return res.status(400).json({ success: false, message: "First name and last name are required." });
    }

    if (normalizedMobile && !/^[6-9]\d{9}$/.test(normalizedMobile)) {
      return res.status(400).json({ success: false, message: "Enter a valid 10-digit mobile number." });
    }

    if (normalizedMobile) {
      const existingByMobile = await findRespondentByMobile(normalizedMobile);
      if (existingByMobile && Number(existingByMobile.id) !== Number(req.user.id)) {
        return res.status(400).json({ success: false, message: "Mobile number already exists." });
      }
    }

    const protectedFields = protectRespondentFields({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      mobile: normalizedMobile,
    });

    await db.execute(
      "UPDATE Respondent SET firstname = ?, lastname = ?, mobile = ?, mobile_hash = ? WHERE id = ?",
      [
        protectedFields.firstname,
        protectedFields.lastname,
        protectedFields.mobile,
        protectedFields.mobile_hash,
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

    const user = toDecryptedRespondent(rows[0]);
    return res.json({
      success: true,
      message: "Profile updated successfully.",
      data: {
        user: {
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname,
          email: normalizeEmail(user.email),
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
    await ensureRespondentSecurityReady();

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

    const created = await createProtectedRespondent({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      mobile: normalizedMobile,
      email: normalizedEmail,
      password: normalizedPassword,
      role: "ADMIN",
    });

    if (!created.success && created.reason === "DUPLICATE_EMAIL") {
      return res.status(400).json({ success: false, message: "Email already exists." });
    }

    if (!created.success && created.reason === "DUPLICATE_MOBILE") {
      return res.status(400).json({ success: false, message: "Mobile number already exists." });
    }

    if (!created.success) {
      return res.status(500).json({ success: false, message: "Unable to create admin user." });
    }

    return res.status(201).json({
      success: true,
      message: "Admin user created successfully.",
      data: {
        id: created.id,
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

    if (!result.success && result.reason === "DUPLICATE_EMAIL") {
      return res.status(400).json({ success: false, message: "Email already exists." });
    }

    if (!result.success && result.reason === "DUPLICATE_MOBILE") {
      return res.status(400).json({ success: false, message: "Mobile number already exists." });
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

    if (!result.success && result.reason === "DUPLICATE_EMAIL") {
      return res.status(400).json({ success: false, message: "Email already exists." });
    }

    if (!result.success && result.reason === "DUPLICATE_MOBILE") {
      return res.status(400).json({ success: false, message: "Mobile number already exists." });
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
    await ensureRespondentSecurityReady();

    const [rows] = await db.query(`
      SELECT
          d.id,
          d.respondent_id,
          d.respondent_name AS draft_respondent_name,
          r.firstname,
          r.lastname,
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

    const drafts = rows.map((row) => {
      const pii = toDecryptedRespondent(row);
      const firstName = String(pii.firstname || "").trim();
      const lastName = String(pii.lastname || "").trim();
      const fullName = `${firstName} ${lastName}`.trim();

      return {
        id: row.id,
        respondent_id: row.respondent_id,
        respondent_name: fullName || String(row.draft_respondent_name || "").trim(),
        mobile: String(pii.mobile || "").trim(),
        email: normalizeEmail(pii.email),
        answered_count: row.answered_count,
        assessment_type: row.assessment_type,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    res.json({
      success: true,
      drafts,
      count: drafts.length,
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

