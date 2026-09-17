const express = require("express");
const router = express.Router();

const adminController = require("../controllers/adminController");

router.get("/export/respondents", adminController.exportRespondents);
router.get("/export/submissions", adminController.exportSubmissions);
router.get("/drafts", adminController.getDrafts);

router.get("/slots/settings", adminController.getSlotSettings);
router.post("/slots/config", adminController.toggleSlotConfig);
router.post("/slots/block", adminController.blockSlot);
router.delete("/slots/block/:id", adminController.unblockSlot);

router.post("/shifts/config", adminController.saveShiftConfig);
router.delete("/shifts/:id", adminController.deleteShiftConfig);

module.exports = router;