const multer = require("multer");
const fs = require("fs");
const path = require("path");

const uploadDir = path.resolve("uploaded_file");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },

  filename: function (req, file, cb) {
    // cb(null, Date.now() + "-" + file.originalname);
    cb(null, file.originalname);

  },
});

const Uploaded_file = multer({ storage });

module.exports = Uploaded_file;