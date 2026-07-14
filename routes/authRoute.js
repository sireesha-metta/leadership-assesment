const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");
const {login,register,createAdmin,createRespondent,getAdmins,updateAdmin,deleteAdmin,getRespondents,updateRespondent,deleteRespondent,me,
  updateProfile,logout,changePassword,forgotPassword,getAllDrafts,} = require("../controllers/authController");  
const Uploaded_file = require("../middleware/uploads");

async function getTableColumns(tableName) {
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
    const [rows] = await db.execute(
      "SELECT firstname, lastname, email FROM Respondent WHERE id = ? LIMIT 1",
      [user.id]
    );

    if (!rows.length) return user?.email || null;

    const firstName = String(rows[0].firstname || "").trim();
    const lastName = String(rows[0].lastname || "").trim();
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || String(rows[0].email || user?.email || "").trim() || null;
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
  const uploadedByNameColumn = pickFirstExisting(tableColumns, ["uploaded_by_name", "user_name", "created_by_name"]);
  const uploaderName = uploadedByNameColumn ? await resolveUploaderName(req.user) : null;

  const insertPairs = [];

  if (fileNameColumn) insertPairs.push([fileNameColumn, req.file.filename]);
  if (originalNameColumn) insertPairs.push([originalNameColumn, req.file.originalname]);
  if (filePathColumn) insertPairs.push([filePathColumn, req.file.path]);
  if (fileSizeColumn) insertPairs.push([fileSizeColumn, req.file.size]);
  if (uploadedByColumn) insertPairs.push([uploadedByColumn, req.user?.id || null]);
  if (uploadedByNameColumn) insertPairs.push([uploadedByNameColumn, uploaderName]);

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
router.post("/admins", authMiddleware, allowRoles("ADMIN"), createAdmin);
router.get("/admins", authMiddleware, allowRoles("ADMIN"), getAdmins);
router.put("/admins/:id", authMiddleware, allowRoles("ADMIN"), updateAdmin);
router.delete("/admins/:id", authMiddleware, allowRoles("ADMIN"), deleteAdmin);

router.post("/respondents", authMiddleware, allowRoles("ADMIN"), createRespondent);
router.get("/respondents", authMiddleware, allowRoles("ADMIN"), getRespondents);
router.put("/respondents/:id", authMiddleware, allowRoles("ADMIN"), updateRespondent);
router.delete("/respondents/:id", authMiddleware, allowRoles("ADMIN"), deleteRespondent);

router.post("/forgot-password", forgotPassword);
router.post("/logout", authMiddleware, logout);
router.get("/me", authMiddleware, me);
router.put("/profile", authMiddleware, updateProfile);
router.post("/change-password", authMiddleware, changePassword);

router.get("/drafts", authMiddleware, allowRoles("ADMIN"), getAllDrafts);



router.get("/test", (req, res) => {
  res.json({ success: true, message: "Auth route working" });
});

router.get("/users", authMiddleware, allowRoles("ADMIN"), async (req, res) => {
  try {
    const [results] = await db.execute("SELECT id, firstname, lastname, email, role, mobile, status FROM Respondent");
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;