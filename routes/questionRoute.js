const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { getQuestions } = require("../controllers/questionController");

const router = express.Router();

router.get("/", authMiddleware, getQuestions);

module.exports = router;