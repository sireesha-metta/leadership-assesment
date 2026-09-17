const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { authMiddleware } = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");
const { ensureRespondentSecuritySchema, toDecryptedRespondent } = require("../utils/dataSecurity");
const {login,register,upsertAssessmentRespondent,createAdmin,createRespondent,getAdmins,updateAdmin,deleteAdmin,getRespondents,updateRespondent,deleteRespondent,me,
  updateProfile,logout,changePassword,forgotPassword,getAllDrafts,} = require("../controllers/authController");  
const { runDraftReminderCycle } = require("../jobs/draftReminderJob");
const Uploaded_file = require("../middleware/uploads");

async function getTableColumns(tableName) {
  if (db.isPg) {
    const [rows] = await db.execute(
      `SELECT column_name AS "COLUMN_NAME" FROM information_schema.columns
       WHERE table_schema = CURRENT_SCHEMA() AND lower(table_name) = lower(?)`,
      [tableName]
    );
    return new Set(rows.map((row) => String(row.COLUMN_NAME || row.column_name || "").toLowerCase()));
  }

  const [rows] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => String(row.COLUMN_NAME || "").toLowerCase()));
}

function pickFirstExisting(columns, candidates) {
  return candidates.find((name) => columns.has(name.toLowerCase())) || null;
}

async function resolveUploaderName(user) {
  if (!user?.id) return user?.email || null;

  try {
    await ensureRespondentSecuritySchema(db);

    const [rows] = await db.execute(
      "SELECT firstname, lastname, email FROM Respondent WHERE id = ? LIMIT 1",
      [user.id]
    );

    if (!rows.length) return user?.email || null;

    const pii = toDecryptedRespondent(rows[0]);
    const firstName = String(pii.firstname || "").trim();
    const lastName = String(pii.lastname || "").trim();
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || String(pii.email || user?.email || "").trim() || null;
  } catch {
    return user?.email || null;
  }
}

async function insertUploadHistory(req) {
  const tableColumns = await getTableColumns("file_upload_history");
  if (!tableColumns.size) return;

  const fileNameColumn = pickFirstExisting(tableColumns, ["file_name", "filename", "stored_name"]);
  const originalNameColumn = pickFirstExisting(tableColumns, ["original_name", "originalname", "original_file_name"]);
  const filePathColumn = pickFirstExisting(tableColumns, ["file_path", "path"]);
  const fileSizeColumn = pickFirstExisting(tableColumns, ["file_size", "size"]);
  const uploadedByColumn = pickFirstExisting(tableColumns, ["uploaded_by", "user_id", "created_by"]);

  const insertPairs = [];

  if (fileNameColumn) insertPairs.push([fileNameColumn, req.file.filename]);
  if (originalNameColumn) insertPairs.push([originalNameColumn, req.file.originalname]);
  if (filePathColumn) insertPairs.push([filePathColumn, req.file.path]);
  if (fileSizeColumn) insertPairs.push([fileSizeColumn, req.file.size]);
  if (uploadedByColumn) insertPairs.push([uploadedByColumn, req.user?.id || null]);

  if (!insertPairs.length) return;

  const columnSql = insertPairs.map(([column]) => column).join(", ");
  const placeholderSql = insertPairs.map(() => "?").join(", ");
  const values = insertPairs.map(([, value]) => value);

  await db.execute(
    `INSERT INTO file_upload_history (${columnSql}) VALUES (${placeholderSql})`,
    values
  );
}

router.post("/upload", authMiddleware, Uploaded_file.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Please select a file." });
    }

    try {
      await insertUploadHistory(req);
    } catch (historyError) {
      console.error("Upload history insert failed:", historyError.message);
    }

    return res.json({
      success: true,
      message: "File uploaded successfully.",
      data: {
        fileName: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path,
        size: req.file.size,
      },
    });
  } catch (error) {
    console.error("File upload failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to save file." });
  }
});

router.post("/login", login);
router.post("/register", register);

router.post("/assessment-respondent", upsertAssessmentRespondent);

router.post("/admins", authMiddleware, allowRoles("ADMIN"), createAdmin);
router.get("/admins", authMiddleware, allowRoles("ADMIN"), getAdmins);
router.put("/admins/:id", authMiddleware, allowRoles("ADMIN"), updateAdmin);
router.delete("/admins/:id", authMiddleware, allowRoles("ADMIN"), deleteAdmin);

router.post("/respondents", authMiddleware, allowRoles("ADMIN"), createRespondent);
router.get("/respondents", authMiddleware, allowRoles("ADMIN"), getRespondents);
router.put("/respondents/:id", authMiddleware, allowRoles("ADMIN"), updateRespondent);
router.delete("/respondents/:id", authMiddleware, allowRoles("ADMIN"), deleteRespondent);

router.post("/forgot-password", forgotPassword);
router.post("/change-password", authMiddleware, changePassword);

router.post("/logout", authMiddleware, logout);
router.get("/me", authMiddleware, me);
router.put("/profile", authMiddleware, updateProfile);

router.get("/drafts", authMiddleware, allowRoles("ADMIN"), getAllDrafts);

router.post("/drafts/reminder/run", authMiddleware, allowRoles("ADMIN"), async (_req, res) => {
  try {
    const summary = await runDraftReminderCycle({ force: true });

    if (summary?.skipped) {
      return res.status(202).json({
        success: false,
        skipped: true,
        message: summary.reason || "Reminder cycle skipped.",
        data: summary,
      });
    }

    if (!summary?.success) {
      return res.status(500).json({
        success: false,
        message: summary?.reason || "Failed to run reminder cycle.",
        data: summary,
      });
    }

    return res.json({
      success: true,
      message: `Reminder cycle completed. Sent ${summary.sent} of ${summary.processed}.`,
      data: summary,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to run reminder cycle.",
    });
  }
});



router.get("/test", (req, res) => {
  res.json({ success: true, message: "Auth route working" });
});

router.get("/users", authMiddleware, allowRoles("ADMIN"), async (req, res) => {
  try {
    await ensureRespondentSecuritySchema(db);

    const [results] = await db.execute("SELECT id, firstname, lastname, email, role, mobile, status FROM Respondent");
    const users = results.map((row) => {
      const pii = toDecryptedRespondent(row);
      return {
        id: row.id,
        firstname: pii.firstname,
        lastname: pii.lastname,
        email: String(pii.email || "").trim().toLowerCase(),
        role: row.role,
        mobile: pii.mobile,
        status: row.status,
      };
    });

    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;