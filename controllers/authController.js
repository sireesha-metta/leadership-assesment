const jwt = require("jsonwebtoken");
const users = require("../utils/seedUsers");

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      email: user.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "8h",
    }
  );
}

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = users.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (!user) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const validPassword = String(password) === String(user.password);

    if (!validPassword) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const token = signToken(user);
    const decoded = jwt.decode(token);
    const expiresAt = decoded?.exp ? decoded.exp * 1000 : null;

    return res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        expiresAt,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.me = async (req, res) => {
  const user = users.find((u) => String(u.id) === String(req.user.id));
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    },
  });
};

exports.logout = async (_req, res) => {
  return res.json({ success: true });
};