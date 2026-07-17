const express = require("express");
const { optionalAuth } = require("../middleware/authMiddleware");
const {	saveDraft,savePublicDraft,getDraft,getPublicDraft,deleteDraft,submitAssessment,	getSubmissionStatus,getSubmissions,	deleteSubmission,deletePublicDraft} = require("../controllers/sheetController");
const router = express.Router();

router.post("/public-draft", savePublicDraft);
router.get("/public-draft/:respondentId", getPublicDraft);
router.delete("/public-draft/:respondentId", deletePublicDraft);


router.post("/draft", require("../middleware/authMiddleware").authMiddleware, saveDraft);
router.get("/draft", require("../middleware/authMiddleware").authMiddleware, getDraft);
router.delete("/draft", require("../middleware/authMiddleware").authMiddleware, deleteDraft);

router.post("/submit", optionalAuth, submitAssessment);
router.get("/submission-status", require("../middleware/authMiddleware").authMiddleware, getSubmissionStatus);
router.get("/submissions", require("../middleware/authMiddleware").authMiddleware, getSubmissions);
router.delete("/submissions/:id", require("../middleware/authMiddleware").authMiddleware, deleteSubmission);

module.exports = router;
