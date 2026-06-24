const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");
const { login, register, me, logout, changePassword } = require("../controllers/authController");

router.post("/login", login);
router.post("/register", register);
router.post("/logout", authMiddleware, logout);
router.get("/me", authMiddleware, me);
router.post("/change-password", authMiddleware, changePassword);

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