const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");
const { register, me, logout, login } = require("../controllers/authController");


router.post("/logout", authMiddleware, logout);

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Auth route working"
  });
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await db.execute(
      `SELECT * FROM Respondent  WHERE email = ?  AND password = ?  AND status = 'Active'`,
      [email, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = rows[0];

    return res.json({
      success: true,
      data: {
        token: "sample-token",
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        user: {
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.post("/register", async (req, res) => { 
  console.log("Register request body:", req.body);
  console.log("Register request body:", req.body.firstName);

  try {
    const {firstName,lastName,mobile,email,password } = req.body;

    const [existing] = await db.execute(
      "SELECT id FROM Respondent WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO Respondent
      (firstname, lastname, mobile, email, password)
      VALUES (?, ?, ?, ?, ?)`,
      [
        firstName,
        lastName,
        mobile,
        email,
        password,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Registration successful",
      id: result.insertId,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


router.get("/users", authMiddleware, allowRoles("ADMIN"), async (req, res) => {
  try {
    const [results] = await db.execute("SELECT * FROM Respondent");
    res.json(results);
  } catch (err) {
    res.status(500).json(err);
  }
});

module.exports = router;