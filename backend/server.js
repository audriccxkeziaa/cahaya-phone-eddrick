const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

// Force IPv4-first DNS resolution globally. Railway's outbound network doesn't
// route IPv6 — without this, Node's DNS happily returns AAAA records first and
// every outbound TCP connect (SMTP, external APIs, etc.) fails with ENETUNREACH.
// This is the single most-tested fix for "ENETUNREACH 2607:f8b0:...:587" on
// Railway / Heroku / Fly / similar PaaS.
require('dns').setDefaultResultOrder('ipv4first');

const { csrfProtection } = require('./config/csrfMiddleware');

// ============================================
// BOOT-TIME SECRET VALIDATION (fix #5)
// Fail fast if critical secrets are missing or obviously weak.
// ============================================
(function validateSecrets() {
    const jwtSecret = process.env.JWT_SECRET || '';
    if (!jwtSecret || jwtSecret.length < 32) {
        console.error('[BOOT] JWT_SECRET missing or too short (<32 chars). Refusing to start.');
        process.exit(1);
    }
    if (jwtSecret === 'your_super_secret_jwt_key_here_change_in_production') {
        console.error('[BOOT] JWT_SECRET is still the example value. Refusing to start.');
        process.exit(1);
    }
    if (process.env.NODE_ENV === 'production') {
        if (!process.env.WA_BRIDGE_SECRET) {
            console.error('[BOOT] WA_BRIDGE_SECRET required in production. Refusing to start.');
            process.exit(1);
        }
        if (!process.env.ALLOWED_ORIGINS) {
            console.error('[BOOT] ALLOWED_ORIGINS required in production (don\'t leave CORS open). Refusing to start.');
            process.exit(1);
        }
    }
})();

// ============================================
// GLOBAL ERROR HANDLERS — prevent server crash
// ============================================
process.on('uncaughtException', (err) => {
    console.error('[CRASH PREVENTED] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRASH PREVENTED] Unhandled Rejection:', reason);
});

const app = express();

// Trust the first proxy hop (Railway / Vercel / similar PaaS).
// Required so express-rate-limit reads client IP from X-Forwarded-For
// instead of the proxy's IP, and to silence ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// ============================================
// MIDDLEWARE
// ============================================

// Helmet — sets security headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
// CSP is configured manually because admin uses inline event handlers (onclick=...) and
// inline <style> blocks; locking those down would require a much bigger refactor.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'default-src': ["'self'"],
            // Helmet's CSP defaults set script-src-attr to 'none' which blocks ALL
            // inline event handlers (onclick="...", onchange="...", etc). The admin
            // dashboard uses inline handlers heavily, so we explicitly allow them.
            // This is a tradeoff: refactoring every onclick to addEventListener would
            // give us a stricter CSP, but the XSS attack surface is already closed
            // server-side (esc() on every untrusted field).
            'script-src': ["'self'", "'unsafe-inline'"],
            'script-src-attr': ["'unsafe-inline'"],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            'style-src-attr': ["'unsafe-inline'"],
            'font-src': ["'self'", 'https://fonts.gstatic.com'],
            'img-src': ["'self'", 'data:', 'https:'],
            'connect-src': ["'self'", 'https:'],
            'frame-ancestors': ["'none'"],
            'object-src': ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false, // would block fonts.googleapis.com
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Cap request body at 50kb — legitimate form/webhook payloads are well under 5kb.
// Without this cap a bot can POST 100kb bodies repeatedly to fill the DB / OOM the process.
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// Cookie parsing — required for httpOnly auth_token and csrf_token reads.
app.use(cookieParser());

// CORS — izinkan frontend Vercel mengakses backend Railway
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : [];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        // In production, ALLOWED_ORIGINS must be set (validated at boot) and is the only allowlist.
        if (process.env.NODE_ENV === 'production') {
            if (allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
        // Dev mode: if ALLOWED_ORIGINS not set, allow all for convenience
        if (allowedOrigins.length === 0) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Sync-Key', 'X-WA-Secret']
}));

// ============================================
// SERVE STATIC FRONTEND
// Selalu serve frontend files (Vercel, Railway, maupun local dev)
// Nanti kalau frontend pindah ke Vercel terpisah, backend Railway
// tidak perlu serve static lagi — tapi untuk sekarang tetap serve
// ============================================
app.use('/config.js', express.static(path.join(__dirname, '../config.js')));
app.use('/customer', express.static(path.join(__dirname, '../customer')));
app.use('/admin', express.static(path.join(__dirname, '../admin')));

app.get('/', (req, res) => {
    res.redirect('/customer');
});

// Health check
app.get('/api/health', async (req, res) => {
    const db = require('./config/database');
    try {
        const result = await db.query('SELECT NOW() as time');
        const whatsappService = require('./config/whatsapp');
        const waStatus = await whatsappService.getStatus();
        res.json({
            status: 'OK',
            db: 'connected',
            time: result.rows[0].time,
            wa: waStatus.status || 'not initialized',
            mode: process.env.VERCEL ? 'serverless' : 'persistent'
        });
    } catch (err) {
        res.status(500).json({ status: 'ERROR', db: 'failed', error: err.message });
    }
});

// API Routes — CSRF guard runs before routes so any write hits the check.
// Exempt endpoints (login, webhook, public form, sync-by-secret) are handled
// inside csrfProtection().
app.use('/api', csrfProtection, require('./routes/api'));

// Error handling
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong!', details: err.message });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// ============================================
// START SERVER
// ============================================

// Vercel = serverless, export app saja
if (process.env.VERCEL) {
    module.exports = app;
} else {
    // Railway / local dev = persistent server + WA Client
    const cron = require('node-cron');
    const PORT = process.env.PORT || 5000;

    app.listen(PORT, async () => {
        console.log(`
========================================
  Cahaya Phone Backend (Baileys via wa-bridge)
  Running on port ${PORT}
  Mode: PERSISTENT (Railway/Local)
  Bridge: ${process.env.WA_BRIDGE_URL || 'http://localhost:3001'}
========================================
        `);

        // Ensure helper views exist (idempotent — DROP IF EXISTS + CREATE). These
        // make customer purchase data browsable directly in Supabase Table Editor
        // without manually JOINing. Cheap to recreate on every boot.
        const db = require('./config/database');
        try {
            const col = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='google_contact_synced'`);
            if (col.rows.length === 0) {
                await db.query(`ALTER TABLE customers ADD COLUMN google_contact_synced BOOLEAN DEFAULT FALSE`);
                await db.query(`UPDATE customers SET google_contact_synced = TRUE`);
                console.log('[Boot] Added google_contact_synced column, marked all existing customers as synced');
            }
        } catch (_) {}
        try {
            await db.query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS wa_auto_dispatch BOOLEAN DEFAULT NULL`);
            await db.query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS wa_enqueued BOOLEAN DEFAULT FALSE`);
            await db.query(`UPDATE purchases SET wa_enqueued = TRUE WHERE wa_enqueued IS NULL OR wa_auto_dispatch IS NULL`);
        } catch (_) {}
        try {
            await db.query(`
                CREATE OR REPLACE VIEW customer_purchases_detail AS
                SELECT p.id AS purchase_id, p.customer_id,
                       c.nama_lengkap AS customer_nama, c.whatsapp AS customer_whatsapp,
                       c.alamat AS customer_alamat,
                       p.merk_unit, p.tipe_unit, p.harga, p.qty,
                       (COALESCE(p.harga, 0) * COALESCE(p.qty, 1)) AS subtotal,
                       p.nama_sales, p.metode_pembayaran, p.source,
                       (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Makassar') AS purchase_date_wita,
                       p.created_at AS purchase_date_utc
                FROM purchases p
                LEFT JOIN customers c ON c.id = p.customer_id
            `);
            await db.query(`
                CREATE OR REPLACE VIEW customer_summary AS
                SELECT c.id, c.nama_lengkap, c.whatsapp, c.tipe, c.status, c.source,
                       c.alamat, c.tanggal_lahir,
                       COALESCE(agg.purchase_count, 0) AS total_purchases,
                       COALESCE(agg.total_qty, 0) AS total_unit_bought,
                       COALESCE(agg.total_spent, 0) AS total_spent,
                       agg.last_purchase_at,
                       c.last_incoming_message_at, c.created_at, c.updated_at
                FROM customers c
                LEFT JOIN (
                    SELECT customer_id, COUNT(*) AS purchase_count,
                           SUM(COALESCE(qty, 1)) AS total_qty,
                           SUM(COALESCE(harga, 0) * COALESCE(qty, 1)) AS total_spent,
                           MAX(created_at) AS last_purchase_at
                    FROM purchases GROUP BY customer_id
                ) agg ON agg.customer_id = c.id
            `);
            console.log('[Boot] Browser-friendly views ensured (customer_purchases_detail, customer_summary)');
        } catch (viewErr) {
            console.warn('[Boot] Could not create views:', viewErr.message);
        }

        // Cleanup: convert stale boot-reconciliation auto entries to manual.
        // Previous deploys auto-created QUEUED auto_dispatch=TRUE entries that
        // may have used the wrong toggle state. Convert them to manual so the
        // admin controls when they're sent.
        try {
            const { rowCount: converted } = await db.query(`
                UPDATE whatsapp_logs
                SET auto_dispatch = FALSE, updated_at = NOW()
                WHERE type = 'auto_reply'
                  AND status = 'QUEUED'
                  AND auto_dispatch = TRUE
                  AND sent_at IS NULL
                  AND phone IN (
                      SELECT phone FROM whatsapp_logs
                      WHERE type = 'auto_reply' AND status = 'SENT'
                      GROUP BY phone
                  )
            `);
            if (converted > 0) {
                console.log(`[Boot] Converted ${converted} stale auto entries to manual (customers with already-sent auto-replies)`);
            }
        } catch (cleanupErr) {
            console.warn('[Boot] Stale entry cleanup failed:', cleanupErr.message);
        }

        // Auto-reconcile: create missing auto-reply queue entries on boot.
        // Reads wa_auto_dispatch from purchases (snapshot of toggle at submit time).
        try {
            const whatsappSvc = require('./config/whatsapp');

            const { rows: pending } = await db.query(`
                SELECT p.id AS purchase_id, p.wa_auto_dispatch,
                       c.nama_lengkap, c.whatsapp
                FROM purchases p
                JOIN customers c ON c.id = p.customer_id
                WHERE c.tipe = 'Belanja'
                  AND p.wa_enqueued = FALSE
                  AND p.wa_auto_dispatch IS NOT NULL
                ORDER BY p.created_at
            `);

            let totalCreated = 0;
            for (const row of pending) {
                const result = await whatsappSvc.enqueueAutoReply(
                    { nama_lengkap: row.nama_lengkap, whatsapp: row.whatsapp },
                    { autoDispatch: row.wa_auto_dispatch, skipNumberCheck: true }
                ).catch(() => ({ success: false }));
                if (result && result.success) {
                    await db.query('UPDATE purchases SET wa_enqueued = TRUE WHERE id = $1', [row.purchase_id]).catch(() => {});
                    totalCreated++;
                }
            }
            if (totalCreated > 0) {
                console.log(`[Boot] Auto-reconcile: enqueued ${totalCreated} pending auto-reply entries`);
            }
        } catch (reconcileErr) {
            console.warn('[Boot] Auto-reply reconcile failed:', reconcileErr.message);
        }

        // Auto-reconcile: enqueue missing birthday greetings for today.
        try {
            const birthdayController = require('./controllers/birthdayController');
            if (typeof birthdayController.enqueueTodayBirthdays === 'function') {
                await birthdayController.enqueueTodayBirthdays();
                console.log('[Boot] Birthday queue reconciled for today');
            }
        } catch (bdayErr) {
            console.warn('[Boot] Birthday reconcile failed:', bdayErr.message);
        }

        // Initialize WA service (HTTP adapter to wa-bridge)
        try {
            const whatsappService = require('./config/whatsapp');
            await whatsappService.loadSettings();

            const status = await whatsappService.getStatus();
            if (status.status === 'connected') {
                console.log('[WA] Bridge connected and ready (Baileys)');
            } else if (status.status === 'bridge_unreachable') {
                console.warn('[WA] Bridge unreachable — set WA_BRIDGE_URL di .env dan pastikan wa-bridge running');
            } else {
                console.warn(`[WA] Bridge status: ${status.status} — scan QR di admin dashboard → WA Connect`);
            }

            // Start anti-ban orchestrator
            const waWorker = require('./config/wa-worker');
            await waWorker.start();
        } catch (err) {
            console.error('[WA] Failed to initialize WhatsApp service:', err.message);
        }

        // Birthday greeting cron — setiap hari jam 9 pagi WITA (1 jam margin after 08:00 working hours open)
        const birthdayController = require('./controllers/birthdayController');
        cron.schedule('0 9 * * *', () => {
            console.log('[Cron] Running birthday check (scheduled)...');
            birthdayController.cronCheckBirthdays();
        }, { timezone: 'Asia/Makassar' });
        console.log('[Cron] Birthday greeting scheduled: every day at 09:00 WITA');

        // Boot-time recovery: if Railway restarted mid-batch today, finish whatever
        // birthdays haven't been greeted yet. cronCheckBirthdays already filters to
        // "pending or failed for THIS year" so re-running is idempotent and won't
        // duplicate-send.
        setTimeout(() => {
            birthdayController.cronCheckBirthdays().catch(err =>
                console.warn('[Boot] Birthday recovery error:', err.message)
            );
        }, 60_000);   // wait 1 min after boot so wa-bridge has time to connect

        // Safety net: re-check birthdays every 2 hours during working hours, in case
        // some sends failed (number not registered, bridge hiccup) and need a retry.
        cron.schedule('0 11,13,15,17,19 * * *', () => {
            console.log('[Cron] Running birthday safety-net retry...');
            birthdayController.cronCheckBirthdays();
        }, { timezone: 'Asia/Makassar' });

        // Monthly auto-cleanup — 1st of month at 03:00 WITA (low traffic window).
        // Deletes messages/logs/broadcasts older than 30 days, audit logs older than
        // 90 days. Idempotent; NEVER touches customers / purchases / admin records.
        // Critical to keep us under Supabase free-tier 500MB limit indefinitely.
        const adminControllerForCron = require('./controllers/adminController');
        cron.schedule('0 3 1 * *', () => {
            adminControllerForCron.cronMonthlyCleanup();
        }, { timezone: 'Asia/Makassar' });
        console.log('[Cron] Auto-cleanup scheduled: 1st of each month at 03:00 WITA');
    });
}
