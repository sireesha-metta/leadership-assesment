const express = require("express");
const router = express.Router();

const adminController = require("../controllers/adminController");

router.get("/export/respondents",adminController.exportRespondents);

router.get("/export/submissions",adminController.exportSubmissions);

module.exports = router;