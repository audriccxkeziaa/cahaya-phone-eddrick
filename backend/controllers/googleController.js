// ============================================
// GOOGLE CONTROLLER
// OAuth flow + status for Google Contacts API
// ============================================

const googleService = require('../config/google');
const db = require('../config/database');

/**
 * GET /api/google/auth — Redirect to Google OAuth
 */
exports.authorize = (req, res) => {
    try {
        // Debug: check if env vars are set
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
            return res.status(500).json({
                error: 'Google env vars missing',
                hasClientId: !!process.env.GOOGLE_CLIENT_ID,
                hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
                hasRedirectUri: !!process.env.GOOGLE_REDIRECT_URI
            });
        }
        const url = googleService.getAuthUrl();
        res.redirect(url);
    } catch (error) {
        console.error('❌ Google auth error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/google/callback — Handle OAuth callback
 */
exports.callback = async (req, res) => {
    try {
        const { code, error } = req.query;

        if (error) {
            return res.redirect('/admin/dashboard.html?google=error&msg=' + encodeURIComponent(error));
        }

        if (!code) {
            return res.redirect('/admin/dashboard.html?google=error&msg=no_code');
        }

        await googleService.handleCallback(code);
        res.redirect('/admin/dashboard.html?google=connected');

    } catch (error) {
        console.error('❌ Google callback error:', error);
        res.redirect('/admin/dashboard.html?google=error&msg=' + encodeURIComponent(error.message));
    }
};

/**
 * GET /api/google/status — Check connection status
 */
exports.status = async (req, res) => {
    try {
        const connected = await googleService.isConnected();
        res.json({ success: true, connected });
    } catch (error) {
        res.json({ success: true, connected: false });
    }
};

/**
 * POST /api/google/resync — Re-sync customers to Google Contacts
 */
exports.resync = async (req, res) => {
    try {
        const connected = await googleService.isConnected();
        if (!connected) {
            return res.status(400).json({ success: false, error: 'Google Contacts not connected. Please authenticate first via /api/google/auth' });
        }

        // Older versions also marked preserved (incorrectly named) contacts as
        // synced. An explicit full resync repairs those without changing retry's default.
        const syncAll = req.body?.all === true;
        const afterId = req.body?.afterId ?? 0;
        if (!Number.isSafeInteger(afterId) || afterId < 0) {
            return res.status(400).json({ success: false, error: 'Invalid contact cursor' });
        }
        // Keep each HTTP request short; the admin continues with the next cursor.
        const batchSize = 5;
        const { rows } = await db.query(`
            SELECT id, nama_lengkap, whatsapp
            FROM customers
            WHERE whatsapp ~ '^62[0-9]{9,13}$' AND whatsapp !~ '^620*$'
              AND id > $1
              ${syncAll ? '' : 'AND (google_contact_synced = FALSE OR google_contact_synced IS NULL)'}
            ORDER BY id LIMIT 6
        `, [afterId]);
        const customers = rows.slice(0, batchSize);

        let saved = 0, skipped = 0, failed = 0;
        const errors = [];
        const delay = (ms) => new Promise(r => setTimeout(r, ms));

        for (const [index, c] of customers.entries()) {
            try {
                const result = await googleService.saveContact(c);
                if (result.success) {
                    saved++;
                } else if (result.skipped) {
                    skipped++;
                } else {
                    failed++;
                    errors.push({ id: c.id, nama: c.nama_lengkap, error: result.error });
                }
            } catch (err) {
                failed++;
                errors.push({ id: c.id, nama: c.nama_lengkap, error: err.message });
            }
            if (index < customers.length - 1) await delay(1500);
        }

        console.log(`[Re-sync] Done: ${saved} saved, ${skipped} skipped, ${failed} failed out of ${customers.length} customers`);
        res.json({
            success: true,
            total: customers.length,
            saved,
            skipped,
            failed,
            hasMore: rows.length > batchSize,
            nextAfterId: customers.at(-1)?.id ?? afterId,
            errors: errors.slice(0, 20)
        });
    } catch (error) {
        console.error('❌ Google re-sync error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * POST /api/google/disconnect — Disconnect Google account
 */
exports.disconnect = async (req, res) => {
    try {
        await googleService.disconnect();
        res.json({ success: true, message: 'Google account disconnected' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
