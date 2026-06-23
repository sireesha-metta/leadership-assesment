const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
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
