// ============================================
// CSRF PROTECTION — Double-submit cookie pattern
//
// Modern alternative to deprecated `csurf` package.
//
// How it works:
// 1. On login the server sets two cookies:
//    - auth_token  (httpOnly, holds the JWT — JS can't read it)
//    - csrf_token  (NOT httpOnly so JS CAN read it, but SameSite=Lax so
//                    other origins can't trigger requests that include it)
// 2. For any state-changing request (POST/PUT/PATCH/DELETE) the frontend
//    reads csrf_token from document.cookie and echoes it back in the
//    X-CSRF-Token header.
// 3. This middleware verifies header == cookie. Cross-site attackers cannot
//    forge the header because the same-origin policy blocks them from
//    reading the cookie value.
//
// Why this is safe:
// - The httpOnly auth_token rides along automatically (cookie), so XSS can't
//   steal it (closes the localStorage attack vector from audit point #6).
// - The csrf_token is readable to JS by design, but reading it requires
//   already being on the same origin (i.e., past the XSS/CORS gates), and
//   even if read, an attacker on a different origin can't make a browser
//   send a custom header to our backend without a preflight.
// ============================================

const crypto = require('crypto');

// Constant-time string comparison — defends against timing side-channels on
// secret checks (CSRF tokens, webhook secrets, sync keys). Falls back to a
// length-mismatch return without ever calling timingSafeEqual on unequal-length
// buffers (which would throw).
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Endpoints that intentionally don't have a session yet — must skip CSRF.
const EXEMPT_PATHS = new Set([
    '/admin/login',          // user is unauthenticated; CSRF doesn't apply
    '/admin/logout',         // must work even after token expiry (no CSRF cookie left)
    '/admin/forgot',         // sends an email regardless of session
    '/admin/reset',          // token-based, idempotent against a token
    '/form-submit',          // public customer-facing form, rate-limited
    '/webhook/whatsapp'      // webhook is auth'd by X-WA-Secret instead
]);

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function isCrossSiteAllowed() {
    // SameSite=None requires Secure (https). Only use it in production AND when
    // ALLOWED_ORIGINS includes an origin that isn't the same host the backend
    // runs from (typical multi-domain deploy: backend.railway.app + admin.vercel.app).
    return process.env.NODE_ENV === 'production' && process.env.COOKIE_SAMESITE === 'none';
}

function cookieOptions(httpOnly = true) {
    const sameSite = isCrossSiteAllowed() ? 'none' : 'lax';
    const secure = process.env.NODE_ENV === 'production' || sameSite === 'none';
    return {
        httpOnly,
        secure,
        sameSite,
        path: '/',
        maxAge: 12 * 60 * 60 * 1000  // 12 hours, matches JWT expiry
    };
}

function issueCsrfToken(res) {
    const token = generateToken();
    res.cookie('csrf_token', token, cookieOptions(false));
    return token;
}

function setAuthCookie(res, jwt) {
    res.cookie('auth_token', jwt, cookieOptions(true));
}

function clearAuthCookies(res) {
    res.clearCookie('auth_token', { path: '/' });
    res.clearCookie('csrf_token', { path: '/' });
}

function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (EXEMPT_PATHS.has(req.path)) return next();
    // Quick-sync endpoints under /api/sync/* use X-Sync-Key instead of cookies
    if (req.path.startsWith('/sync/')) return next();
    // Webhook test endpoint
    if (req.path.startsWith('/webhook/')) return next();

    const cookieToken = req.cookies?.csrf_token;
    const headerToken = req.headers['x-csrf-token'];

    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
        return res.status(403).json({
            success: false,
            message: 'CSRF token tidak valid. Silakan login ulang.'
        });
    }
    next();
}

module.exports = {
    csrfProtection,
    issueCsrfToken,
    setAuthCookie,
    clearAuthCookies,
    generateToken,
    safeEqual
};
