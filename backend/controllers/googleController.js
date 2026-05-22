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

        const { rows: customers } = await db.query(`
            SELECT id, nama_lengkap, whatsapp, alamat, tipe, source,
                   merk_unit, tipe_unit, metode_pembayaran
            FROM (
                SELECT c.id, c.nama_lengkap, c.whatsapp, c.alamat, c.tipe, c.source,
                       p.merk_unit, p.tipe_unit, p.metode_pembayaran,
                       ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY p.created_at DESC) AS rn
                FROM customers c
                LEFT JOIN purchases p ON p.customer_id = c.id
                WHERE c.google_contact_synced = FALSE OR c.google_contact_synced IS NULL
            ) sub
            WHERE rn = 1
            ORDER BY id
        `);

        let saved = 0, skipped = 0, failed = 0;
        const errors = [];
        const delay = (ms) => new Promise(r => setTimeout(r, ms));

        for (const c of customers) {
            try {
                const result = await googleService.saveContact(c);
                if (result.success) {
                    saved++;
                } else {
                    skipped++;
                }
            } catch (err) {
                failed++;
                errors.push({ id: c.id, nama: c.nama_lengkap, error: err.message });
            }
            await delay(1500);
        }

        console.log(`[Re-sync] Done: ${saved} saved, ${skipped} skipped, ${failed} failed out of ${customers.length} customers`);
        res.json({
            success: true,
            total: customers.length,
            saved,
            skipped,
            failed,
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
