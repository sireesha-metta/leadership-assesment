const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const ENC_PREFIX = "enc:v1";
let respondentSchemaReadyPromise = null;

function getSecret(name, fallback) {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
}

function getEncryptionKey() {
  const secret = getSecret("DATA_ENCRYPTION_KEY", process.env.JWT_SECRET || "unsafe-dev-key-change-me");
  return crypto.createHash("sha256").update(`enc:${secret}`).digest();
}

function getHashKey() {
  const secret = getSecret("DATA_HASH_KEY", process.env.JWT_SECRET || "unsafe-dev-hash-key-change-me");
  return crypto.createHash("sha256").update(`hash:${secret}`).digest();
}

function isEncryptedValue(value) {
  return String(value || "").startsWith(`${ENC_PREFIX}:`);
}

function encryptValue(plainText) {
  const text = String(plainText ?? "");
  if (!text) return "";
  if (isEncryptedValue(text)) return text;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptValue(value) {
  const raw = String(value ?? "");
  if (!raw) return "";
  if (!isEncryptedValue(raw)) return raw;

  const parts = raw.split(":");
  if (parts.length !== 5) return raw;

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[2], "base64");
    const tag = Buffer.from(parts[3], "base64");
    const encrypted = Buffer.from(parts[4], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return raw;
  }
}

function hashIdentifier(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  const key = getHashKey();
  return crypto.createHmac("sha256", key).update(normalized).digest("hex");
}

function hashMobileIdentifier(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const mobile10 = digits.length >= 10 ? digits.slice(-10) : digits;
  if (!mobile10) return null;
  const key = getHashKey();
  return crypto.createHmac("sha256", key).update(`m:${mobile10}`).digest("hex");
}

function toDecryptedRespondent(row) {
  return {
    ...row,
    firstname: decryptValue(row?.firstname),
    lastname: decryptValue(row?.lastname),
    email: decryptValue(row?.email),
    mobile: decryptValue(row?.mobile),
  };
}

function protectRespondentFields({ firstName, lastName, email, mobile }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedMobile = String(mobile || "").replace(/\D/g, "");
  const mobile10 = normalizedMobile.length >= 10 ? normalizedMobile.slice(-10) : normalizedMobile;

  return {
    firstname: encryptValue(String(firstName || "").trim()),
    lastname: encryptValue(String(lastName || "").trim()),
    email: encryptValue(normalizedEmail),
    mobile: encryptValue(mobile10),
    email_hash: hashIdentifier(normalizedEmail),
    mobile_hash: hashMobileIdentifier(mobile10),
  };
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

async function ensureRespondentSecuritySchema(db) {
  if (respondentSchemaReadyPromise) {
    return respondentSchemaReadyPromise;
  }

  respondentSchemaReadyPromise = (async () => {
    if (db.isPg) {
      await db.execute(`ALTER TABLE respondent ALTER COLUMN firstname TYPE VARCHAR(512)`);
      await db.execute(`ALTER TABLE respondent ALTER COLUMN lastname TYPE VARCHAR(512)`);
      await db.execute(`ALTER TABLE respondent ALTER COLUMN mobile TYPE VARCHAR(512)`);
      await db.execute(`ALTER TABLE respondent ALTER COLUMN email TYPE VARCHAR(512)`);
      await db.execute(`ALTER TABLE respondent ADD COLUMN IF NOT EXISTS email_hash CHAR(64) NULL`);
      await db.execute(`ALTER TABLE respondent ADD COLUMN IF NOT EXISTS mobile_hash CHAR(64) NULL`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_respondent_email_hash ON respondent (email_hash)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_respondent_mobile_hash ON respondent (mobile_hash)`);
      await db.execute(`ALTER TABLE respondent DROP CONSTRAINT IF EXISTS respondent_role_check`);
      await db.execute(`ALTER TABLE respondent DROP CONSTRAINT IF EXISTS respondent_status_check`);
    } else {
      await db.execute(
        `ALTER TABLE Respondent
         MODIFY firstname VARCHAR(512) NOT NULL,
         MODIFY lastname VARCHAR(512) NULL,
         MODIFY mobile VARCHAR(512) NULL,
         MODIFY email VARCHAR(512) NOT NULL`
      );

      const [emailHashCols] = await db.execute("SHOW COLUMNS FROM Respondent LIKE 'email_hash'");
      if (emailHashCols.length === 0) {
        await db.execute("ALTER TABLE Respondent ADD COLUMN email_hash CHAR(64) NULL");
      }

      const [mobileHashCols] = await db.execute("SHOW COLUMNS FROM Respondent LIKE 'mobile_hash'");
      if (mobileHashCols.length === 0) {
        await db.execute("ALTER TABLE Respondent ADD COLUMN mobile_hash CHAR(64) NULL");
      }

      const [emailHashIdx] = await db.execute("SHOW INDEX FROM Respondent WHERE Key_name = 'idx_respondent_email_hash'");
      if (emailHashIdx.length === 0) {
        await db.execute("CREATE INDEX idx_respondent_email_hash ON Respondent (email_hash)");
      }

      const [mobileHashIdx] = await db.execute("SHOW INDEX FROM Respondent WHERE Key_name = 'idx_respondent_mobile_hash'");
      if (mobileHashIdx.length === 0) {
        await db.execute("CREATE INDEX idx_respondent_mobile_hash ON Respondent (mobile_hash)");
      }
    }

    const [rows] = await db.execute(
      `SELECT id, firstname, lastname, mobile, email, password, email_hash, mobile_hash
       FROM respondent`
    );

    for (const row of rows) {
      const decrypted = toDecryptedRespondent(row);
      const protectedRow = protectRespondentFields({
        firstName: decrypted.firstname,
        lastName: decrypted.lastname,
        email: decrypted.email,
        mobile: decrypted.mobile,
      });

      const currentPassword = String(row.password || "");
      const passwordHash = isBcryptHash(currentPassword)
        ? currentPassword
        : await bcrypt.hash(currentPassword, 12);

      const rawMobile = String(row.mobile || "");
      const needsMobileEncryption = rawMobile ? !isEncryptedValue(rawMobile) : false;

      const needsPiiUpdate =
        !isEncryptedValue(row.firstname) ||
        !isEncryptedValue(row.lastname) ||
        !isEncryptedValue(row.email) ||
        needsMobileEncryption ||
        String(row.email_hash || "") !== String(protectedRow.email_hash || "") ||
        String(row.mobile_hash || "") !== String(protectedRow.mobile_hash || "");

      const needsPasswordUpdate = !isBcryptHash(currentPassword);

      if (!needsPiiUpdate && !needsPasswordUpdate) {
        continue;
      }

      await db.execute(
        `UPDATE respondent
         SET firstname = ?, lastname = ?, mobile = ?, email = ?, email_hash = ?, mobile_hash = ?, password = ?
         WHERE id = ?`,
        [
          protectedRow.firstname,
          protectedRow.lastname,
          protectedRow.mobile,
          protectedRow.email,
          protectedRow.email_hash,
          protectedRow.mobile_hash,
          passwordHash,
          Number(row.id),
        ]
      );
    }
  })().catch((error) => {
    respondentSchemaReadyPromise = null;
    throw error;
  });

  return respondentSchemaReadyPromise;
}

module.exports = {
  ensureRespondentSecuritySchema,
  protectRespondentFields,
  toDecryptedRespondent,
  hashIdentifier,
  hashMobileIdentifier,
  decryptValue,
  encryptValue,
  isBcryptHash,
};
