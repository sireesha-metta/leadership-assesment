const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
	const authHeader = req.headers.authorization || "";
	const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

	if (!token) {
		return res.status(401).json({ message: "No token provided" });
	}

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		req.user = {
			id: decoded.id,
			role: decoded.role,
			email: decoded.email,
		};
		return next();
	} catch (error) {
		return res.status(401).json({ message: "Invalid or expired token" });
	}
}

function optionalAuth(req, _res, next) {
	const authHeader = req.headers.authorization || "";
	const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

	if (!token) {
		return next();
	}

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		req.user = {
			id: decoded.id,
			role: decoded.role,
			email: decoded.email,
		};
	} catch (_error) {
		// Ignore invalid tokens for optional auth.
	}

	return next();
}

module.exports = {
	authMiddleware,
	optionalAuth,
};
