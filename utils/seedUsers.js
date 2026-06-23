// const bcrypt = require("bcryptjs");
// const User = require("../models/users");

// async function ensureDefaultUsers() {
//   const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || "admin@leadership.com").trim().toLowerCase();
//   const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || "admin123";

//   const respondentEmail =
//     (process.env.DEFAULT_RESPONDENT_EMAIL || "respondent@leadership.com").trim().toLowerCase();
//   const respondentPassword = process.env.DEFAULT_RESPONDENT_PASSWORD || "test123";

//   const defaults = [
//     {
//       name: "System Admin",
//       email: adminEmail,
//       password: adminPassword,
//       role: "ADMIN",
//     },
//     {
//       name: "Default Respondent",
//       email: respondentEmail,
//       password: respondentPassword,
//       role: "RESPONDENT",
//     },
//   ];

//   for (const candidate of defaults) {
//     const existing = await User.findOne({ email: candidate.email });
//     if (existing) continue;

//     const hashedPassword = await bcrypt.hash(candidate.password, 10);
//     await User.create({
//       name: candidate.name,
//       email: candidate.email,
//       password: hashedPassword,
//       role: candidate.role,
//       isActive: true,
//     });
//   }

//   console.log("Default users ensured");
// }

// module.exports = {
//   ensureDefaultUsers,
// };



const users = [
  {
    id: 1,
    name: "Admin User",
    email: "admin@leadership.com",
    password: "admin123",
    role: "ADMIN",
  },
  {
    id: 2,
    name: "John Respondent",
    email: "respondent@leadership.com",
    password: "test123",
    role: "RESPONDENT",
  },
];

module.exports = users;