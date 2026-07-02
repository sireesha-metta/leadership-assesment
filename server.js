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

app.use("/api/auth", authRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api", sheetRoutes);

app.get("/", (_req, res) => {
  res.send("Leadership Assessment API Running");
});

const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
