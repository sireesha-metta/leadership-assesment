const db = require("../config/db");
const {
  ensureRespondentSecuritySchema,
  toDecryptedRespondent,
  hashIdentifier,
  hashMobileIdentifier,
} = require("../utils/dataSecurity");

let securityReadyPromise = null;

async function ensureReady() {
  if (!securityReadyPromise) {
    securityReadyPromise = ensureRespondentSecuritySchema(db).catch((err) => {
      securityReadyPromise = null;
      throw err;
    });
  }
  return securityReadyPromise;
}

function formatFullName(firstname, lastname) {
  const f = String(firstname || "").trim();
  const l = String(lastname || "").trim();
  return `${f} ${l}`.trim();
}

async function getById(id, options = {}) {
  const { activeOnly = false } = options;
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) return null;

  await ensureReady();

  let query = `SELECT id, firstname, lastname, email, mobile, role, status, created_at, updated_at FROM respondent WHERE id = ?`;
  const params = [numId];

  if (activeOnly) {
    query += ` AND status = 'Active'`;
  }

  const [rows] = await db.execute(query, params);
  if (!rows || rows.length === 0) return null;

  const decrypted = toDecryptedRespondent(rows[0]);
  return {
    id: Number(decrypted.id),
    firstname: String(decrypted.firstname || "").trim(),
    lastname: String(decrypted.lastname || "").trim(),
    fullName: formatFullName(decrypted.firstname, decrypted.lastname),
    email: String(decrypted.email || "").trim().toLowerCase(),
    mobile: String(decrypted.mobile || "").trim(),
    role: decrypted.role,
    status: decrypted.status,
    created_at: decrypted.created_at,
    updated_at: decrypted.updated_at,
  };
}

async function getActiveById(id) {
  return getById(id, { activeOnly: true });
}

async function getByEmail(email, options = {}) {
  const { activeOnly = false } = options;
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;

  await ensureReady();

  const emailHash = hashIdentifier(normalized);
  if (!emailHash) return null;

  let query = `SELECT id, firstname, lastname, email, mobile, role, status, created_at, updated_at FROM respondent WHERE email_hash = ?`;
  const params = [emailHash];

  if (activeOnly) {
    query += ` AND status = 'Active'`;
  }

  const [rows] = await db.execute(query, params);
  if (!rows || rows.length === 0) return null;

  const decrypted = toDecryptedRespondent(rows[0]);
  return {
    id: Number(decrypted.id),
    firstname: String(decrypted.firstname || "").trim(),
    lastname: String(decrypted.lastname || "").trim(),
    fullName: formatFullName(decrypted.firstname, decrypted.lastname),
    email: String(decrypted.email || "").trim().toLowerCase(),
    mobile: String(decrypted.mobile || "").trim(),
    role: decrypted.role,
    status: decrypted.status,
    created_at: decrypted.created_at,
    updated_at: decrypted.updated_at,
  };
}

async function getByMobile(mobile, options = {}) {
  const { activeOnly = false } = options;
  const digits = String(mobile || "").replace(/\D/g, "");
  const mobile10 = digits.length >= 10 ? digits.slice(-10) : digits;
  if (!mobile10) return null;

  await ensureReady();

  const mobileHash = hashMobileIdentifier(mobile10);
  if (!mobileHash) return null;

  let query = `SELECT id, firstname, lastname, email, mobile, role, status, created_at, updated_at FROM respondent WHERE mobile_hash = ?`;
  const params = [mobileHash];

  if (activeOnly) {
    query += ` AND status = 'Active'`;
  }

  const [rows] = await db.execute(query, params);
  if (!rows || rows.length === 0) return null;

  const decrypted = toDecryptedRespondent(rows[0]);
  return {
    id: Number(decrypted.id),
    firstname: String(decrypted.firstname || "").trim(),
    lastname: String(decrypted.lastname || "").trim(),
    fullName: formatFullName(decrypted.firstname, decrypted.lastname),
    email: String(decrypted.email || "").trim().toLowerCase(),
    mobile: String(decrypted.mobile || "").trim(),
    role: decrypted.role,
    status: decrypted.status,
    created_at: decrypted.created_at,
    updated_at: decrypted.updated_at,
  };
}

module.exports = {
  ensureReady,
  formatFullName,
  getById,
  getActiveById,
  getByEmail,
  getByMobile,
};
