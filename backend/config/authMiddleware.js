// ============================================
// AUTHENTICATION MIDDLEWARE
// Verify JWT token untuk protected routes
// ============================================

const jwt = require('jsonwebtoken');

// Read JWT from httpOnly cookie (primary) or Authorization header (legacy/Bearer).
// Cookie is preferred because it's not reachable from JS, so XSS can't steal the
// token. Header is kept so that scripted clients (curl, external integrations)
// still work — they just have to opt-in by sending the header.
function extractToken(req) {
    const cookieToken = req.cookies?.auth_token;
    if (cookieToken) return cookieToken;

    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    return null;
}

const authMiddleware = (req, res, next) => {
    try {
        const token = extractToken(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token tidak ditemukan. Silakan login.'
            });
        }

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                return res.status(401).json({
                    success: false,
                    message: 'Token tidak valid atau expired'
                });
            }
            req.admin = decoded;
            next();
        });

    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({
            success: false,
            message: 'Error validating token'
        });
    }
};

module.exports = authMiddleware;