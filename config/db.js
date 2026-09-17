require("dotenv").config();
const mysql = require("mysql2/promise");
const { Pool: PgPool } = require("pg");

const DB_CLIENT = (process.env.DB_CLIENT || "mysql").trim().toLowerCase();
const isPostgres = DB_CLIENT === "postgres" || DB_CLIENT === "pg";

function isTransientDbError(error) {
  return ["ECONNRESET", "ETIMEDOUT", "PROTOCOL_CONNECTION_LOST", "ECONNREFUSED", "57P01", "08006", "08001"].includes(
    error?.code
  );
}

async function withRetry(operation, attempt = 1) {
  try {
    return await operation();
  } catch (error) {
    if (attempt <= 2 && isTransientDbError(error)) {
      console.warn(`Transient DB error (${error.code || error.message}), retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return withRetry(operation, attempt + 1);
    }
    throw error;
  }
}

/**
 * Translates MySQL '?' placeholders into PostgreSQL '$1, $2, ...' placeholders,
 * ignoring questions marks inside single/double-quoted string literals.
 */
function convertPlaceholders(sql) {
  let paramIndex = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let out = "";

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const prevChar = i > 0 ? sql[i - 1] : "";

    if (char === "'" && prevChar !== "\\") {
      inSingleQuote = !inSingleQuote;
      out += char;
    } else if (char === '"' && prevChar !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      out += char;
    } else if (char === "?" && !inSingleQuote && !inDoubleQuote) {
      out += `$${paramIndex}`;
      paramIndex += 1;
    } else {
      out += char;
    }
  }

  return out;
}

/**
 * Standardizes common MySQL SQL quirks into PostgreSQL equivalents if encountered.
 */
function normalizeSqlForPostgres(rawSql) {
  let sql = rawSql.trim();

  // Replace IFNULL with COALESCE
  sql = sql.replace(/\bIFNULL\s*\(/gi, "COALESCE(");

  // Replace UTC_TIMESTAMP() with NOW() AT TIME ZONE 'UTC' or CURRENT_TIMESTAMP
  sql = sql.replace(/\bUTC_TIMESTAMP\(\)/gi, "CURRENT_TIMESTAMP");

  return sql;
}

let dbExport = null;

if (isPostgres) {
  const poolConfig = {
    max: Number(process.env.DB_POOL_MAX || 20),
    min: Number(process.env.DB_POOL_MIN || 2),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT || 30000),
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECT_TIMEOUT || 10000),
    keepAlive: true,
  };

  // Support full DATABASE_URL or individual parameters
  if (process.env.DATABASE_URL) {
    poolConfig.connectionString = process.env.DATABASE_URL;
  } else {
    poolConfig.host = process.env.DB_HOST || "127.0.0.1";
    poolConfig.port = Number(process.env.DB_PORT || 5432);
    poolConfig.user = process.env.DB_USER || "postgres";
    poolConfig.password = process.env.DB_PASSWORD !== undefined ? String(process.env.DB_PASSWORD) : "postgrespassword";
    poolConfig.database = process.env.DB_NAME || "leadership_assesment";
  }

  // Production SSL support
  const enableSsl =
    process.env.DB_SSL === "true" ||
    process.env.PGSSLMODE === "require" ||
    (process.env.DATABASE_URL && process.env.DATABASE_URL.includes("sslmode=require"));

  if (enableSsl) {
    poolConfig.ssl = {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true",
    };
  }

  const pgPool = new PgPool(poolConfig);

  // Critical for production: prevent idle client errors from crashing process
  pgPool.on("error", (err) => {
    console.error("[PostgreSQL Pool Background Error]", err.message);
  });

  (async () => {
    try {
      const client = await pgPool.connect();
      const target = process.env.DATABASE_URL ? "DATABASE_URL" : `${poolConfig.host}:${poolConfig.port}/${poolConfig.database}`;
      console.log(`[Database] Connected to PostgreSQL on ${target}`);
      client.release();
    } catch (err) {
      console.error("[Database] PostgreSQL Connection Failed:", err.message);
    }
  })();

  async function executePgQuery(rawSql, params = []) {
    let sql = normalizeSqlForPostgres(rawSql);
    const convertedSql = convertPlaceholders(sql);
    const safeParams = Array.isArray(params) ? params : [];

    // Intercept SHOW COLUMNS FROM <table>
    const showColsMatch = sql.match(/^SHOW\s+COLUMNS\s+FROM\s+([`"\w]+)(?:\s+LIKE\s+'([^']+)')?/i);
    if (showColsMatch) {
      const tableName = showColsMatch[1].replace(/[`"]/g, "").toLowerCase();
      const colLike = showColsMatch[2];
      let metaSql = `SELECT column_name AS "Field", data_type AS "Type", is_nullable AS "Null"
                     FROM information_schema.columns
                     WHERE table_schema = current_schema() AND lower(table_name) = lower($1)`;
      const metaParams = [tableName];
      if (colLike) {
        metaSql += ` AND column_name ILIKE $2`;
        metaParams.push(colLike.replace(/%/g, "") + "%");
      }
      const metaRes = await pgPool.query(metaSql, metaParams);
      return [metaRes.rows, metaRes.fields];
    }

    // Intercept SHOW INDEX FROM <table>
    const showIdxMatch = sql.match(/^SHOW\s+INDEX\s+FROM\s+([`"\w]+)(?:\s+WHERE\s+Key_name\s*=\s*'([^']+)')?/i);
    if (showIdxMatch) {
      const tableName = showIdxMatch[1].replace(/[`"]/g, "").toLowerCase();
      const keyName = showIdxMatch[2];
      let metaSql = `SELECT indexname AS "Key_name", tablename AS "Table"
                     FROM pg_indexes
                     WHERE schemaname = current_schema() AND lower(tablename) = lower($1)`;
      const metaParams = [tableName];
      if (keyName) {
        metaSql += ` AND indexname = $2`;
        metaParams.push(keyName);
      }
      const metaRes = await pgPool.query(metaSql, metaParams);
      return [metaRes.rows, metaRes.fields];
    }

    // Intercept SHOW TABLES
    const showTablesMatch = sql.match(/^SHOW\s+TABLES(?:\s+LIKE\s+'([^']+)')?/i);
    if (showTablesMatch) {
      const tblLike = showTablesMatch[1];
      let metaSql = `SELECT table_name
                     FROM information_schema.tables
                     WHERE table_schema = current_schema()`;
      const metaParams = [];
      if (tblLike) {
        metaSql += ` AND table_name ILIKE $1`;
        metaParams.push(tblLike.replace(/%/g, "") + "%");
      }
      const metaRes = await pgPool.query(metaSql, metaParams);
      return [metaRes.rows, metaRes.fields];
    }

    // Auto-append RETURNING id for INSERT queries if not already present
    let isInsert = /^\s*INSERT\s+INTO/i.test(convertedSql);
    let runSql = convertedSql;
    let returningAppended = false;

    if (isInsert && !/RETURNING\s+/i.test(convertedSql)) {
      runSql = `${convertedSql} RETURNING id`;
      returningAppended = true;
    }

    try {
      const res = await pgPool.query(runSql, safeParams);

      if (isInsert) {
        const insertId = res.rows && res.rows[0]?.id ? Number(res.rows[0].id) : undefined;
        const resultObject = {
          insertId,
          affectedRows: res.rowCount || 0,
          rowCount: res.rowCount || 0,
          rows: res.rows || [],
        };
        return [resultObject, res.fields];
      }

      const isUpdateOrDelete = /^\s*(UPDATE|DELETE)\s+/i.test(convertedSql);
      if (isUpdateOrDelete) {
        const resultObject = {
          affectedRows: res.rowCount || 0,
          rowCount: res.rowCount || 0,
          rows: res.rows || [],
        };
        return [resultObject, res.fields];
      }

      return [res.rows || [], res.fields];
    } catch (err) {
      // If RETURNING id failed because table has no id column, fallback without RETURNING
      if (returningAppended && /column "id" does not exist/i.test(err.message)) {
        const resFallback = await pgPool.query(convertedSql, safeParams);
        const resultObject = {
          affectedRows: resFallback.rowCount || 0,
          rowCount: resFallback.rowCount || 0,
          rows: resFallback.rows || [],
        };
        return [resultObject, resFallback.fields];
      }
      throw err;
    }
  }

  dbExport = {
    isPg: true,
    isPostgres: true,
    pool: pgPool,
    execute: (sql, params) => withRetry(() => executePgQuery(sql, params)),
    query: (sql, params) => withRetry(() => executePgQuery(sql, params)),
    getConnection: async () => {
      const client = await pgPool.connect();
      return {
        query: (sql, params) => executePgQuery(sql, params),
        execute: (sql, params) => executePgQuery(sql, params),
        release: () => client.release(),
      };
    },
    ping: async () => {
      const [rows] = await executePgQuery("SELECT 1 AS ping");
      return rows && rows.length > 0;
    },
    close: () => pgPool.end(),
    end: () => pgPool.end(),
  };
} else {
  const mysqlPool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 4000),
    ssl: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: false,
    },
    connectTimeout: 60000,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_MAX || 10),
    queueLimit: 0,
    enableKeepAlive: true,
  });

  (async () => {
    try {
      const conn = await mysqlPool.getConnection();
      console.log(`[Database] Connected to MySQL on ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME}`);
      conn.release();
    } catch (err) {
      console.error("[Database] MySQL Connection Failed:", err.message);
    }
  })();

  dbExport = new Proxy(mysqlPool, {
    get(target, prop, receiver) {
      if (prop === "isPg" || prop === "isPostgres") {
        return false;
      }
      if (prop === "execute") {
        return (...args) => withRetry(() => target.execute(...args));
      }
      if (prop === "query") {
        return (...args) => withRetry(() => target.query(...args));
      }
      if (prop === "ping") {
        return async () => {
          const [rows] = await target.query("SELECT 1 AS ping");
          return rows && rows.length > 0;
        };
      }
      if (prop === "close") {
        return () => target.end();
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

module.exports = dbExport;