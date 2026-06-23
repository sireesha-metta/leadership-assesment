const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  submitAssessment,
  getSubmissions,
} = require("../controllers/sheetController");

const router = express.Router();

router.post("/submit", authMiddleware, submitAssessment);
router.get("/submissions", authMiddleware, getSubmissions);

module.exports = router;
