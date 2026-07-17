const mysql = require("mysql2/promise");

function isTransientDbError(error) {
  return ["ECONNRESET", "ETIMEDOUT", "PROTOCOL_CONNECTION_LOST", "ECONNREFUSED"].includes(error?.code);
}

async function withRetry(operation, attempt = 1) {
  try {
    return await operation();
  } catch (error) {
    if (attempt <= 2 && isTransientDbError(error)) {
      console.warn(`Transient DB error (${error.code}), retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return withRetry(operation, attempt + 1);
    }

    throw error;
  }
}

const pool = mysql.createPool({
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
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
});

(async () => {
  try {
    const conn = await pool.getConnection();
    console.log("Database Connected");
    conn.release();
  } catch (err) {
    console.error("Database Connection Failed:", err.message);
  }
})();

const db = new Proxy(pool, {
  get(target, prop, receiver) {
    if (prop === "execute") {
      return (...args) => withRetry(() => target.execute(...args));
    }

    if (prop === "query") {
      return (...args) => withRetry(() => target.query(...args));
    }

    return Reflect.get(target, prop, receiver);
  },
});

module.exports = db;