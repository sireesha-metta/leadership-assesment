const pool = require("../config/db");
const { generateRespondentsExcel, generateSubmissionsExcel } = require("../utils/xlGenerator");
const { ensureRespondentSecuritySchema, toDecryptedRespondent } = require("../utils/dataSecurity");

// GET /api/admin/drafts - in-progress (draft) assessments still within the 24h window
exports.getDrafts = async (req, res) => {
  try {
    await ensureRespondentSecuritySchema(pool);

    const timeCondition = pool.isPg
      ? "d.updated_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours')"
      : "d.updated_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)";

    const [rows] = await pool.query(`
      SELECT
        d.id,
        d.respondent_id,
        d.answered_count,
        d.updated_at,
        d.created_at,
        r.email,
        r.firstname,
        r.lastname,
        r.status
      FROM assessment_drafts d
      JOIN respondent r ON r.id = d.respondent_id AND r.status = 'Active'
      WHERE d.assessment_type = 'leadership_reset'
        AND ${timeCondition}
      ORDER BY d.updated_at DESC
    `);

    const drafts = rows.map((row) => {
      const pii = toDecryptedRespondent(row);
      const firstName = String(pii.firstname || "").trim();
      const lastName = String(pii.lastname || "").trim();
      const fullName = `${firstName} ${lastName}`.trim();
      const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
      const elapsedMs = updatedAt ? Date.now() - updatedAt.getTime() : null;
      const hoursRemaining = elapsedMs != null
        ? Math.max(0, Math.ceil(24 - elapsedMs / (1000 * 60 * 60)))
        : null;

      return {
        id: row.id,
        respondentId: row.respondent_id,
        name: fullName || "Respondent",
        email: String(pii.email || "").trim().toLowerCase(),
        answeredCount: Number(row.answered_count || 0),
        status: "In Progress",
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        hoursRemaining,
      };
    });

    return res.json({ success: true, drafts });
  } catch (error) {
    console.error("Get Drafts Error:", error);
    return res.status(500).json({ success: false, message: "Unable to load draft assessments." });
  }
};

exports.exportRespondents = async (req, res) => {
  try {
    await ensureRespondentSecuritySchema(pool);

    const [respondents] = await pool.query(`
    SELECT
        id,
        firstname,
        lastname,
        email,
        role,
        status,
        created_at
    FROM respondent
    ORDER BY created_at DESC
  `);

    const decryptedRespondents = respondents.map((row) => {
      const pii = toDecryptedRespondent(row);
      return {
        ...row,
        firstname: pii.firstname,
        lastname: pii.lastname,
        email: String(pii.email || "").trim().toLowerCase(),
      };
    });

    const buffer = await generateRespondentsExcel(decryptedRespondents);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Respondents_${Date.now()}.xlsx`
    );

    return res.send(buffer);
  } catch (error) {
    console.error("Export Respondents Error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to export respondents.",
    });
  }
};

exports.exportSubmissions = async (req, res) => {
  try {
    await ensureRespondentSecuritySchema(pool);

    const [assessment_submissions] = await pool.query(`
      SELECT
        s.id,
        s.respondent_id,
        s.assessment_type,
        s.submitted_at,
        s.total_score,
        s.total_weighted_score,
        s.submission_payload,
        s.created_at,
        r.firstname,
        r.lastname,
        r.email,
        r.mobile
      FROM assessment_submissions s
      JOIN respondent r ON r.id = s.respondent_id
      WHERE (r.status IS NULL OR UPPER(r.status) != 'INACTIVE')
        AND (s.status IS NULL OR UPPER(s.status) != 'INACTIVE')
      ORDER BY s.submitted_at DESC
    `);

    const decryptedSubmissions = assessment_submissions.map((row) => {
      const pii = toDecryptedRespondent(row);
      const firstName = String(pii.firstname || "").trim();
      const lastName = String(pii.lastname || "").trim();
      const fullName = `${firstName} ${lastName}`.trim();
      return {
        ...row,
        respondent_name: fullName || "Respondent",
        email: String(pii.email || "").trim().toLowerCase(),
      };
    });

    const buffer = await generateSubmissionsExcel(decryptedSubmissions);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Submissions_${Date.now()}.xlsx`
    );

    res.send(buffer);

  } catch (err) {
    console.error("Export Submissions Error:", err);
    res.status(500).json({
      success: false,
      message: "Unable to export submissions."
    });
  }
};

exports.getSlotSettings = async (req, res) => {
  try {
    const { ensureSlotSchema } = require("../utils/slotService");
    await ensureSlotSchema();

    const [configs] = await pool.query(
      "SELECT id, slot_time, is_active, display_order FROM admin_slot_config ORDER BY display_order ASC, id ASC"
    );

    const [blocks] = await pool.query(
      "SELECT id, block_date, slot_time, reason, created_at FROM admin_blocked_slots ORDER BY id DESC"
    );

    const [shifts] = await pool.query(
      "SELECT id, shift_type, start_time, end_time, max_capacity, call_duration_mins, grace_period_mins, is_active FROM admin_shift_config ORDER BY id ASC"
    );

    return res.json({
      success: true,
      configs,
      blocks,
      shifts,
    });
  } catch (err) {
    console.error("Get slot settings error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch slot settings" });
  }
};

exports.toggleSlotConfig = async (req, res) => {
  try {
    const { id, is_active } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: "Slot ID required" });
    }
    await pool.query("UPDATE admin_slot_config SET is_active = ? WHERE id = ?", [Boolean(is_active), id]);
    return res.json({ success: true, message: "Slot config updated successfully" });
  } catch (err) {
    console.error("Toggle slot config error:", err);
    return res.status(500).json({ success: false, message: "Failed to update slot config" });
  }
};

exports.blockSlot = async (req, res) => {
  try {
    const { block_date, slot_time, reason } = req.body;
    if (!block_date) {
      return res.status(400).json({ success: false, message: "Date is required" });
    }
    await pool.query(
      "INSERT INTO admin_blocked_slots (block_date, slot_time, reason) VALUES (?, ?, ?)",
      [block_date, slot_time || null, reason || null]
    );
    return res.json({ success: true, message: "Slot/Date blocked successfully" });
  } catch (err) {
    console.error("Block slot error:", err);
    return res.status(500).json({ success: false, message: "Failed to block slot" });
  }
};

exports.unblockSlot = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Block ID required" });
    }
    await pool.query("DELETE FROM admin_blocked_slots WHERE id = ?", [id]);
    return res.json({ success: true, message: "Block removed successfully" });
  } catch (err) {
    console.error("Unblock slot error:", err);
    return res.status(500).json({ success: false, message: "Failed to remove block" });
  }
};

exports.saveShiftConfig = async (req, res) => {
  try {
    const { id, shift_type, start_time, end_time, max_capacity, call_duration_mins, grace_period_mins, is_active } = req.body;
    if (!shift_type || !start_time || !end_time) {
      return res.status(400).json({ success: false, message: "Shift type, start time, and end time are required" });
    }

    let targetId = id;
    if (!targetId) {
      const [existing] = await pool.query("SELECT id FROM admin_shift_config WHERE shift_type = ?", [shift_type]);
      if (existing.length > 0) {
        targetId = existing[0].id;
      }
    }

    if (targetId) {
      await pool.query(
        "UPDATE admin_shift_config SET shift_type = ?, start_time = ?, end_time = ?, max_capacity = ?, call_duration_mins = ?, grace_period_mins = ?, is_active = ? WHERE id = ?",
        [shift_type, start_time, end_time, Number(max_capacity) || 15, Number(call_duration_mins) || 20, Number(grace_period_mins) || 10, is_active !== false, targetId]
      );
    } else {
      await pool.query(
        "INSERT INTO admin_shift_config (shift_type, start_time, end_time, max_capacity, call_duration_mins, grace_period_mins, is_active) VALUES (?, ?, ?, ?, ?, ?, true)",
        [shift_type, start_time, end_time, Number(max_capacity) || 15, Number(call_duration_mins) || 20, Number(grace_period_mins) || 10]
      );
    }
    return res.json({ success: true, message: "Shift configuration saved successfully" });
  } catch (err) {
    console.error("Save shift config error:", err);
    return res.status(500).json({ success: false, message: "Failed to save shift config" });
  }
};

exports.deleteShiftConfig = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Shift ID required" });
    }
    await pool.query("DELETE FROM admin_shift_config WHERE id = ?", [id]);
    return res.json({ success: true, message: "Shift deleted successfully" });
  } catch (err) {
    console.error("Delete shift error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete shift" });
  }
};