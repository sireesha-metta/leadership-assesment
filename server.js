const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

const defaultAllowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://leadership-assesment-sigma.vercel.app",
];

const envAllowedOrigins = [process.env.FRONTEND_URL, process.env.FRONTEND_URLS]
  .filter(Boolean)
  .flatMap((value) =>
    String(value)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envAllowedOrigins])];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());

const authRoutes = require("./routes/authRoute");
const questionRoutes = require("./routes/questionRoute");
const sheetRoutes = require("./routes/sheetRoute");
const adminRoutes = require("./routes/adminRoutes");
const { startDraftReminderJob } = require("./jobs/draftReminderJob");

const db = require("./config/db");

app.use("/api/auth", authRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api", sheetRoutes);
app.use("/api/admin", adminRoutes);

app.get("/", (_req, res) => {
  res.send("Leadership Assessment API Running");
});

app.get(["/health", "/api/health"], async (_req, res) => {
  const start = Date.now();
  try {
    const isDbConnected = typeof db.ping === "function" ? await db.ping() : true;
    const latencyMs = Date.now() - start;
    return res.json({
      status: "ok",
      database: isDbConnected ? "connected" : "disconnected",
      engine: db.isPg || db.isPostgres ? "postgresql" : "mysql",
      latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      status: "error",
      database: "disconnected",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

const PORT = Number(process.env.PORT || 5000);
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [DB_CLIENT=${process.env.DB_CLIENT || "mysql"}]`);
  startDraftReminderJob();
});

// Graceful shutdown handling
function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    console.log("HTTP server closed.");
    try {
      if (typeof db.close === "function") {
        await db.close();
        console.log("Database connection pool closed.");
      }
    } catch (err) {
      console.error("Error during DB pool closure:", err);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forceful shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
