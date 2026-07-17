const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { getQuestions, saveAnswers } = require("../controllers/questionController");

const router = express.Router();

router.get("/", getQuestions);
router.post("/answers", authMiddleware, saveAnswers);

module.exports = router;