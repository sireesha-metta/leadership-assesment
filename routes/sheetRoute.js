const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  saveDraft,
  getDraft,
  deleteDraft,
  submitAssessment,
  getSubmissions,
} = require("../controllers/sheetController");

const router = express.Router();

router.post("/draft", authMiddleware, saveDraft);
router.get("/draft", authMiddleware, getDraft);
router.delete("/draft", authMiddleware, deleteDraft);
router.post("/submit", authMiddleware, submitAssessment);
router.get("/submissions", authMiddleware, getSubmissions);

module.exports = router;
