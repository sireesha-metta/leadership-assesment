const express = require("express");
const { optionalAuth } = require("../middleware/authMiddleware");
const {	saveDraft,savePublicDraft,getDraft,getPublicDraft,deleteDraft,submitAssessment,	getSubmissionStatus,getSubmissions,	deleteSubmission,deletePublicDraft,cancelBooking} = require("../controllers/sheetController");
const router = express.Router();

const { getAvailableAndBookedSlots } = require("../utils/slotService");

router.get("/available-slots", async (req, res) => {
  try {
    const dateStr = req.query.date;
    if (!dateStr) {
      return res.status(400).json({ success: false, message: "date parameter is required" });
    }
    const result = await getAvailableAndBookedSlots(dateStr);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("Available slots error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch slots" });
  }
});

router.post("/public-draft", savePublicDraft);
router.get("/public-draft/:respondentId", getPublicDraft);
router.delete("/public-draft/:respondentId", deletePublicDraft);

router.post("/cancel-booking", cancelBooking);


// router.post("/draft", require("../middleware/authMiddleware").authMiddleware, saveDraft);
// router.get("/draft", require("../middleware/authMiddleware").authMiddleware, getDraft);
// router.delete("/draft", require("../middleware/authMiddleware").authMiddleware, deleteDraft);

router.post("/submit", optionalAuth, submitAssessment);
router.get("/submission-status", require("../middleware/authMiddleware").authMiddleware, getSubmissionStatus);
router.get("/submissions", require("../middleware/authMiddleware").authMiddleware, getSubmissions);
router.delete("/submissions/:id", require("../middleware/authMiddleware").authMiddleware, deleteSubmission);

module.exports = router;
