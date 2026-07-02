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
      "INSERT INTO Respondent (firstname, lastname, mobile, email, password) VALUES (?, ?, ?, ?, ?)",
      [firstName, lastName, mobile || "", String(email).trim().toLowerCase(), password]
    );

    return res.status(201).json({ success: true, message: "Registration successful", id: result.insertId });
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