// ============================================
// ADMIN CONTROLLER
// Handle admin authentication & data
// ============================================

const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const whatsappService = require('../config/whatsapp');
const { sanitizePhone } = require('../utils/phoneUtils');
const { setAuthCookie, issueCsrfToken, clearAuthCookies, safeEqual } = require('../config/csrfMiddleware');

// Password complexity policy — min 8 chars + at least one letter + one digit.
// Prevents trivial credentials like "12345678" or "password".
function validatePasswordStrength(pw) {
    if (typeof pw !== 'string' || pw.length < 8) {
        return { valid: false, message: 'Password minimal 8 karakter.' };
    }
    if (pw.length > 128) {
        return { valid: false, message: 'Password terlalu panjang (maks 128 karakter).' };
    }
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
        return { valid: false, message: 'Password harus berisi minimal 1 huruf dan 1 angka.' };
    }
    return { valid: true };
}

const VALID_STATUSES = ['New', 'Contacted', 'Follow Up', 'Completed', 'Inactive'];

async function _syncCustomerSummary(customerId) {
    const { rows } = await db.query(
        `SELECT merk_unit, tipe_unit, harga, qty, nama_sales, metode_pembayaran, source
         FROM purchases
         WHERE customer_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [customerId]
    );

    if (rows.length === 0) {
        await db.query(
            `UPDATE customers SET merk_unit = NULL, tipe_unit = NULL, harga = NULL, qty = NULL,
                nama_sales = NULL, metode_pembayaran = NULL,
                updated_at = NOW()
             WHERE id = $1`,
            [customerId]
        );
        return;
    }

    const latest = rows[0];
    await db.query(
        `UPDATE customers SET
             merk_unit = $1,
             tipe_unit = $2,
             harga = $3,
             qty = $4,
             nama_sales = $5,
             metode_pembayaran = $6,
             source = COALESCE($7, source, ''),
             updated_at = NOW()
         WHERE id = $8`,
        [latest.merk_unit, latest.tipe_unit, latest.harga, latest.qty,
         latest.nama_sales, latest.metode_pembayaran, latest.source,
         customerId]
    );
}

async function _trimCustomerAutoReplyQueue(phone, maxPending) {
    const normalizedPhone = sanitizePhone(phone);
    if (!normalizedPhone || maxPending < 0) return;

    const { rows } = await db.query(
        `SELECT id FROM whatsapp_logs
         WHERE phone = $1 AND type = 'auto_reply' AND status IN ('QUEUED','FAILED')
         ORDER BY id ASC`,
        [normalizedPhone]
    );

    if (rows.length <= maxPending) return;
    const toDelete = rows.slice(maxPending).map(r => r.id);
    await db.query(`DELETE FROM whatsapp_logs WHERE id = ANY($1::int[])`, [toDelete]);
}

// ============================================
// ANTI-SPAM: Message variation helpers
// ============================================
const RANDOM_GREETINGS = [
    '', '', // empty = no prefix (keeps original message)
    'Halo Kak, ', 'Hi Kak, ', 'Hai Kak, ', 'Halo, ', 'Hai, ',
    'Halo Kak! ', 'Hi! ', 'Hai! ', 'Hey Kak, ',
    'Selamat siang Kak, ', 'Selamat sore Kak, ',
    'Assalamualaikum Kak, ', 'Permisi Kak, ',
];

const RANDOM_CLOSINGS = [
    '', // empty = no closing
    ' 😊', ' 🙏', ' ✨', ' 👍', ' 🔥', ' 💯', ' 🎉', ' ❤️',
    ' 😁', ' 🤗', ' 👋', ' 💪', ' ⭐', ' 🌟', ' 📱', ' 🛒',
    '\n\nTerima kasih! 🙏', '\n\nSalam hangat! 😊', '\n\nSukses selalu! ✨',
    '\n\nDitunggu ya Kak! 👋', '\n\nYuk mampir! 🔥', '\n\nInfo lanjut hubungi kami ya 📱',
];

const RANDOM_FILLERS = [
    '', '', '', // mostly empty
    ' nih', ' ya', ' lho', ' dong', ' yuk', ' nih Kak',
];

/**
 * Add subtle random variations to broadcast message so each one is unique
 * Prevents WhatsApp from detecting identical bulk messages
 */
function variasiPesan(message, customerName) {
    let msg = message.replace(/{nama}/gi, customerName || 'Kak');

    // Random greeting prefix (only if message doesn't already start with greeting)
    const startsWithGreeting = /^(halo|hai|hi|hey|selamat|assalam|permisi)/i.test(msg);
    if (!startsWithGreeting) {
        const greeting = RANDOM_GREETINGS[Math.floor(Math.random() * RANDOM_GREETINGS.length)];
        if (greeting) msg = greeting + msg;
    }

    // Random filler word inserted after first sentence (before first period/newline)
    const filler = RANDOM_FILLERS[Math.floor(Math.random() * RANDOM_FILLERS.length)];
    if (filler) {
        const firstBreak = msg.search(/[.!\n]/);
        if (firstBreak > 10) {
            msg = msg.slice(0, firstBreak) + filler + msg.slice(firstBreak);
        }
    }

    // Random closing/emoji at end
    const closing = RANDOM_CLOSINGS[Math.floor(Math.random() * RANDOM_CLOSINGS.length)];
    msg = msg + closing;

    // Random invisible variation: add 1-3 zero-width spaces at random positions
    const zwsp = '\u200B';
    const numZwsp = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numZwsp; i++) {
        const pos = Math.floor(Math.random() * msg.length);
        msg = msg.slice(0, pos) + zwsp + msg.slice(pos);
    }

    return msg;
}

/**
 * Random delay between min-max milliseconds (anti-spam)
 */
function randomDelay(minMs, maxMs) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Get total messages sent today (for soft warning)
 */
async function getDailySentCount() {
    const { rows } = await db.query(
        `SELECT COUNT(*) as count FROM broadcast_recipients
         WHERE status = 'sent' AND (sent_at AT TIME ZONE 'Asia/Makassar')::date = (NOW() AT TIME ZONE 'Asia/Makassar')::date`
    );
    return parseInt(rows[0].count) || 0;
}

/**
 * Build WHERE clause from export/filter query params
 */
function buildExportFilter(query) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (query.source) {
        conditions.push(`source = $${idx++}`);
        params.push(query.source);
    }
    if (query.status) {
        conditions.push(`status = $${idx++}`);
        params.push(query.status);
    }
    if (query.date_from) {
        conditions.push(`created_at >= $${idx++}`);
        params.push(query.date_from);
    }
    if (query.date_to) {
        conditions.push(`created_at < ($${idx++})::date + 1`);
        params.push(query.date_to);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    return { where, params };
}

/**
 * Login admin
 * POST /api/admin/login
 */
exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        console.log('🔐 Login attempt:', username);

        const { rows: admins } = await db.query(
            'SELECT * FROM admins WHERE username = $1',
            [username]
        );

        if (admins.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Username atau password salah'
            });
        }

        const admin = admins[0];

        const isValid = await bcrypt.compare(password, admin.password);

        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: 'Username atau password salah'
            });
        }

        const token = jwt.sign(
            { id: admin.id, username: admin.username, role: admin.role || 'staff' },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        // Set httpOnly auth cookie (not reachable from JS — XSS can't steal it)
        // plus a CSRF token cookie that the frontend echoes back on every write.
        setAuthCookie(res, token);
        const csrfToken = issueCsrfToken(res);

        console.log('✅ Login successful:', username, '| role:', admin.role);

        res.json({
            success: true,
            message: 'Login berhasil',
            csrf_token: csrfToken,   // frontend stores in memory + uses on writes
            admin: {
                id: admin.id,
                username: admin.username,
                nama: admin.nama,
                email: admin.email,
                role: admin.role || 'staff'
            }
        });

    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan server'
        });
    }
};

/**
 * Get dashboard statistics
 * GET /api/admin/stats
 */
exports.getStats = async (req, res) => {
    try {
        // Auto-update statuses based on last activity
        // Contacted → Follow Up: 3 days no messages
        await db.query(`
            UPDATE customers SET status = 'Follow Up'
            WHERE status = 'Contacted' AND tipe = 'Chat Only'
            AND id NOT IN (
                SELECT DISTINCT customer_id FROM messages
                WHERE sent_at > NOW() - INTERVAL '3 days'
            )
            AND created_at < NOW() - INTERVAL '3 days'
        `);

        // Follow Up → Inactive: 7 days no messages
        await db.query(`
            UPDATE customers SET status = 'Inactive'
            WHERE status = 'Follow Up' AND tipe = 'Chat Only'
            AND id NOT IN (
                SELECT DISTINCT customer_id FROM messages
                WHERE sent_at > NOW() - INTERVAL '7 days'
            )
            AND created_at < NOW() - INTERVAL '7 days'
        `);

        const { rows } = await db.query('SELECT * FROM customer_stats');

        // Pipeline stats from customers (registration-based: pipeline status, customer counts)
        const { rows: pipeline } = await db.query(`
            SELECT
                COUNT(*) FILTER (WHERE status IN ('New','Contacted','Follow Up')) as pipeline_active,
                COUNT(*) FILTER (WHERE status = 'Completed') as pipeline_success,
                COUNT(*) FILTER (WHERE status = 'Inactive') as pipeline_lost,

                -- New customer registrations
                COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())) as total_bulan_ini,
                COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW())) as total_bulan_lalu,
                COUNT(*) FILTER (WHERE status IN ('New','Contacted','Follow Up') AND created_at >= DATE_TRUNC('month', NOW())) as active_bulan_ini,
                COUNT(*) FILTER (WHERE status IN ('New','Contacted','Follow Up') AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW())) as active_bulan_lalu,

                -- Tipe
                COUNT(*) FILTER (WHERE tipe = 'Belanja') as total_belanja,
                COUNT(*) FILTER (WHERE tipe = 'Chat Only') as total_chat_only,

                -- Per status detail
                COUNT(*) FILTER (WHERE status = 'New') as status_new,
                COUNT(*) FILTER (WHERE status = 'Contacted') as status_contacted,
                COUNT(*) FILTER (WHERE status = 'Follow Up') as status_follow_up,
                COUNT(*) FILTER (WHERE status = 'Completed') as status_completed,
                COUNT(*) FILTER (WHERE status = 'Inactive') as status_inactive
            FROM customers
        `);

        // Sales stats from purchases (transaction-date based: omzet & success counts).
        // Repeat orders attribute to the actual purchase month, not customer registration month.
        const { rows: sales } = await db.query(`
            SELECT
                COALESCE(SUM(harga * COALESCE(qty, 1)), 0) as total_omzet,
                COALESCE(SUM(harga * COALESCE(qty, 1)) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())), 0) as omzet_bulan_ini,
                COALESCE(SUM(harga * COALESCE(qty, 1)) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW())), 0) as omzet_bulan_lalu,
                COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())) as success_bulan_ini,
                COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW())) as success_bulan_lalu
            FROM purchases
        `);

        res.json({
            success: true,
            data: { ...rows[0], ...pipeline[0], ...sales[0] }
        });

    } catch (error) {
        console.error('❌ Stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil statistik'
        });
    }
};

/**
 * Get monthly pipeline breakdown
 * GET /api/admin/pipeline/monthly
 */
exports.getPipelineMonthly = async (req, res) => {
    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // 1..12

        // Year filter (default = current). Archive years return all 12 months.
        const reqYear = parseInt(req.query.year, 10);
        const year = Number.isFinite(reqYear) ? reqYear : currentYear;
        const isArchive = year < currentYear;
        const isFuture = year > currentYear;

        // Determine [start, end] month range:
        //  - Current year: from current month → December
        //  - Past year (archive): full Jan → December
        //  - Future year: full Jan → December (rare; for forward planning)
        const startMonth = (year === currentYear) ? currentMonth : 1;
        const endMonth = 12;

        const { rows } = await db.query(`
            WITH months AS (
                SELECT generate_series(
                    make_date($1::int, $2::int, 1),
                    make_date($1::int, $3::int, 1),
                    INTERVAL '1 month'
                ) AS month_start
            ),
            cust AS (
                SELECT
                    DATE_TRUNC('month', created_at) AS month_start,
                    COUNT(*) FILTER (WHERE status = 'Completed') AS sukses,
                    COUNT(*) FILTER (WHERE status IN ('New','Contacted','Follow Up')) AS active,
                    COUNT(*) FILTER (WHERE status = 'Inactive') AS lost,
                    COUNT(*) AS total
                FROM customers
                WHERE EXTRACT(YEAR FROM created_at) = $1
                GROUP BY DATE_TRUNC('month', created_at)
            ),
            omz AS (
                SELECT
                    DATE_TRUNC('month', created_at) AS month_start,
                    COALESCE(SUM(harga * COALESCE(qty, 1)), 0) AS omzet
                FROM purchases
                WHERE EXTRACT(YEAR FROM created_at) = $1
                GROUP BY DATE_TRUNC('month', created_at)
            )
            SELECT
                TO_CHAR(m.month_start, 'YYYY-MM') AS bulan,
                TO_CHAR(m.month_start, 'Mon YYYY') AS label,
                COALESCE(c.sukses, 0)::int AS sukses,
                COALESCE(c.active, 0)::int AS active,
                COALESCE(c.lost, 0)::int AS lost,
                COALESCE(c.total, 0)::int AS total,
                COALESCE(o.omzet, 0) AS omzet
            FROM months m
            LEFT JOIN cust c ON c.month_start = m.month_start
            LEFT JOIN omz o ON o.month_start = m.month_start
            ORDER BY m.month_start ASC
        `, [year, startMonth, endMonth]);

        // List all years that have data (for year selector)
        const { rows: yearsRows } = await db.query(`
            SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int AS year
            FROM customers
            WHERE created_at IS NOT NULL
            ORDER BY year DESC
        `);
        const availableYears = yearsRows.map(r => r.year);
        if (!availableYears.includes(currentYear)) availableYears.unshift(currentYear);

        res.json({
            success: true,
            data: rows,
            meta: {
                year,
                currentYear,
                currentMonth,
                isArchive,
                isFuture,
                availableYears
            }
        });
    } catch (error) {
        console.error('❌ Pipeline monthly error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data pipeline' });
    }
};

/**
 * Get all customers
 * GET /api/admin/customers
 */
exports.getCustomers = async (req, res) => {
    try {
        // Customers table = latest snapshot per row. ALL historical purchases live in
        // `purchases` table — we aggregate count + total_spent so the dashboard list
        // shows the full picture (latest item shown, plus "5 transaksi · Rp 32jt")
        // instead of looking like data only saves the latest purchase.
        const { rows: customers } = await db.query(
            `SELECT c.id, c.nama_lengkap, c.nama_sales, c.merk_unit, c.tipe_unit,
                c.harga, c.qty, c.whatsapp, c.metode_pembayaran,
                c.source, c.status, c.tipe, c.created_at, c.catatan, c.wa_sent,
                c.last_incoming_message_at,
                COALESCE(p.purchase_count, 0)::int as purchase_count,
                COALESCE(p.total_spent, 0)::bigint as total_spent,
                COALESCE(p.total_qty, 0)::int as total_qty,
                p.last_purchase_at,
                COALESCE(p.purchases_json, '[]'::json) as purchases
            FROM customers c
            LEFT JOIN (
                SELECT customer_id,
                       COUNT(*) as purchase_count,
                       SUM(COALESCE(harga, 0) * COALESCE(qty, 1)) as total_spent,
                       SUM(COALESCE(qty, 1)) as total_qty,
                       MAX(created_at) as last_purchase_at,
                       json_agg(
                           json_build_object(
                                'id', id,
                                'merk_unit', merk_unit,
                                'tipe_unit', tipe_unit,
                                'harga', harga,
                                'qty', qty
                            ) ORDER BY created_at DESC       
                        ) as purchases_json    
                FROM purchases GROUP BY customer_id
            ) p ON p.customer_id = c.id
            ORDER BY COALESCE(p.last_purchase_at, c.last_incoming_message_at, c.created_at) DESC`
        );

        res.json({
            success: true,
            data: customers
        });

    } catch (error) {
        console.error('❌ Get customers error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data customer'
        });
    }
};

/**
 * Get customer detail by ID
 * GET /api/admin/customers/:id
 */
exports.getCustomerById = async (req, res) => {
    try {
        const { id } = req.params;

        const { rows: customers } = await db.query(
            'SELECT * FROM customers WHERE id = $1',
            [id]
        );

        if (customers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }

        // Include purchase history
        const { rows: purchases } = await db.query(
            `SELECT id, merk_unit, tipe_unit, harga, qty, nama_sales, metode_pembayaran, source, created_at
             FROM purchases WHERE customer_id = $1 ORDER BY created_at DESC`,
            [id]
        );

        res.json({
            success: true,
            data: { ...customers[0], purchases, purchase_count: purchases.length }
        });

    } catch (error) {
        console.error('❌ Get customer error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data customer'
        });
    }
};

/**
 * Update customer detail fields
 * PATCH /api/admin/customers/:id
 */
exports.updateCustomer = async (req, res) => {
    try {
        const { id } = req.params;
        const fields = {};
        const allowed = ['nama_lengkap', 'nama_sales', 'alamat', 'tanggal_lahir', 'metode_pembayaran', 'tahu_dari', 'source', 'tipe', 'status', 'catatan'];
        const params = [];
        let index = 1;

        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                fields[key] = req.body[key] || null;
                params.push(fields[key]);
            }
        }

        if (Object.keys(fields).length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada field untuk diperbarui' });
        }

        if (fields.status && !VALID_STATUSES.includes(fields.status)) {
            return res.status(400).json({ success: false, message: `Status tidak valid. Pilihan: ${VALID_STATUSES.join(', ')}` });
        }

        const sets = Object.keys(fields).map((key, idx) => `${key} = $${idx + 1}`);
        params.push(id);

        const { rowCount } = await db.query(
            `UPDATE customers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
            params
        );

        if (rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan' });
        }

        const { rows } = await db.query('SELECT * FROM customers WHERE id = $1', [id]);
        res.json({ success: true, message: 'Customer berhasil diperbarui', data: rows[0] });
    } catch (error) {
        console.error('❌ Update customer error:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui customer' });
    }
};

/**
 * Replace customer purchase list and reconcile queue counts
 * PUT /api/admin/customers/:id/purchases
 * Body: { purchases: [{ id?, merk_unit, tipe_unit, harga, qty, nama_sales, metode_pembayaran, source, deleted? }] }
 */
exports.saveCustomerPurchases = async (req, res) => {
    try {
        const { id } = req.params;
        const { purchases } = req.body;
        if (!Array.isArray(purchases)) {
            return res.status(400).json({ success: false, message: 'Field purchases harus dalam format array' });
        }

        const { rows: customerRows } = await db.query('SELECT id, nama_lengkap, whatsapp FROM customers WHERE id = $1', [id]);
        if (customerRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan' });
        }

        const customerPhone = customerRows[0].whatsapp;
        const customerName = customerRows[0].nama_lengkap;
        const existingRows = await db.query('SELECT id FROM purchases WHERE customer_id = $1', [id]);
        const existingIds = new Set(existingRows.rows.map(r => r.id));

        const inserts = [];
        const updates = [];
        const deletes = [];

        for (const item of purchases) {
            if (item.id && existingIds.has(item.id)) {
                if (item.deleted) {
                    deletes.push(item.id);
                } else {
                    updates.push(item);
                }
            } else if (!item.id && !item.deleted) {
                inserts.push(item);
            }
        }

        const remainingPurchases = purchases.filter(p => !p.deleted).length;

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            for (const purchase of updates) {
                const parsedHarga = purchase.harga !== undefined && purchase.harga !== null && purchase.harga !== ''
                    ? parseFloat(purchase.harga)
                    : null;
                const parsedQty = purchase.qty !== undefined && purchase.qty !== null && purchase.qty !== ''
                    ? parseInt(purchase.qty, 10)
                    : 1;

                await client.query(
                    `UPDATE purchases SET merk_unit = $1, tipe_unit = $2, harga = $3, qty = $4,
                        nama_sales = $5, metode_pembayaran = $6, source = $7
                     WHERE id = $8 AND customer_id = $9`,
                    [purchase.merk_unit || null, purchase.tipe_unit || null, parsedHarga, parsedQty,
                     purchase.nama_sales || null, purchase.metode_pembayaran || null, purchase.source || null,
                     purchase.id, id]
                );
            }

            if (deletes.length > 0) {
                await client.query(`DELETE FROM purchases WHERE id = ANY($1::int[]) AND customer_id = $2`, [deletes, id]);
            }

            for (const purchase of inserts) {
                const parsedHarga = purchase.harga !== undefined && purchase.harga !== null && purchase.harga !== ''
                    ? parseFloat(purchase.harga)
                    : null;
                const parsedQty = purchase.qty !== undefined && purchase.qty !== null && purchase.qty !== ''
                    ? parseInt(purchase.qty, 10)
                    : 1;

                await client.query(
                    `INSERT INTO purchases (customer_id, merk_unit, tipe_unit, harga, qty, nama_sales, metode_pembayaran, source)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [id, purchase.merk_unit || null, purchase.tipe_unit || null, parsedHarga, parsedQty,
                     purchase.nama_sales || null, purchase.metode_pembayaran || null, purchase.source || null]
                );
            }

            if (remainingPurchases > 0) {
                if (inserts.length > 0) {
                    await client.query(
                        `UPDATE customers
                         SET wa_sent = FALSE,
                             status = 'Completed',
                             updated_at = NOW()
                         WHERE id = $1 AND wa_sent IS NOT NULL`,
                        [id]
                    );
                } else {
                    await client.query(
                        `UPDATE customers
                         SET status = 'Completed',
                             updated_at = NOW()
                         WHERE id = $1`,
                        [id]
                    );
                }
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }

        // Enqueue FIRST (right after commit) so sync/trim failures can't block it
        if (inserts.length > 0) {
            try {
                const toggleRes = await db.query(`SELECT value FROM app_settings WHERE key = 'form_autoreply_enabled'`);
                const isAutoOn = toggleRes.rows.length === 0 || toggleRes.rows[0].value !== 'false';
                console.log(`[Purchase] Enqueue ${inserts.length} auto-reply for ${customerPhone}: toggle=${isAutoOn ? 'ON' : 'OFF'} → auto_dispatch=${isAutoOn}`);
                for (let i = 0; i < inserts.length; i++) {
                    const enqRes = await whatsappService.enqueueAutoReply(
                        { nama_lengkap: customerName, whatsapp: customerPhone },
                        { autoDispatch: isAutoOn, skipNumberCheck: true }
                    ).catch(e => { console.warn(`[Purchase] Enqueue auto-reply failed: ${e.message}`); return null; });
                    console.log(`[Purchase] Enqueue result #${i + 1}:`, enqRes?.success ? `OK (log_id=${enqRes.log_id}, auto=${enqRes.auto_dispatch})` : `FAIL (${enqRes?.error || 'null'})`);
                }
            } catch (e) {
                console.warn('[Purchase] Auto-reply enqueue error:', e.message);
            }
        }

        // Non-critical post-commit sync — failures logged but don't block response
        try { await _syncCustomerSummary(id); } catch (e) { console.warn('[Purchase] _syncCustomerSummary failed:', e.message); }
        try { await _trimCustomerAutoReplyQueue(customerPhone, remainingPurchases); } catch (e) { console.warn('[Purchase] _trimQueue failed:', e.message); }

        const { rows: updatedCustomer } = await db.query('SELECT * FROM customers WHERE id = $1', [id]);
        const { rows: updatedPurchases } = await db.query(
            `SELECT id, merk_unit, tipe_unit, harga, qty, nama_sales, metode_pembayaran, source, created_at
             FROM purchases WHERE customer_id = $1 ORDER BY created_at DESC`,
            [id]
        );

        res.json({
            success: true,
            message: 'Data pembelian customer berhasil disimpan',
            data: { customer: updatedCustomer[0], purchases: updatedPurchases }
        });
    } catch (error) {
        console.error('❌ Save customer purchases error:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan data pembelian' });
    }
};

/**
 * Update customer status
 * PATCH /api/admin/customers/:id/status
 */
exports.updateCustomerStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !VALID_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Status tidak valid. Pilihan: ${VALID_STATUSES.join(', ')}`
            });
        }

        const { rowCount } = await db.query(
            'UPDATE customers SET status = $1, updated_at = NOW() WHERE id = $2',
            [status, id]
        );

        if (rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan' });
        }

        res.json({ success: true, message: 'Status berhasil diubah', data: { id: Number(id), status } });
    } catch (error) {
        console.error('❌ Update status error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengubah status' });
    }
};

/**
 * Update customer notes (catatan)
 * PATCH /api/admin/customers/:id/catatan
 */
exports.updateCustomerCatatan = async (req, res) => {
    try {
        const { id } = req.params;
        const { catatan } = req.body;

        const { rowCount } = await db.query(
            'UPDATE customers SET catatan = $1, updated_at = NOW() WHERE id = $2',
            [catatan || null, id]
        );

        if (rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan' });
        }

        res.json({ success: true, message: 'Catatan berhasil disimpan' });
    } catch (error) {
        console.error('❌ Update catatan error:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan catatan' });
    }
};

/**
 * Get all messages (chat log)
 * GET /api/admin/messages
 */
exports.getMessages = async (req, res) => {
    try {
        const { rows: messages } = await db.query(
            `SELECT
                m.id, m.customer_id, m.direction, m.message, m.sent_at,
                c.nama_lengkap, c.whatsapp
            FROM messages m
            JOIN customers c ON m.customer_id = c.id
            ORDER BY m.sent_at DESC
            LIMIT 100`
        );

        res.json({
            success: true,
            data: messages
        });

    } catch (error) {
        console.error('❌ Get messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data pesan'
        });
    }
};

/**
 * Update admin profile (name + email)
 * PATCH /api/admin/profile
 * Body: { nama?: string, email?: string }
 */
exports.updateProfile = async (req, res) => {
    try {
        const { nama, email } = req.body;
        const adminId = req.admin && req.admin.id;

        if (!adminId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const updates = [];
        const params = [];
        let i = 1;

        if (typeof nama === 'string') {
            if (!nama.trim()) return res.status(400).json({ success: false, message: 'Nama tidak boleh kosong' });
            updates.push(`nama = $${i++}`); params.push(nama.trim());
        }

        if (typeof email === 'string') {
            const trimmed = email.trim().toLowerCase();
            if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                return res.status(400).json({ success: false, message: 'Format email tidak valid' });
            }
            const emailValue = trimmed || null;

            if (emailValue) {
                const { rows: dup } = await db.query(
                    'SELECT id FROM admins WHERE LOWER(email) = $1 AND id != $2',
                    [emailValue, adminId]
                );
                if (dup.length > 0) {
                    return res.status(409).json({ success: false, message: 'Email sudah dipakai admin lain' });
                }
            }
            updates.push(`email = $${i++}`); params.push(emailValue);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada field untuk diperbarui' });
        }

        params.push(adminId);
        await db.query(`UPDATE admins SET ${updates.join(', ')} WHERE id = $${i}`, params);

        const { rows } = await db.query('SELECT id, username, nama, email, role FROM admins WHERE id = $1', [adminId]);
        res.json({ success: true, message: 'Profil diperbarui', data: rows[0] });
    } catch (error) {
        console.error('❌ Update profile error:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui profil' });
    }
};

// ============================================
// ADMIN MANAGEMENT (owner-only, max 3 admins)
// ============================================

const MAX_ADMINS = 3;

function ownerOnly(req, res) {
    if (!req.admin || req.admin.role !== 'owner') {
        res.status(403).json({ success: false, message: 'Hanya owner yang bisa akses' });
        return false;
    }
    return true;
}

/**
 * GET /api/admin/admins  — list all admins (owner-only)
 */
exports.listAdmins = async (req, res) => {
    if (!ownerOnly(req, res)) return;
    try {
        const { rows } = await db.query(
            'SELECT id, username, nama, email, role, created_at FROM admins ORDER BY id ASC'
        );
        res.json({ success: true, data: rows, max: MAX_ADMINS });
    } catch (error) {
        console.error('❌ List admins error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data admin' });
    }
};

/**
 * POST /api/admin/admins  — create new admin (owner-only)
 * Body: { username, password, nama, email }
 */
exports.createAdmin = async (req, res) => {
    if (!ownerOnly(req, res)) return;
    try {
        const { username, password, nama, email } = req.body || {};
        if (!username || !password || !nama || !email) {
            return res.status(400).json({ success: false, message: 'Username, password, nama, email wajib diisi' });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
        }
        const cleanEmail = String(email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({ success: false, message: 'Format email tidak valid' });
        }

        const { rows: count } = await db.query('SELECT COUNT(*)::int AS n FROM admins');
        if (count[0].n >= MAX_ADMINS) {
            return res.status(409).json({ success: false, message: `Maksimal ${MAX_ADMINS} admin` });
        }

        const { rows: dupU } = await db.query('SELECT id FROM admins WHERE username = $1', [String(username).trim()]);
        if (dupU.length) return res.status(409).json({ success: false, message: 'Username sudah dipakai' });

        const { rows: dupE } = await db.query('SELECT id FROM admins WHERE LOWER(email) = $1', [cleanEmail]);
        if (dupE.length) return res.status(409).json({ success: false, message: 'Email sudah dipakai' });

        const pwCheck = validatePasswordStrength(String(password));
        if (!pwCheck.valid) return res.status(400).json({ success: false, message: pwCheck.message });

        const hashed = await bcrypt.hash(String(password), 12);
        const { rows } = await db.query(
            `INSERT INTO admins (username, password, nama, email, role)
             VALUES ($1, $2, $3, $4, 'staff')
             RETURNING id, username, nama, email, role, created_at`,
            [String(username).trim(), hashed, String(nama).trim(), cleanEmail]
        );
        res.json({ success: true, message: 'Admin baru ditambahkan', data: rows[0] });
    } catch (error) {
        console.error('❌ Create admin error:', error);
        res.status(500).json({ success: false, message: 'Gagal menambah admin' });
    }
};

/**
 * PATCH /api/admin/admins/:id  — update admin (owner-only)
 * Body: { nama?, email?, password? }  — owner cannot demote/delete themselves via this route
 */
exports.updateAdmin = async (req, res) => {
    if (!ownerOnly(req, res)) return;
    try {
        const targetId = parseInt(req.params.id, 10);
        const { nama, email, password } = req.body || {};

        const { rows: target } = await db.query('SELECT id, role FROM admins WHERE id = $1', [targetId]);
        if (target.length === 0) return res.status(404).json({ success: false, message: 'Admin tidak ditemukan' });

        const updates = [];
        const params = [];
        let i = 1;

        if (typeof nama === 'string' && nama.trim()) {
            updates.push(`nama = $${i++}`); params.push(nama.trim());
        }
        if (typeof email === 'string') {
            const cleanEmail = email.trim().toLowerCase();
            if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
                return res.status(400).json({ success: false, message: 'Format email tidak valid' });
            }
            const emailValue = cleanEmail || null;
            if (emailValue) {
                const { rows: dup } = await db.query('SELECT id FROM admins WHERE LOWER(email) = $1 AND id != $2', [emailValue, targetId]);
                if (dup.length) return res.status(409).json({ success: false, message: 'Email sudah dipakai admin lain' });
            }
            updates.push(`email = $${i++}`); params.push(emailValue);
        }
        if (password) {
            const pwCheck = validatePasswordStrength(String(password));
            if (!pwCheck.valid) return res.status(400).json({ success: false, message: pwCheck.message });
            const hashed = await bcrypt.hash(String(password), 12);
            updates.push(`password = $${i++}`); params.push(hashed);
        }

        if (updates.length === 0) return res.status(400).json({ success: false, message: 'Tidak ada perubahan' });

        params.push(targetId);
        await db.query(`UPDATE admins SET ${updates.join(', ')} WHERE id = $${i}`, params);

        const { rows } = await db.query('SELECT id, username, nama, email, role FROM admins WHERE id = $1', [targetId]);
        res.json({ success: true, message: 'Admin diperbarui', data: rows[0] });
    } catch (error) {
        console.error('❌ Update admin error:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui admin' });
    }
};

/**
 * DELETE /api/admin/customers/:id  — delete a customer and all related data (CASCADE)
 */
exports.deleteCustomer = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id || isNaN(id)) {
            return res.status(400).json({ success: false, message: 'ID customer tidak valid' });
        }
        const { rows } = await db.query('SELECT id, nama_lengkap, whatsapp FROM customers WHERE id = $1', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan' });
        }

        // whatsapp_logs (the message queue / "pesan gagal terkirim") is keyed by
        // PHONE, not customer_id — it has no FK to customers, so the ON DELETE
        // CASCADE does NOT cover it. Without this, a deleted customer's queued /
        // failed auto-replies linger in the queue. Wipe them in the same
        // transaction as the customer delete so the two can't drift apart.
        const phone = sanitizePhone(rows[0].whatsapp);

        const client = await db.connect();
        let removedQueue = 0;
        try {
            await client.query('BEGIN');
            if (phone) {
                const del = await client.query('DELETE FROM whatsapp_logs WHERE phone = $1', [phone]);
                removedQueue = del.rowCount || 0;
            }
            await client.query('DELETE FROM customers WHERE id = $1', [id]);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }

        console.log(`🗑️ Customer deleted: ${rows[0].nama_lengkap} (id=${id}) + ${removedQueue} queue row(s) by admin ${req.admin.username}`);
        res.json({ success: true, message: `Customer "${rows[0].nama_lengkap}" berhasil dihapus` });
    } catch (error) {
        console.error('❌ Delete customer error:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus customer' });
    }
};

/**
 * DELETE /api/admin/admins/:id  — delete admin (owner-only, cannot delete self/owner)
 */
exports.deleteAdmin = async (req, res) => {
    if (!ownerOnly(req, res)) return;
    try {
        const targetId = parseInt(req.params.id, 10);
        if (targetId === req.admin.id) {
            return res.status(400).json({ success: false, message: 'Tidak bisa menghapus akun sendiri' });
        }
        const { rows } = await db.query('SELECT role FROM admins WHERE id = $1', [targetId]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Admin tidak ditemukan' });
        if (rows[0].role === 'owner') {
            return res.status(400).json({ success: false, message: 'Tidak bisa menghapus owner' });
        }
        await db.query('DELETE FROM admins WHERE id = $1', [targetId]);
        res.json({ success: true, message: 'Admin dihapus' });
    } catch (error) {
        console.error('❌ Delete admin error:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus admin' });
    }
};

/**
 * GET /api/admin/me — get current admin info (for showing email banner, role-based UI)
 */
exports.getCurrentAdmin = async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT id, username, nama, email, role FROM admins WHERE id = $1',
            [req.admin.id]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Admin tidak ditemukan' });
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('❌ Get current admin error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data admin' });
    }
};

/**
 * Change username/password
 * PATCH /api/admin/credentials
 */
exports.changeCredentials = async (req, res) => {
    try {
        const adminId = req.admin && req.admin.id;
        const { current_password, new_password, new_username, nama } = req.body;

        if (!adminId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        if (!current_password) return res.status(400).json({ success: false, message: 'Current password is required' });

        const { rows } = await db.query('SELECT * FROM admins WHERE id = $1', [adminId]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Admin not found' });

        const admin = rows[0];
        const isValid = await bcrypt.compare(current_password, admin.password);
        if (!isValid) return res.status(401).json({ success: false, message: 'Current password is incorrect' });

        const updates = [];
        const params = [];
        let paramCount = 1;

        if (new_username && String(new_username).trim() !== admin.username) {
            const { rows: u } = await db.query('SELECT id FROM admins WHERE username = $1 AND id != $2', [String(new_username).trim(), adminId]);
            if (u.length > 0) return res.status(409).json({ success: false, message: 'Username already taken' });
            updates.push(`username = $${paramCount++}`); params.push(String(new_username).trim());
        }

        if (nama && String(nama).trim() !== admin.nama) {
            updates.push(`nama = $${paramCount++}`); params.push(String(nama).trim());
        }

        let passwordChanged = false;
        if (new_password) {
            const pwCheck = validatePasswordStrength(new_password);
            if (!pwCheck.valid) return res.status(400).json({ success: false, message: pwCheck.message });
            const hashed = await bcrypt.hash(new_password, 12);
            updates.push(`password = $${paramCount++}`); params.push(hashed);
            passwordChanged = true;
        }

        if (updates.length > 0) {
            params.push(adminId);
            await db.query(`UPDATE admins SET ${updates.join(', ')} WHERE id = $${paramCount}`, params);
        }

        const token = jwt.sign(
            { id: adminId, username: new_username ? String(new_username).trim() : admin.username, role: admin.role || 'staff' },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        // Re-issue cookies after credential change so the new token + CSRF rotate.
        setAuthCookie(res, token);
        const csrfToken = issueCsrfToken(res);

        const responseData = {
            id: adminId,
            username: new_username ? String(new_username).trim() : admin.username,
            nama: nama ? String(nama).trim() : admin.nama
        };

        res.json({ success: true, message: 'Credentials updated', csrf_token: csrfToken, data: responseData });

    } catch (error) {
        console.error('❌ Change credentials error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengubah credentials' });
    }
};

/**
 * Get messages by customer ID
 * GET /api/admin/messages/:customerId
 */
exports.getMessagesByCustomer = async (req, res) => {
    try {
        const { customerId } = req.params;

        const { rows: messages } = await db.query(
            `SELECT * FROM messages
            WHERE customer_id = $1
            ORDER BY sent_at ASC`,
            [customerId]
        );

        res.json({
            success: true,
            data: messages
        });

    } catch (error) {
        console.error('❌ Get customer messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil pesan customer'
        });
    }
};

/**
 * POST /api/admin/forgot
 */
exports.forgotPassword = async (req, res) => {
    try {
        const { usernameOrEmail } = req.body;
        if (!usernameOrEmail) {
            return res.status(400).json({ success: false, message: 'Username atau email wajib diisi' });
        }

        const lookup = String(usernameOrEmail).trim();
        const { rows } = await db.query(
            'SELECT id, username, email, nama FROM admins WHERE username = $1 OR LOWER(email) = LOWER($2)',
            [lookup, lookup]
        );

        // Always reply with the SAME neutral message regardless of whether the
        // account exists or has an email registered. Leaking "akun tidak
        // ditemukan" vs "email belum diatur" would let an attacker enumerate
        // valid admin usernames/emails. Internal-only details go to the log.
        const genericMsg = 'Jika akun terdaftar, link reset telah dikirim ke email terkait. Cek inbox/spam.';
        if (rows.length === 0) {
            console.log(`[forgot] No admin matched "${lookup}" — replying neutral, no email sent.`);
            return res.json({ success: true, message: genericMsg });
        }

        const admin = rows[0];

        // Account exists but has no recovery email → cannot send. Stay neutral
        // (do NOT reveal the account exists); owner must set an email via Settings.
        if (!admin.email) {
            console.warn(`[forgot] Admin "${admin.username}" (id=${admin.id}) has no email — replying neutral, no email sent.`);
            return res.json({ success: true, message: genericMsg });
        }

        const crypto = require('crypto');
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + (60 * 60 * 1000));

        await db.query(
            'INSERT INTO admin_reset_tokens (admin_id, token, expires_at) VALUES ($1, $2, $3)',
            [admin.id, token, expiresAt]
        );

        const nodemailer = require('nodemailer');
        const isDev = process.env.NODE_ENV !== 'production';

        if (process.env.MAIL_HOST && process.env.MAIL_USER) {
            // Resolve to IPv4 explicitly — Railway's outbound network doesn't route
            // IPv6, and Node's DNS resolver returns AAAA first by default.
            const dns = require('dns').promises;
            let mailHostV4 = process.env.MAIL_HOST;
            try {
                const lookup = await dns.lookup(process.env.MAIL_HOST, { family: 4 });
                mailHostV4 = lookup.address;
                console.log(`[Mail] Resolved ${process.env.MAIL_HOST} → ${mailHostV4} (IPv4)`);
            } catch (lookupErr) {
                console.warn(`[Mail] IPv4 lookup failed: ${lookupErr.message}; using hostname as-is`);
            }

            // Port logic: 465 = implicit TLS (secure:true), 587 = STARTTLS (secure:false).
            // 465 tends to work more reliably on Railway because no STARTTLS handshake
            // dance is needed — TCP connect + TLS in one shot. If user sets MAIL_SECURE
            // explicitly we honor it; otherwise auto-derive from the port.
            const port = Number(process.env.MAIL_PORT) || 465;
            const secure = process.env.MAIL_SECURE !== undefined
                ? process.env.MAIL_SECURE === 'true'
                : port === 465;

            const transporter = nodemailer.createTransport({
                host: mailHostV4,
                port,
                secure,
                auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
                tls: { servername: process.env.MAIL_HOST },  // preserve SNI
                connectionTimeout: 30_000,   // bumped — Connection timeout was 15s
                greetingTimeout: 15_000,
                socketTimeout: 30_000,
                pool: false                  // one-shot for occasional reset emails
            });

            const from = process.env.MAIL_FROM || process.env.MAIL_USER;
            const frontend = process.env.FRONTEND_URL || 'http://localhost:5500';
            const resetLink = `${frontend.replace(/\/$/, '')}/admin/reset.html?token=${token}`;

            try {
                await transporter.sendMail({
                    from,
                    to: admin.email,  // strictly admin's email — no MAIL_USER fallback
                    subject: 'Reset Password Admin — Cahaya Phone',
                    text: `Halo ${admin.nama || admin.username},\n\nGunakan link berikut untuk mereset password Anda (berlaku 1 jam):\n${resetLink}\n\nKalau Anda tidak meminta reset, abaikan email ini.`,
                    html: `<p>Halo <strong>${admin.nama || admin.username}</strong>,</p>
                           <p>Klik link berikut untuk reset password (berlaku 1 jam):</p>
                           <p><a href="${resetLink}">${resetLink}</a></p>
                           <p style="color:#888;font-size:12px;">Kalau Anda tidak meminta reset, abaikan email ini.</p>`
                });
                return res.json({ success: true, message: genericMsg });
            } catch (mailErr) {
                console.error('❌ Mail send failed:', mailErr.message || mailErr);
                if (isDev) {
                    return res.json({ success: true, message: genericMsg, _devToken: token, _devNote: 'Mail gagal — token dev fallback' });
                }
                return res.status(500).json({ success: false, message: 'Gagal mengirim email reset. Hubungi owner.' });
            }
        }

        // No mail configured
        if (isDev) {
            return res.json({ success: true, message: genericMsg, _devToken: token, _devNote: 'MAIL belum dikonfigurasi — token dev fallback' });
        }
        return res.status(500).json({ success: false, message: 'Email server belum dikonfigurasi. Hubungi owner.' });
    } catch (error) {
        console.error('❌ Forgot password error:', error);
        res.status(500).json({ success: false, message: 'Gagal memproses permintaan reset' });
    }
};

/**
 * GET /api/admin/reset/validate?token=...
 */
exports.validateResetToken = async (req, res) => {
    try {
        const token = req.query.token;
        if (!token) return res.status(400).json({ success: false, message: 'Token is required' });

        const { rows } = await db.query(
            'SELECT id, admin_id, expires_at, used FROM admin_reset_tokens WHERE token = $1',
            [token]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Token not found' });
        const rec = rows[0];
        if (rec.used) return res.status(400).json({ success: false, message: 'Token already used' });
        if (new Date(rec.expires_at) < new Date()) return res.status(400).json({ success: false, message: 'Token expired' });

        res.json({ success: true, message: 'Token valid' });
    } catch (error) {
        console.error('❌ Validate token error:', error);
        res.status(500).json({ success: false, message: 'Gagal validasi token' });
    }
};

/**
 * Export all customers as CSV
 * GET /api/admin/customers/export
 * ?format=full (default) → all columns CSV
 * ?format=simple → Name + Phone CSV
 */
exports.exportContacts = async (req, res) => {
    try {
        console.log('📥 Export contacts requested');

        const format = req.query.format || 'full';
        const { where, params } = buildExportFilter(req.query);

        const { rows: customers } = await db.query(
            `SELECT nama_lengkap, whatsapp, nama_sales, merk_unit, tipe_unit,
                    source, status, opted_in, created_at
             FROM customers ${where} ORDER BY created_at DESC`,
            params
        );

        console.log(`📥 Export: found ${customers.length} customers (format=${format})`);

        const esc = v => `"${String(v || '').replace(/"/g, '""')}"`;
        let header, csvRows;

        if (format === 'simple') {
            header = 'Name,Phone\n';
            csvRows = customers.map(c => {
                const phone = sanitizePhone(c.whatsapp);
                return [esc(c.nama_lengkap), esc(phone)].join(',');
            }).join('\n');
        } else {
            header = 'Nama,Nomor WhatsApp,Sales,Merk,Tipe,Source,Status,Opted In,Tanggal Daftar\n';
            csvRows = customers.map(c => {
                const phone = sanitizePhone(c.whatsapp);
                const date = c.created_at ? new Date(c.created_at).toLocaleDateString('id-ID') : '';
                return [
                    esc(c.nama_lengkap),
                    esc(phone),
                    esc(c.nama_sales),
                    esc(c.merk_unit),
                    esc(c.tipe_unit),
                    esc(c.source),
                    esc(c.status),
                    c.opted_in ? 'Ya' : 'Tidak',
                    esc(date)
                ].join(',');
            }).join('\n');
        }

        const csv = header + csvRows;
        const suffix = format === 'simple' ? 'contacts' : 'customers';
        const filename = `${suffix}_${new Date().toISOString().slice(0,10)}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\uFEFF' + csv);

    } catch (error) {
        console.error('❌ Export contacts error:', error.message, error.stack);
        res.status(500).json({ success: false, message: 'Gagal export data: ' + error.message });
    }
};

/**
 * Export all customers as vCard (.vcf) — direct phone contact import
 * GET /api/admin/customers/export/vcf
 * Tap the .vcf file on phone → all contacts auto-saved
 */
exports.exportVCard = async (req, res) => {
    try {
        console.log('📥 Export vCard requested');

        const { where, params } = buildExportFilter(req.query);

        const { rows: customers } = await db.query(
            `SELECT nama_lengkap, whatsapp FROM customers ${where} ORDER BY created_at DESC`,
            params
        );

        console.log(`📥 Export vCard: found ${customers.length} customers`);

        // Build vCard 3.0 format — universally supported on iOS & Android
        const vcards = customers.map(c => {
            const phone = sanitizePhone(c.whatsapp);
            const name = String(c.nama_lengkap || '').trim();
            // Escape special vCard characters
            const escapedName = name.replace(/[;,\\]/g, m => '\\' + m);
            return [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${escapedName}`,
                `TEL;TYPE=CELL:+${phone}`,
                `NOTE:Customer Cahaya Phone`,
                'END:VCARD'
            ].join('\r\n');
        }).join('\r\n');

        const filename = `cahaya_phone_contacts_${new Date().toISOString().slice(0,10)}.vcf`;

        res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(vcards);

    } catch (error) {
        console.error('❌ Export vCard error:', error.message, error.stack);
        res.status(500).json({ success: false, message: 'Gagal export vCard: ' + error.message });
    }
};

/**
 * Quick-sync VCF — no login, uses secret key
 * GET /api/sync/contacts?key=SECRET
 * Optional: ?key=SECRET&since=2026-03-20 (only new contacts since date)
 */
exports.quickSyncVCF = async (req, res) => {
    try {
        const { since } = req.query;
        const syncKey = process.env.SYNC_SECRET;
        const authHeader = req.headers['x-sync-key'] || req.query.key;

        if (!syncKey || !authHeader || !safeEqual(authHeader, syncKey)) {
            return res.status(403).json({ success: false, message: 'Invalid or missing sync key' });
        }

        let query = `SELECT nama_lengkap, whatsapp, created_at FROM customers ORDER BY created_at DESC`;
        const params = [];

        if (since) {
            query = `SELECT nama_lengkap, whatsapp, created_at FROM customers WHERE created_at >= $1 ORDER BY created_at DESC`;
            params.push(since);
        }

        const { rows: customers } = await db.query(query, params);

        if (customers.length === 0) {
            return res.status(200).send('Tidak ada kontak baru.');
        }

        const vcards = customers.map(c => {
            const phone = sanitizePhone(c.whatsapp);
            const name = String(c.nama_lengkap || '').trim();
            const escapedName = name.replace(/[;,\\]/g, m => '\\' + m);
            return [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${escapedName} - CP`,
                `TEL;TYPE=CELL:+${phone}`,
                `NOTE:Customer Cahaya Phone`,
                'END:VCARD'
            ].join('\r\n');
        }).join('\r\n');

        const filename = `cp_contacts_${new Date().toISOString().slice(0,10)}.vcf`;
        res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(vcards);

    } catch (error) {
        console.error('❌ Quick sync error:', error);
        res.status(500).json({ success: false, message: 'Gagal sync: ' + error.message });
    }
};

/**
 * Quick-sync: list customers by date (JSON)
 * GET /api/sync/list?key=SECRET&date=2026-03-20
 */
exports.quickSyncList = async (req, res) => {
    try {
        const { date } = req.query;
        const syncKey = process.env.SYNC_SECRET;
        const authHeader = req.headers['x-sync-key'] || req.query.key;

        if (!syncKey || !authHeader || !safeEqual(authHeader, syncKey)) {
            return res.status(403).json({ success: false, message: 'Invalid or missing sync key' });
        }

        let query, params;
        if (date) {
            query = `SELECT id, nama_lengkap, whatsapp, merk_unit, tipe_unit, created_at FROM customers WHERE DATE(created_at) = $1 ORDER BY created_at DESC`;
            params = [date];
        } else {
            query = `SELECT id, nama_lengkap, whatsapp, merk_unit, tipe_unit, created_at FROM customers ORDER BY created_at DESC LIMIT 100`;
            params = [];
        }

        const { rows } = await db.query(query, params);
        res.json({ success: true, count: rows.length, customers: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Quick-sync: download VCF for specific customer IDs
 * POST /api/sync/contacts/selected
 * Body: { key, ids: [1, 2, 3] }
 */
exports.quickSyncSelected = async (req, res) => {
    try {
        const { ids } = req.body;
        const syncKey = process.env.SYNC_SECRET;
        const authHeader = req.headers['x-sync-key'] || req.body.key;

        if (!syncKey || !authHeader || !safeEqual(authHeader, syncKey)) {
            return res.status(403).json({ success: false, message: 'Invalid or missing sync key' });
        }

        if (!ids || !ids.length) {
            return res.status(400).json({ success: false, message: 'Tidak ada kontak dipilih' });
        }

        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        const { rows: customers } = await db.query(
            `SELECT nama_lengkap, whatsapp FROM customers WHERE id IN (${placeholders})`,
            ids
        );

        const vcards = customers.map(c => {
            const phone = sanitizePhone(c.whatsapp);
            const name = String(c.nama_lengkap || '').trim();
            const escapedName = name.replace(/[;,\\]/g, m => '\\' + m);
            return [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${escapedName} - CP`,
                `TEL;TYPE=CELL:+${phone}`,
                `NOTE:Customer Cahaya Phone`,
                'END:VCARD'
            ].join('\r\n');
        }).join('\r\n');

        const filename = `cp_contacts_selected.vcf`;
        res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(vcards);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get daily broadcast sent count
 * GET /api/admin/broadcast/daily-count
 */
exports.getDailySentCount = async (req, res) => {
    try {
        const count = await getDailySentCount();
        res.json({ success: true, daily_sent: count });
    } catch (error) {
        console.error('❌ Daily count error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil jumlah harian' });
    }
};

/**
 * Start broadcast — plain-text via Baileys bridge
 * POST /api/admin/broadcast/start
 * Body: { message, source_filter?, merk_filter?, metode_filter? }
 *
 * Backend worker (wa-worker.js) applies anti-ban: warm-up, random delay,
 * break every 25-30 msgs, working-hours window, daily limit.
 */
exports.startBroadcast = async (req, res) => {
    try {
        const { message, source_filter, merk_filter, metode_filter } = req.body;

        if (!message || !String(message).trim()) {
            return res.status(400).json({ success: false, message: 'Pesan wajib diisi' });
        }

        // Check if there's already an active broadcast
        const { rows: active } = await db.query(
            `SELECT id FROM broadcast_jobs WHERE status = 'running' LIMIT 1`
        );
        if (active.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Broadcast sedang berjalan. Stop dulu sebelum memulai baru.'
            });
        }

        // Get opted-in customers with filters
        let query = `SELECT id, nama_lengkap, whatsapp FROM customers WHERE opted_in IS NOT FALSE`;
        const params = [];
        if (source_filter) {
            query += ` AND source = $${params.length + 1}`;
            params.push(source_filter);
        }
        if (merk_filter) {
            query += ` AND merk_unit = $${params.length + 1}`;
            params.push(merk_filter);
        }
        if (metode_filter) {
            query += ` AND metode_pembayaran = $${params.length + 1}`;
            params.push(metode_filter);
        }
        query += ` ORDER BY created_at ASC`;

        const { rows: customers } = await db.query(query, params);

        if (customers.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada customer opted-in untuk dibroadcast' });
        }

        // Create broadcast job (simpan plain text message)
        const { rows: [job] } = await db.query(
            `INSERT INTO broadcast_jobs (message, source_filter, status, total) VALUES ($1, $2, 'running', $3) RETURNING id`,
            [String(message).trim(), source_filter || null, customers.length]
        );

        // Insert all recipients
        const values = customers.map((c, i) => {
            const offset = i * 4;
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
        }).join(', ');
        const recipientParams = customers.flatMap(c => [job.id, c.id, c.nama_lengkap, sanitizePhone(c.whatsapp)]);

        await db.query(
            `INSERT INTO broadcast_recipients (job_id, customer_id, customer_name, customer_phone) VALUES ${values}`,
            recipientParams
        );

        // Anti-spam: daily sent count for soft warning
        const dailySent = await getDailySentCount();

        res.json({
            success: true,
            message: `Broadcast dimulai untuk ${customers.length} customer`,
            job_id: job.id,
            status: { running: true, paused: false, total: customers.length, sent: 0, failed: 0, queued: customers.length, daily_sent: dailySent, log: [] }
        });

    } catch (error) {
        console.error('❌ Start broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal memulai broadcast' });
    }
};

/**
 * Process broadcast — now backend-driven via wa-worker.js
 * This endpoint just returns current status (backward compatibility)
 * POST /api/admin/broadcast/process
 */
exports.processBroadcast = async (req, res) => {
    try {
        const { rows: jobs } = await db.query(
            `SELECT id, status FROM broadcast_jobs ORDER BY id DESC LIMIT 1`
        );

        if (jobs.length === 0) {
            return res.json({ success: true, status: { running: false, paused: false, total: 0, sent: 0, failed: 0, queued: 0, log: [] } });
        }

        const job = jobs[0];
        const { rows: [counts] } = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status IN ('pending', 'sending')) as queued,
                COUNT(*) FILTER (WHERE status = 'sent') as sent,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) as total
             FROM broadcast_recipients WHERE job_id = $1`,
            [job.id]
        );

        const { rows: recentLog } = await db.query(
            `SELECT customer_name as name, customer_phone as phone, status, error
             FROM broadcast_recipients WHERE job_id = $1 AND status NOT IN ('pending', 'sending')
             ORDER BY sent_at DESC LIMIT 20`,
            [job.id]
        );

        const log = recentLog.map(r => ({
            success: r.status === 'sent',
            name: r.name,
            phone: r.phone,
            error: r.error
        }));

        const dailySent = await getDailySentCount();

        res.json({
            success: true,
            status: {
                running: job.status === 'running',
                paused: job.status === 'paused',
                total: parseInt(counts.total),
                sent: parseInt(counts.sent),
                failed: parseInt(counts.failed),
                queued: parseInt(counts.queued),
                daily_sent: dailySent,
                log
            }
        });

    } catch (error) {
        console.error('❌ Process broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal memproses broadcast' });
    }
};

/**
 * Stop broadcast
 * POST /api/admin/broadcast/stop
 */
exports.stopBroadcast = async (req, res) => {
    try {
        await db.query(`UPDATE broadcast_jobs SET status = 'stopped' WHERE status IN ('running', 'paused')`);
        await db.query(
            `UPDATE broadcast_recipients SET status = 'skipped'
             WHERE job_id IN (SELECT id FROM broadcast_jobs WHERE status = 'stopped') AND status IN ('pending', 'sending')`
        );
        res.json({ success: true, message: 'Broadcast dihentikan', status: { running: false, paused: false, total: 0, sent: 0, failed: 0, queued: 0, log: [] } });
    } catch (error) {
        console.error('❌ Stop broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal menghentikan broadcast' });
    }
};

/**
 * Pause broadcast
 * POST /api/admin/broadcast/pause
 */
exports.pauseBroadcast = async (req, res) => {
    try {
        await db.query(`UPDATE broadcast_jobs SET status = 'paused' WHERE status = 'running'`);
        res.json({ success: true, message: 'Broadcast dijeda' });
    } catch (error) {
        console.error('❌ Pause broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal menjeda broadcast' });
    }
};

/**
 * Resume broadcast
 * POST /api/admin/broadcast/resume
 */
exports.resumeBroadcast = async (req, res) => {
    try {
        await db.query(`UPDATE broadcast_jobs SET status = 'running' WHERE status = 'paused'`);
        res.json({ success: true, message: 'Broadcast dilanjutkan' });
    } catch (error) {
        console.error('❌ Resume broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal melanjutkan broadcast' });
    }
};

/**
 * Get broadcast status
 * GET /api/admin/broadcast/status
 */
exports.getBroadcastStatus = async (req, res) => {
    try {
        const { rows: jobs } = await db.query(
            `SELECT id, status, total, created_at FROM broadcast_jobs ORDER BY id DESC LIMIT 1`
        );

        if (jobs.length === 0) {
            return res.json({ success: true, status: { running: false, paused: false, total: 0, sent: 0, failed: 0, queued: 0, log: [] } });
        }

        const job = jobs[0];
        const { rows: [counts] } = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as queued,
                COUNT(*) FILTER (WHERE status = 'sent') as sent,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) as total
             FROM broadcast_recipients WHERE job_id = $1`,
            [job.id]
        );

        const { rows: recentLog } = await db.query(
            `SELECT customer_name as name, customer_phone as phone, status, error
             FROM broadcast_recipients WHERE job_id = $1 AND status != 'pending'
             ORDER BY sent_at DESC LIMIT 20`,
            [job.id]
        );

        const log = recentLog.map(r => ({
            success: r.status === 'sent',
            name: r.name,
            phone: r.phone,
            error: r.error
        }));

        // Anti-spam: daily sent count for soft warning
        const dailySent = await getDailySentCount();

        res.json({
            success: true,
            status: {
                running: job.status === 'running',
                paused: job.status === 'paused',
                total: parseInt(counts.total),
                sent: parseInt(counts.sent),
                failed: parseInt(counts.failed),
                queued: parseInt(counts.queued),
                daily_sent: dailySent,
                log
            }
        });
    } catch (error) {
        console.error('❌ Get broadcast status error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil status broadcast' });
    }
};

/**
 * POST /api/admin/logout — clear auth cookies. Idempotent; safe to call without a session.
 */
exports.logout = (req, res) => {
    clearAuthCookies(res);
    res.json({ success: true, message: 'Logout berhasil' });
};

/**
 * POST /api/admin/reset
 */
exports.resetPassword = async (req, res) => {
    try {
        const { token, new_password } = req.body;
        if (!token || !new_password) return res.status(400).json({ success: false, message: 'Token and new_password are required' });

        const { rows } = await db.query(
            'SELECT id, admin_id, expires_at, used FROM admin_reset_tokens WHERE token = $1',
            [token]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Token not found' });
        const rec = rows[0];
        if (rec.used) return res.status(400).json({ success: false, message: 'Token already used' });
        if (new Date(rec.expires_at) < new Date()) return res.status(400).json({ success: false, message: 'Token expired' });

        const pwCheck = validatePasswordStrength(new_password);
        if (!pwCheck.valid) return res.status(400).json({ success: false, message: pwCheck.message });

        const hash = await bcrypt.hash(new_password, 12);
        await db.query('UPDATE admins SET password = $1 WHERE id = $2', [hash, rec.admin_id]);
        await db.query('UPDATE admin_reset_tokens SET used = TRUE WHERE id = $1', [rec.id]);

        res.json({ success: true, message: 'Password telah direset' });
    } catch (error) {
        console.error('❌ Reset password error:', error);
        res.status(500).json({ success: false, message: 'Gagal mereset password' });
    }
};

// ============================================
// ANALYTICS ENDPOINTS
// ============================================

/**
 * Top buyers — customers with most purchases
 * GET /api/admin/analytics/top-buyers
 */
exports.getTopBuyers = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT c.id, c.nama_lengkap, c.whatsapp,
                   COUNT(p.id) as total_purchases,
                   COALESCE(SUM(p.harga * p.qty), 0) as total_spent
            FROM customers c
            JOIN purchases p ON p.customer_id = c.id
            GROUP BY c.id, c.nama_lengkap, c.whatsapp
            ORDER BY total_purchases DESC, total_spent DESC
            LIMIT 20
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('❌ Top buyers error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data' });
    }
};

/**
 * Top products — most sold phone models
 * GET /api/admin/analytics/top-products
 */
exports.getTopProducts = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT merk_unit, tipe_unit,
                   COUNT(*) as total_sold,
                   SUM(qty) as total_qty,
                   COALESCE(SUM(harga * qty), 0) as total_revenue
            FROM purchases
            WHERE merk_unit IN ('iPhone','Samsung','Xiaomi','Oppo','Tecno','Realme','Infinix','Nokia')
              AND tipe_unit IS NOT NULL AND tipe_unit != ''
            GROUP BY merk_unit, tipe_unit
            ORDER BY total_sold DESC
            LIMIT 20
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('❌ Top products error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data' });
    }
};

/**
 * Brand stats — sales by brand
 * GET /api/admin/analytics/top-brands
 */
exports.getTopBrands = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT merk_unit as brand,
                   COUNT(*) as total_sold,
                   SUM(qty) as total_qty,
                   COALESCE(SUM(harga * qty), 0) as total_revenue
            FROM purchases
            WHERE merk_unit IN ('iPhone','Samsung','Xiaomi','Oppo','Tecno','Realme','Infinix','Nokia')
            GROUP BY merk_unit
            ORDER BY total_sold DESC
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('❌ Top brands error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data' });
    }
};

// ============================================
// WA CLIENT ENDPOINTS (langsung, bukan proxy HTTP)
// ============================================

/**
 * Get WA Cloud API connection status
 * GET /api/admin/wa/status
 */
exports.getWABridgeStatus = async (req, res) => {
    try {
        const status = await whatsappService.getStatus();

        // Include worker queue status
        const waWorker = require('../config/wa-worker');
        const queueStatus = await waWorker.getQueueStatus();

        res.json({ ...status, queue: queueStatus });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Update form auto-reply template message (persisted to app_settings)
 * POST /api/admin/wa/auto-reply  Body: { message: string }
 */
exports.updateWAAutoReply = async (req, res) => {
    try {
        const { message } = req.body;
        const result = await whatsappService.setAutoReplyMessage(message);
        if (!result.success) return res.status(400).json(result);
        res.json({ success: true, message: 'Template auto-reply tersimpan' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Get form auto-reply template message
 * GET /api/admin/wa/auto-reply
 */
exports.getWAAutoReply = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT value FROM app_settings WHERE key = 'form_autoreply_message' LIMIT 1`
        );
        const defaultMsg = 'Halo {nama}, terima kasih telah menghubungi Cahaya Phone Gorontalo! 🙏\n\nData Anda sudah kami terima. Tim kami akan segera menghubungi Anda untuk proses selanjutnya.';
        res.json({
            success: true,
            autoReplyMessage: rows[0]?.value || defaultMsg,
            autoReply: true
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Disconnect WhatsApp — logout bridge & wipe session (next scan = fresh QR)
 * POST /api/admin/wa/disconnect
 */
exports.disconnectWA = async (req, res) => {
    try {
        await whatsappService.disconnectBridge();
        res.json({ success: true, message: 'Bridge disconnected. Scan QR ulang untuk reconnect.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Restart bridge + reload settings + restart anti-ban worker
 * POST /api/admin/wa/restart
 */
exports.restartWA = async (req, res) => {
    try {
        await whatsappService.loadSettings();
        await whatsappService.restartBridge().catch(e => console.warn('[WA] Bridge restart:', e.message));

        const waWorker = require('../config/wa-worker');
        waWorker.stop();
        await waWorker.start();

        const status = await whatsappService.getStatus();
        res.json({ success: true, message: 'WA bridge restart + worker reload', ...status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Update WA settings (daily limit, etc)
 * POST /api/admin/wa/settings
 */
exports.updateWASettings = async (req, res) => {
    try {
        const result = await whatsappService.setDailyLimit(req.body.dailyLimit);
        res.json(result);
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
};

// ============================================
// RETRY FAILED WA MESSAGES
// ============================================

// Helper: 08:00–22:00 WITA window — matches wa-worker._isWorkingHours().
// Kept inline (no import) because adminController shouldn't depend on worker internals.
const WA_WORK_START = 8, WA_WORK_END = 22;
function _isWorkingHoursWITA() {
    const witaHours = (new Date().getUTCHours() + 8) % 24;
    return witaHours >= WA_WORK_START && witaHours < WA_WORK_END;
}

/**
 * Get customers with pending/failed WA delivery, enriched with per-customer
 * queue context (the auto_dispatch flag of their latest pending log row).
 *
 * Frontend uses log_auto_dispatch to render the manual button:
 *   - TRUE (or null/no row) → DISABLED. System will auto-send when worker
 *     reaches it. Admin just waits and refreshes.
 *   - FALSE → ENABLED. Toggle was OFF when row was enqueued, so admin
 *     must explicitly click to promote the row to auto_dispatch=TRUE.
 *
 * `has_auto_pending` tells frontend whether ANY auto_dispatch=TRUE rows are
 * still QUEUED/SENDING — if yes, manual buttons should reject with 409
 * because the auto queue has priority.
 *
 * `is_working_hours` lets frontend render a "luar jam operasional" hint so
 * admin understands why manual clicks won't go through right now.
 *
 * GET /api/admin/wa/failed
 */
exports.getFailedWA = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT c.id, c.nama_lengkap, c.whatsapp, c.wa_sent, c.tipe, c.created_at,
                    wl.auto_dispatch AS is_auto,
                    COUNT(*)::int AS queue_count,
                    MAX(wl.id) AS latest_log_id,
                    (array_agg(wl.status ORDER BY wl.id DESC))[1] AS log_status
             FROM customers c
             JOIN whatsapp_logs wl ON wl.phone = c.whatsapp
                  AND wl.type = 'auto_reply'
                  AND wl.status IN ('QUEUED','SENDING','FAILED')
             WHERE c.tipe = 'Belanja'
             GROUP BY c.id, c.nama_lengkap, c.whatsapp, c.wa_sent, c.tipe, c.created_at, wl.auto_dispatch
             ORDER BY wl.auto_dispatch DESC, c.created_at DESC`
        );

        const { rows: autoPending } = await db.query(
            `SELECT COUNT(*)::int AS cnt FROM whatsapp_logs
             WHERE type = 'auto_reply' AND status IN ('QUEUED','SENDING') AND auto_dispatch = TRUE`
        );

        res.json({
            success: true,
            data: rows,
            count: rows.length,
            has_auto_pending: autoPending[0].cnt > 0,
            is_working_hours: _isWorkingHoursWITA(),
            working_hours: { start: WA_WORK_START, end: WA_WORK_END, tz: 'WITA' }
        });
    } catch (error) {
        console.error('❌ getFailedWA error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Promote a customer's QUEUED auto_dispatch=FALSE row to auto_dispatch=TRUE
 * so the worker picks it up (with pacing/break/randomize).
 *
 * Hard rules:
 *   1. If customer has no pending QUEUED/SENDING row → create one (handles
 *      legacy FAILED state from before this column existed).
 *   2. If their pending row is already auto_dispatch=TRUE → 400. System is
 *      already handling it; manual click is a no-op.
 *   3. If ANY other auto_dispatch=TRUE row is still QUEUED/SENDING → 409.
 *      Auto queue has priority; admin must wait for it to drain before
 *      manual sends can take a slot.
 *   4. Otherwise: flip target row to auto_dispatch=TRUE and return 202.
 *      Worker picks it up at next tick with full pacing applied.
 *
 * Frontend polls /admin/wa/failed to know when the send completes (customer
 * disappears from the list when wa_sent=TRUE).
 *
 * POST /api/admin/wa/retry/:id
 */
exports.retryWA = async (req, res) => {
    try {
        // Gate 0: working hours. Manual click outside 08-22 WITA does nothing
        // (no DB writes) so admin can't accidentally schedule sends that won't
        // fire until next morning anyway.
        if (!_isWorkingHoursWITA()) {
            return res.status(400).json({
                success: false,
                outside_working_hours: true,
                message: `Di luar jam operasional (${WA_WORK_START}:00–${WA_WORK_END}:00 WITA). Coba lagi saat jam buka.`
            });
        }

        const { id } = req.params;
        const { rows: cust } = await db.query(
            'SELECT id, nama_lengkap, whatsapp FROM customers WHERE id = $1', [id]
        );
        if (cust.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan' });
        }
        const customer = cust[0];
        const cleanPhone = sanitizePhone(customer.whatsapp);

        // 1. Find oldest manual (auto_dispatch=FALSE) pending row for this customer
        const { rows: manualPending } = await db.query(
            `SELECT id FROM whatsapp_logs
             WHERE phone = $1 AND type = 'auto_reply' AND status IN ('QUEUED','FAILED')
               AND auto_dispatch = FALSE
             ORDER BY id ASC LIMIT 1`,
            [cleanPhone]
        );

        let targetRowId;
        if (manualPending.length === 0) {
            // No manual pending row — check if there's an auto row
            const { rows: anyPending } = await db.query(
                `SELECT id, auto_dispatch FROM whatsapp_logs
                 WHERE phone = $1 AND type = 'auto_reply' AND status IN ('QUEUED','SENDING')
                 ORDER BY id DESC LIMIT 1`,
                [cleanPhone]
            );
            if (anyPending.length > 0 && anyPending[0].auto_dispatch === true) {
                return res.status(400).json({
                    success: false,
                    message: 'Pesan ini sudah dalam antrian otomatis. Sistem akan kirim sendiri saat jam operasional.'
                });
            }

            // No pending row at all — legacy/FAILED. Enqueue a fresh one.
            const enqRes = await whatsappService.enqueueAutoReply(
                { nama_lengkap: customer.nama_lengkap, whatsapp: customer.whatsapp },
                { autoDispatch: true }
            );
            if (!enqRes || !enqRes.success) {
                const invalidNumber = enqRes?.registered === false || /Invalid phone number|Nomor tidak terdaftar/i.test(enqRes?.error || '');
                if (invalidNumber) {
                    await db.query(
                        'UPDATE customers SET wa_sent = NULL WHERE id = $1 AND wa_sent IS NOT TRUE',
                        [customer.id]
                    ).catch(() => {});
                    return res.status(400).json({
                        success: false,
                        message: enqRes.error || 'Nomor tidak terdaftar di WhatsApp'
                    });
                }

                await db.query(
                    'UPDATE customers SET wa_sent = FALSE WHERE id = $1 AND wa_sent IS NOT TRUE',
                    [customer.id]
                ).catch(() => {});

                return res.status(500).json({
                    success: false,
                    message: 'Gagal masukkan pesan ke antrian: ' + (enqRes?.error || 'unknown')
                });
            }

            await db.query(
                'UPDATE customers SET wa_sent = FALSE WHERE id = $1 AND wa_sent IS NOT TRUE',
                [customer.id]
            ).catch(() => {});

            targetRowId = enqRes.log_id;
        } else {
            await db.query(
                'UPDATE customers SET wa_sent = FALSE WHERE id = $1 AND wa_sent IS NOT TRUE',
                [customer.id]
            ).catch(() => {});

            targetRowId = manualPending[0].id;
        }

        // 2. Priority gate — auto queue must drain first
        const { rows: autoPending } = await db.query(
            `SELECT COUNT(*)::int AS cnt FROM whatsapp_logs
             WHERE type = 'auto_reply'
               AND status IN ('QUEUED','SENDING')
               AND auto_dispatch = TRUE
               AND id <> $1`,
            [targetRowId]
        );
        if (autoPending[0].cnt > 0) {
            return res.status(409).json({
                success: false,
                message: 'Tidak bisa kirim sekarang — masih ada antrian otomatis. Tunggu sampai semua pesan otomatis selesai, baru bisa kirim manual.'
            });
        }

        // 3. Flip target to auto_dispatch=TRUE — worker takes it from here
        await db.query(
            `UPDATE whatsapp_logs SET auto_dispatch = TRUE, updated_at = NOW() WHERE id = $1`,
            [targetRowId]
        );

        res.json({
            success: true,
            message: 'Pesan diteruskan ke worker dengan delay anti-ban. Beberapa menit lagi terkirim.',
            log_id: targetRowId
        });
    } catch (error) {
        console.error('retryWA error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Bulk-promote all auto_dispatch=FALSE QUEUED rows. Same priority gate as
 * single retry — if there are auto_dispatch=TRUE rows still pending, reject
 * the whole batch with 409.
 *
 * POST /api/admin/wa/retry-all
 */
exports.retryAllWA = async (req, res) => {
    try {
        // Gate 0: working hours
        if (!_isWorkingHoursWITA()) {
            return res.status(400).json({
                success: false,
                outside_working_hours: true,
                message: `Di luar jam operasional (${WA_WORK_START}:00–${WA_WORK_END}:00 WITA). Coba lagi saat jam buka.`
            });
        }

        // Priority gate
        const { rows: autoPending } = await db.query(
            `SELECT COUNT(*)::int AS cnt FROM whatsapp_logs
             WHERE type = 'auto_reply' AND status IN ('QUEUED','SENDING') AND auto_dispatch = TRUE`
        );
        if (autoPending[0].cnt > 0) {
            return res.status(409).json({
                success: false,
                message: 'Masih ada antrian otomatis. Tunggu selesai dulu sebelum kirim manual semua.'
            });
        }

        const { rowCount } = await db.query(
            `UPDATE whatsapp_logs SET auto_dispatch = TRUE, updated_at = NOW()
             WHERE type = 'auto_reply' AND status = 'QUEUED' AND auto_dispatch = FALSE`
        );

        res.json({
            success: true,
            message: `${rowCount} pesan masuk antrian. Worker akan kirim satu-per-satu dengan delay anti-ban.`,
            promoted: rowCount
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Reconcile queue: for each Belanja customer, compare purchase count vs
 * auto_reply queue count. Create missing queue entries so the numbers match.
 * Safe to call multiple times (idempotent — only creates what's missing).
 *
 * POST /api/admin/wa/reconcile-queue
 */
exports.reconcileQueue = async (req, res) => {
    try {
        const { rows: mismatches } = await db.query(`
            SELECT c.id, c.nama_lengkap, c.whatsapp,
                   COALESCE(p.cnt, 0)::int AS purchase_count,
                   COALESCE(q.cnt, 0)::int AS queue_count
            FROM customers c
            LEFT JOIN (SELECT customer_id, COUNT(*) AS cnt FROM purchases GROUP BY customer_id) p ON p.customer_id = c.id
            LEFT JOIN (SELECT phone, COUNT(*) AS cnt FROM whatsapp_logs WHERE type = 'auto_reply' GROUP BY phone) q ON q.phone = c.whatsapp
            WHERE c.tipe = 'Belanja'
              AND COALESCE(p.cnt, 0) > COALESCE(q.cnt, 0)
            ORDER BY c.id
        `);

        let totalCreated = 0;
        const details = [];

        for (const row of mismatches) {
            const missing = row.purchase_count - row.queue_count;
            let created = 0;
            for (let i = 0; i < missing; i++) {
                const result = await whatsappService.enqueueAutoReply(
                    { nama_lengkap: row.nama_lengkap, whatsapp: row.whatsapp },
                    { autoDispatch: false, skipNumberCheck: true }
                ).catch(e => ({ success: false, error: e.message }));
                if (result && result.success) created++;
            }
            totalCreated += created;
            details.push({ id: row.id, nama: row.nama_lengkap, purchases: row.purchase_count, had_queue: row.queue_count, created });
        }

        console.log(`[Reconcile] Checked ${mismatches.length} customers with mismatches, created ${totalCreated} manual queue entries`);
        res.json({
            success: true,
            message: `${totalCreated} queue entries (manual) dibuat untuk ${mismatches.length} customer yang kurang`,
            details
        });
    } catch (error) {
        console.error('❌ reconcileQueue error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get WA message log (semua pengiriman WA tercatat di DB)
 * GET /api/admin/wa/log?limit=50&status=failed
 */
exports.getWAMessageLog = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const statusFilter = req.query.status;

        let query = `SELECT id, phone, type, template_name, message_body, wa_message_id,
                     status, retry_count, error_code, error_detail,
                     created_at, sent_at, delivered_at, read_at
                     FROM whatsapp_logs`;
        const params = [];

        if (statusFilter) {
            query += ` WHERE status = $1`;
            params.push(statusFilter);
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const { rows } = await db.query(query, params);

        // Daily stats
        const stats = await whatsappService.getStats();

        res.json({ success: true, data: rows, stats });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// DATA CLEANUP (Chat Log & Broadcast Log)
// ============================================
//
// Strategi cleanup (prioritas hemat database):
// 1. admin_reset_tokens → hapus otomatis setiap request (used/expired)
// 2. broadcast_recipients → hapus 30 hari setelah JOB SELESAI
// 3. messages (chat log) → hapus > 30 hari
// 4. broadcast_jobs → hapus 30 hari setelah selesai
// 5. whatsapp_logs → hapus > 30 hari
// 6. wa_daily_stats → hapus > 90 hari
//
// TIDAK PERNAH DIHAPUS: customers, purchases, invoices, google_tokens

const CLEANUP_DAYS = 30;

/**
 * Auto-clean sampah setiap kali cleanup/status dipanggil
 * Reset tokens yang used/expired langsung dihapus tanpa nunggu
 */
async function autoCleanTrash() {
    try {
        const { rowCount } = await db.query(
            `DELETE FROM admin_reset_tokens WHERE used = TRUE OR expires_at < NOW()`
        );
        if (rowCount > 0) console.log(`🗑️ Auto-clean: ${rowCount} expired/used reset tokens deleted`);
    } catch (e) {
        console.warn('Auto-clean tokens failed:', e.message);
    }
}

/**
 * Get cleanup status - berapa data lama, warning countdown
 * GET /api/admin/cleanup/status
 */
exports.getCleanupStatus = async (req, res) => {
    try {
        // Auto-clean sampah dulu
        await autoCleanTrash();

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_DAYS);

        // Messages > 30 hari
        const { rows: [msgCount] } = await db.query(
            `SELECT COUNT(*) as total FROM messages WHERE sent_at < $1`,
            [cutoffDate]
        );

        // Broadcast jobs yang SELESAI > 30 hari lalu
        const { rows: [bcastJobCount] } = await db.query(
            `SELECT COUNT(*) as total FROM broadcast_jobs
             WHERE status IN ('completed','stopped') AND created_at < $1`,
            [cutoffDate]
        );

        // Broadcast recipients dari job yang SELESAI > 30 hari lalu
        const { rows: [bcastRecCount] } = await db.query(
            `SELECT COUNT(*) as total FROM broadcast_recipients
             WHERE job_id IN (
                SELECT id FROM broadcast_jobs
                WHERE status IN ('completed','stopped') AND created_at < $1
             )`,
            [cutoffDate]
        );

        // WA message log > 30 hari
        const { rows: [waLogCount] } = await db.query(
            `SELECT COUNT(*) as total FROM whatsapp_logs WHERE created_at < $1`,
            [cutoffDate]
        );

        // WA daily stats > 90 hari
        const cutoff90 = new Date();
        cutoff90.setDate(cutoff90.getDate() - 90);
        const { rows: [waDailyCount] } = await db.query(
            `SELECT COUNT(*) as total FROM wa_daily_stats WHERE stat_date < $1`,
            [cutoff90]
        );

        // Audit logs > 90 hari
        const { rows: [auditCount] } = await db.query(
            `SELECT COUNT(*) as total FROM admin_activity_logs WHERE created_at < $1`,
            [cutoff90]
        );

        // Cari tanggal data paling lama
        const { rows: [oldest] } = await db.query(
            `SELECT MIN(sent_at) as oldest_message FROM messages`
        );

        // Hitung hari sampai cleanup berikutnya
        let daysUntilCleanup = null;
        if (oldest.oldest_message) {
            const oldestDate = new Date(oldest.oldest_message);
            const cleanupDate = new Date(oldestDate);
            cleanupDate.setDate(cleanupDate.getDate() + CLEANUP_DAYS);
            const now = new Date();
            daysUntilCleanup = Math.max(0, Math.ceil((cleanupDate - now) / (1000 * 60 * 60 * 24)));
        }

        const totalOldRecords = parseInt(msgCount.total) + parseInt(bcastJobCount.total) + parseInt(bcastRecCount.total) + parseInt(waLogCount.total) + parseInt(waDailyCount.total) + parseInt(auditCount.total);

        res.json({
            success: true,
            data: {
                oldMessages: parseInt(msgCount.total),
                oldBroadcastJobs: parseInt(bcastJobCount.total),
                oldBroadcastRecipients: parseInt(bcastRecCount.total),
                oldWALogs: parseInt(waLogCount.total),
                oldWADailyStats: parseInt(waDailyCount.total),
                oldAuditLogs: parseInt(auditCount.total),
                totalOldRecords,
                cutoffDate: cutoffDate.toISOString(),
                daysUntilCleanup,
                cleanupDays: CLEANUP_DAYS
            }
        });
    } catch (error) {
        console.error('❌ Cleanup status error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil status cleanup' });
    }
};

/**
 * Export old logs to CSV before deletion
 * GET /api/admin/cleanup/export
 */
exports.exportOldLogs = async (req, res) => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_DAYS);

        // Export messages
        const { rows: messages } = await db.query(
            `SELECT m.id, m.direction, m.message, m.sent_at,
                    c.nama_lengkap, c.whatsapp
             FROM messages m
             LEFT JOIN customers c ON c.id = m.customer_id
             WHERE m.sent_at < $1
             ORDER BY m.sent_at ASC`,
            [cutoffDate]
        );

        // Export broadcast jobs (selesai) + recipients
        const { rows: broadcasts } = await db.query(
            `SELECT bj.id as job_id, bj.message as broadcast_message, bj.status as job_status,
                    bj.total, bj.sent, bj.failed, bj.created_at as job_date,
                    br.customer_name, br.customer_phone, br.status as recipient_status,
                    br.error, br.sent_at
             FROM broadcast_jobs bj
             LEFT JOIN broadcast_recipients br ON br.job_id = bj.id
             WHERE bj.status IN ('completed','stopped') AND bj.created_at < $1
             ORDER BY bj.created_at ASC, br.id ASC`,
            [cutoffDate]
        );

        // Build CSV
        let csv = 'CHAT LOG\n';
        csv += 'ID,Nama,WhatsApp,Direction,Pesan,Tanggal\n';
        messages.forEach(m => {
            const msg = (m.message || '').replace(/"/g, '""').replace(/\n/g, ' ');
            const date = new Date(m.sent_at).toLocaleString('id-ID');
            csv += `${m.id},"${m.nama_lengkap || ''}","${m.whatsapp || ''}",${m.direction},"${msg}","${date}"\n`;
        });

        csv += '\n\nBROADCAST LOG\n';
        csv += 'Job ID,Pesan Broadcast,Status Job,Total,Sent,Failed,Tanggal Job,Nama Penerima,No HP,Status Kirim,Error,Tanggal Kirim\n';
        broadcasts.forEach(b => {
            const bMsg = (b.broadcast_message || '').replace(/"/g, '""').replace(/\n/g, ' ');
            const jobDate = new Date(b.job_date).toLocaleString('id-ID');
            const sentDate = b.sent_at ? new Date(b.sent_at).toLocaleString('id-ID') : '';
            csv += `${b.job_id},"${bMsg}",${b.job_status},${b.total},${b.sent},${b.failed},"${jobDate}","${b.customer_name || ''}","${b.customer_phone || ''}",${b.recipient_status || ''},"${b.error || ''}","${sentDate}"\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="backup-logs-${new Date().toISOString().slice(0,10)}.csv"`);
        res.send('\uFEFF' + csv); // BOM for Excel
    } catch (error) {
        console.error('❌ Export logs error:', error);
        res.status(500).json({ success: false, message: 'Gagal export data' });
    }
};

/**
 * Delete old logs (permanent)
 * POST /api/admin/cleanup/delete
 */
// Tiered retention — successful broadcast/auto-reply logs are pure
// machine bookkeeping (we already saw they delivered, no follow-up needed),
// so 14 days is plenty. Chat messages stay longer (30 days) because admin
// might need to scroll back to follow up on a recent conversation.
const RETENTION = {
    waLogSent:        14,   // SENT whatsapp_logs — fast clean
    waLogFailed:      30,   // FAILED — keep longer so admin can investigate
    broadcastJob:     14,   // completed/stopped broadcast jobs
    broadcastRecip:   14,
    messages:         30,   // chat history — admin context
    waDailyStats:     90,
    auditLogs:        90    // compliance/forensics
};

/**
 * Batched delete — deletes rows in chunks of `batchSize` with a sleep between
 * chunks. Prevents single-DELETE table lock from spiking Supabase CPU and
 * timing out concurrent admin requests. Sleep is short (300ms) because total
 * cleanup volume is small (<50K rows usually) — we just don't want one giant
 * lock.
 */
async function batchedDelete(sql, params, batchSize = 500, sleepMs = 300) {
    let total = 0;
    while (true) {
        // Each iteration deletes up to batchSize matching rows. The IN(subselect LIMIT)
        // pattern is portable and lets Postgres pick the cheapest plan.
        const { rowCount } = await db.query(sql.replace('${batchSize}', String(batchSize)), params);
        if (!rowCount) break;
        total += rowCount;
        if (rowCount < batchSize) break;   // last batch, no need to sleep
        await new Promise(r => setTimeout(r, sleepMs));
    }
    return total;
}

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

/**
 * Internal: actually do the cleanup. Used by both the HTTP endpoint
 * (admin manual click) and the monthly auto-cleanup cron.
 *
 * Uses tiered retention + batched deletes for Supabase-friendly behavior.
 */
async function performCleanup() {
    const tokenDeleted = (await db.query(
        `DELETE FROM admin_reset_tokens WHERE used = TRUE OR expires_at < NOW()`
    )).rowCount;

    const recDeleted = await batchedDelete(
        `DELETE FROM broadcast_recipients
         WHERE id IN (SELECT id FROM broadcast_recipients
                      WHERE job_id IN (SELECT id FROM broadcast_jobs
                                       WHERE status IN ('completed','stopped') AND created_at < $1)
                      LIMIT \${batchSize})`,
        [daysAgo(RETENTION.broadcastRecip)]
    );

    const jobDeleted = await batchedDelete(
        `DELETE FROM broadcast_jobs
         WHERE id IN (SELECT id FROM broadcast_jobs
                      WHERE status IN ('completed','stopped') AND created_at < $1
                      LIMIT \${batchSize})`,
        [daysAgo(RETENTION.broadcastJob)]
    );

    const msgDeleted = await batchedDelete(
        `DELETE FROM messages
         WHERE id IN (SELECT id FROM messages WHERE sent_at < $1 LIMIT \${batchSize})`,
        [daysAgo(RETENTION.messages)]
    );

    // whatsapp_logs split by status — SENT cleans fast, FAILED kept longer for investigation
    const waLogSentDeleted = await batchedDelete(
        `DELETE FROM whatsapp_logs
         WHERE id IN (SELECT id FROM whatsapp_logs
                      WHERE status = 'SENT' AND created_at < $1
                      LIMIT \${batchSize})`,
        [daysAgo(RETENTION.waLogSent)]
    );
    // GUARD: hanya hapus log gagal/terminal yang lama — JANGAN sentuh pesan
    // yang masih menunggu kirim (PENDING/QUEUED/SENDING/RETRYING).
    const waLogOtherDeleted = await batchedDelete(
        `DELETE FROM whatsapp_logs
         WHERE id IN (SELECT id FROM whatsapp_logs
                      WHERE status NOT IN ('SENT','PENDING','QUEUED','SENDING','RETRYING') AND created_at < $1
                      LIMIT \${batchSize})`,
        [daysAgo(RETENTION.waLogFailed)]
    );

    const waDailyDeleted = (await db.query(
        `DELETE FROM wa_daily_stats WHERE stat_date < $1`,
        [daysAgo(RETENTION.waDailyStats)]
    )).rowCount;

    const auditDeleted = await batchedDelete(
        `DELETE FROM admin_activity_logs
         WHERE id IN (SELECT id FROM admin_activity_logs WHERE created_at < $1 LIMIT \${batchSize})`,
        [daysAgo(RETENTION.auditLogs)]
    );

    const waLogDeleted = waLogSentDeleted + waLogOtherDeleted;
    const totalDeleted = recDeleted + jobDeleted + msgDeleted + tokenDeleted + waLogDeleted + waDailyDeleted + auditDeleted;
    return {
        messages: msgDeleted,
        broadcastJobs: jobDeleted,
        broadcastRecipients: recDeleted,
        expiredTokens: tokenDeleted,
        waMessageLogs: waLogDeleted,
        waDailyStats: waDailyDeleted,
        auditLogs: auditDeleted,
        total: totalDeleted
    };
}

/**
 * Aggressive monthly cleanup — wipes ALL logs/messages/broadcasts/audit
 * regardless of age. Keeps customers, purchases, birthday_greetings,
 * app_settings, admins, google_tokens. Intended to be triggered:
 *  - Manually by admin at end of each month (after backup CSV downloaded)
 *  - Automatically by cron on the 1st as a safety net for forgotten months
 *
 * Why aggressive (vs age-based): user's WA logs are also visible on their
 * phone's WA Business app, so DB copies are redundant for shop continuity.
 * Wiping monthly keeps Supabase free-tier comfortable indefinitely.
 */
async function performMonthlyAggressiveCleanup() {
    const tokenDeleted = (await db.query(
        `DELETE FROM admin_reset_tokens`
    )).rowCount;

    const recDeleted = await batchedDelete(
        `DELETE FROM broadcast_recipients
         WHERE id IN (SELECT id FROM broadcast_recipients LIMIT \${batchSize})`,
        []
    );

    const jobDeleted = await batchedDelete(
        `DELETE FROM broadcast_jobs
         WHERE id IN (SELECT id FROM broadcast_jobs WHERE status IN ('completed','stopped') LIMIT \${batchSize})`,
        []
    );

    const msgDeleted = await batchedDelete(
        `DELETE FROM messages WHERE id IN (SELECT id FROM messages LIMIT \${batchSize})`,
        []
    );

    // GUARD: jangan pernah hapus pesan yang masih menunggu kirim
    // (PENDING/QUEUED/SENDING/RETRYING). Pesan itu belum pernah terkirim → TIDAK
    // ada di HP → menghapusnya = kehilangan permanen (bug: ~200 manual hilang).
    const waLogDeleted = await batchedDelete(
        `DELETE FROM whatsapp_logs WHERE id IN (SELECT id FROM whatsapp_logs
                      WHERE status NOT IN ('PENDING','QUEUED','SENDING','RETRYING')
                      LIMIT \${batchSize})`,
        []
    );

    const waDailyDeleted = (await db.query(`DELETE FROM wa_daily_stats`)).rowCount;

    const auditDeleted = await batchedDelete(
        `DELETE FROM admin_activity_logs WHERE id IN (SELECT id FROM admin_activity_logs LIMIT \${batchSize})`,
        []
    );

    // Record timestamp so the dashboard banner & backup button can react.
    await db.query(
        `INSERT INTO app_settings (key, value) VALUES ('last_monthly_cleanup_at', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [new Date().toISOString()]
    );

    const total = recDeleted + jobDeleted + msgDeleted + tokenDeleted + waLogDeleted + waDailyDeleted + auditDeleted;
    return {
        messages: msgDeleted,
        broadcastJobs: jobDeleted,
        broadcastRecipients: recDeleted,
        expiredTokens: tokenDeleted,
        waMessageLogs: waLogDeleted,
        waDailyStats: waDailyDeleted,
        auditLogs: auditDeleted,
        total
    };
}

/**
 * Monthly auto-cleanup cron entry point. Idempotent — running it twice
 * on the same day just deletes the (now-empty) tables again, no-op.
 */
exports.cronMonthlyCleanup = async function() {
    console.log('[Cron] Running monthly aggressive cleanup...');
    try {
        const result = await performMonthlyAggressiveCleanup();
        console.log(`[Cron] Cleanup done: ${result.total} rows removed`,
            `(msg=${result.messages}, wa_log=${result.waMessageLogs}, audit=${result.auditLogs})`);
        await db.query(
            `INSERT INTO admin_activity_logs (admin_id, admin_username, action, detail, ip_address)
             VALUES (NULL, 'system-cron', 'auto_cleanup', $1, 'localhost')`,
            [`total=${result.total}, msg=${result.messages}, wa_log=${result.waMessageLogs}, audit=${result.auditLogs}`]
        ).catch(() => {});
    } catch (err) {
        console.error('[Cron] Auto-cleanup failed:', err.message);
    }
};

/**
 * Monthly cleanup HTTP endpoint (manual trigger from Customer tab).
 * POST /api/admin/cleanup/monthly
 */
exports.monthlyCleanup = async function(req, res) {
    try {
        const result = await performMonthlyAggressiveCleanup();
        await db.query(
            `INSERT INTO admin_activity_logs (admin_id, admin_username, action, detail, ip_address)
             VALUES ($1, $2, 'monthly_cleanup', $3, $4)`,
            [req.admin?.id || null, req.admin?.username || 'unknown',
             `total=${result.total}`, req.ip]
        ).catch(() => {});
        res.json({ success: true, deleted: result });
    } catch (err) {
        console.error('❌ Monthly cleanup error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteOldLogs = async (req, res) => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_DAYS);

        // 1. Hapus reset tokens (sampah, langsung hapus semua yg used/expired)
        const { rowCount: tokenDeleted } = await db.query(
            `DELETE FROM admin_reset_tokens WHERE used = TRUE OR expires_at < NOW()`
        );

        // 2. Hapus broadcast recipients dari job yang SELESAI > 30 hari
        const { rowCount: recDeleted } = await db.query(
            `DELETE FROM broadcast_recipients
             WHERE job_id IN (
                SELECT id FROM broadcast_jobs
                WHERE status IN ('completed','stopped') AND created_at < $1
             )`,
            [cutoffDate]
        );

        // 3. Hapus broadcast jobs yang SELESAI > 30 hari
        const { rowCount: jobDeleted } = await db.query(
            `DELETE FROM broadcast_jobs
             WHERE status IN ('completed','stopped') AND created_at < $1`,
            [cutoffDate]
        );

        // 4. Hapus messages > 30 hari
        const { rowCount: msgDeleted } = await db.query(
            `DELETE FROM messages WHERE sent_at < $1`,
            [cutoffDate]
        );

        // 5. Hapus whatsapp_logs > 30 hari
        const { rowCount: waLogDeleted } = await db.query(
            `DELETE FROM whatsapp_logs WHERE created_at < $1`,
            [cutoffDate]
        );

        // 6. Hapus wa_daily_stats > 90 hari
        const cutoff90 = new Date();
        cutoff90.setDate(cutoff90.getDate() - 90);
        const { rowCount: waDailyDeleted } = await db.query(
            `DELETE FROM wa_daily_stats WHERE stat_date < $1`,
            [cutoff90]
        );

        // 7. Hapus admin_activity_logs > 90 hari
        const { rowCount: auditDeleted } = await db.query(
            `DELETE FROM admin_activity_logs WHERE created_at < $1`,
            [cutoff90]
        );

        const totalDeleted = recDeleted + jobDeleted + msgDeleted + tokenDeleted + waLogDeleted + waDailyDeleted + auditDeleted;

        console.log(`Cleanup: ${msgDeleted} messages, ${jobDeleted} jobs, ${recDeleted} recipients, ${tokenDeleted} tokens, ${waLogDeleted} wa_logs, ${waDailyDeleted} wa_daily, ${auditDeleted} audit_logs`);

        res.json({
            success: true,
            message: `${totalDeleted} data lama berhasil dihapus`,
            deleted: {
                messages: msgDeleted,
                broadcastJobs: jobDeleted,
                broadcastRecipients: recDeleted,
                expiredTokens: tokenDeleted,
                waMessageLogs: waLogDeleted,
                waDailyStats: waDailyDeleted,
                auditLogs: auditDeleted,
                total: totalDeleted
            }
        });
    } catch (error) {
        console.error('❌ Delete logs error:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus data' });
    }
};

// ============================================
// AUDIT TRAIL
// ============================================

/**
 * Get admin activity logs
 * GET /api/admin/audit-log?limit=50
 */
exports.getAuditLog = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const { rows } = await db.query(
            `SELECT id, admin_username, action, detail, ip_address, created_at
             FROM admin_activity_logs
             ORDER BY created_at DESC LIMIT $1`,
            [limit]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('❌ Audit log error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil audit log' });
    }
};

// ============================================
// FULL DB BACKUP — owner downloads everything as a single CSV
// (all customers, purchases, messages, broadcast, etc.)
//
// Unlike exportOldLogs which only dumps data eligible for deletion,
// this exports the ENTIRE working dataset for safekeeping. Run this
// before any auto-cleanup, before major changes, or just on a schedule.
// ============================================
function escapeCsv(v) {
    if (v === null || v === undefined) return '';
    // pg returns TIMESTAMP columns as JS Date objects. Build the WITA string
    // manually instead of relying on toLocaleString — that one inserts a comma
    // between the date and time portion (e.g. "11/05/2026, 08.00.00") which
    // breaks the CSV column boundary and shifts every subsequent column.
    if (v instanceof Date) {
        if (isNaN(v.getTime())) return '';
        // WITA = UTC+8. Shift UTC ms by 8h then read .getUTC* parts.
        const wita = new Date(v.getTime() + 8 * 60 * 60 * 1000);
        const pad = n => String(n).padStart(2, '0');
        const dd = pad(wita.getUTCDate());
        const mm = pad(wita.getUTCMonth() + 1);
        const yyyy = wita.getUTCFullYear();
        const hh = pad(wita.getUTCHours());
        const mi = pad(wita.getUTCMinutes());
        const ss = pad(wita.getUTCSeconds());
        return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss} WITA`;
    }
    const s = String(v);
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function rowsToCsv(rows, columns) {
    let csv = columns.join(',') + '\n';
    for (const row of rows) {
        csv += columns.map(c => escapeCsv(row[c])).join(',') + '\n';
    }
    return csv;
}

// Defensive table dump — uses SELECT * so schema differences across migrations
// don't break the backup. Columns are auto-detected from the result.fields
// metadata. If the table doesn't exist, skips silently and returns "" so the
// rest of the backup can still complete.
async function dumpTable(sectionLabel, sql, params = [], headerOverride = null) {
    try {
        const result = await db.query(sql, params);
        const columns = headerOverride || result.fields.map(f => f.name);
        if (result.rows.length === 0) {
            return `=== ${sectionLabel} (0 rows) ===\n${columns.join(',')}\n\n`;
        }
        return `=== ${sectionLabel} (${result.rows.length} rows) ===\n` + rowsToCsv(result.rows, columns) + '\n';
    } catch (err) {
        console.warn(`[Backup] Could not dump ${sectionLabel}: ${err.message}`);
        return `=== ${sectionLabel} (skipped: ${err.message}) ===\n\n`;
    }
}

exports.fullBackup = async (req, res) => {
    try {
        const __ts = new Date().toISOString();
        let csv = `# CAHAYA PHONE FULL BACKUP\n# Generated: ${__ts}\n# All sections use SELECT * so columns reflect your CURRENT schema.\n\n`;

        // CUSTOMERS — augmented with computed purchase aggregates via LEFT JOIN.
        // c.* dumps whatever columns customers actually has — schema drift safe.
        csv += await dumpTable('CUSTOMERS',
            `SELECT c.*,
                    p.last_purchase_at,
                    COALESCE(p.total_spent, 0) AS total_spent,
                    COALESCE(p.purchase_count, 0) AS purchase_count
             FROM customers c
             LEFT JOIN (
                 SELECT customer_id,
                        MAX(created_at) AS last_purchase_at,
                        SUM(COALESCE(harga, 0) * COALESCE(qty, 1)) AS total_spent,
                        COUNT(*) AS purchase_count
                 FROM purchases GROUP BY customer_id
             ) p ON p.customer_id = c.id
             ORDER BY c.id ASC`
        );

        // PURCHASES joined with customer info → owner can read "Budi beli iPhone 15
        // Rp 16jt dari sales Yusuf pada 11/05/2026" directly in the CSV, no need to
        // cross-reference customer_id.
        csv += await dumpTable('PURCHASES (with customer info)',
            `SELECT p.id, p.customer_id,
                    c.nama_lengkap AS customer_nama, c.whatsapp AS customer_whatsapp,
                    p.merk_unit, p.tipe_unit, p.harga, p.qty,
                    (COALESCE(p.harga, 0) * COALESCE(p.qty, 1)) AS subtotal,
                    p.nama_sales, p.metode_pembayaran, p.source, p.created_at
             FROM purchases p
             LEFT JOIN customers c ON c.id = p.customer_id
             ORDER BY p.created_at DESC`
        );

        csv += await dumpTable('BROADCAST JOBS', `SELECT * FROM broadcast_jobs ORDER BY id ASC`);
        csv += await dumpTable('BROADCAST RECIPIENTS', `SELECT * FROM broadcast_recipients ORDER BY id ASC`);

        csv += await dumpTable('BIRTHDAY GREETINGS',
            `SELECT bg.*, c.nama_lengkap AS customer_nama, c.whatsapp AS customer_whatsapp
             FROM birthday_greetings bg LEFT JOIN customers c ON c.id = bg.customer_id
             ORDER BY bg.id ASC`
        );

        // Admins — explicit column list (NEVER include password hash in backup).
        csv += await dumpTable('ADMINS (no passwords)',
            `SELECT id, username, nama, email, role, created_at FROM admins ORDER BY id ASC`,
            [],
            ['id', 'username', 'nama', 'email', 'role', 'created_at']
        );

        csv += await dumpTable('APP SETTINGS', `SELECT * FROM app_settings ORDER BY key ASC`);

        const filename = `cahaya-phone-full-backup-${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('﻿' + csv);   // BOM for Excel

        db.query(
            `INSERT INTO app_settings (key, value) VALUES ('last_backup_at', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [new Date().toISOString()]
        ).catch(err => console.warn('[Backup] Could not save timestamp:', err.message));
        return;
    } catch (err) {
        console.error('❌ Full backup error:', err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Gagal generate backup: ' + err.message });
        }
        return;
    }

    // === DEAD CODE BELOW — kept temporarily; safe to delete in a follow-up commit ===
    /* DISABLED LEGACY PATH
        const { rows: customers } = await db.query(
            `SELECT c.id, c.nama_lengkap, c.whatsapp, c.source, c.status, c.tipe,
                    c.tanggal_lahir, c.alamat, c.merk_unit, c.tipe_unit, c.harga, c.qty,
                    c.nama_sales, c.metode_pembayaran, c.tahu_dari, c.opted_in, c.catatan,
                    c.wa_sent, c.last_incoming_message_at, c.created_at, c.updated_at,
                    p.last_purchase_at,
                    COALESCE(p.total_spent, 0) AS total_spent,
                    COALESCE(p.purchase_count, 0) AS purchase_count
             FROM customers c
             LEFT JOIN (
                 SELECT customer_id,
                        MAX(created_at) AS last_purchase_at,
                        SUM(COALESCE(harga, 0) * COALESCE(qty, 1)) AS total_spent,
                        COUNT(*) AS purchase_count
                 FROM purchases GROUP BY customer_id
             ) p ON p.customer_id = c.id
             ORDER BY c.id ASC`
        );

        const { rows: purchases } = await db.query(
            `SELECT id, customer_id, merk_unit, tipe_unit, harga, qty, nama_sales,
                    metode_pembayaran, source, created_at
             FROM purchases ORDER BY id ASC`
        );

        // Messages — limit to last 6 months to keep file size reasonable; older
        // is in cleanup-export. Owner needs recent chat history for ops continuity.
        const { rows: messages } = await db.query(
            `SELECT m.id, m.customer_id, c.nama_lengkap, c.whatsapp, m.direction,
                    m.message, m.wa_message_id, m.sent_at
             FROM messages m
             LEFT JOIN customers c ON c.id = m.customer_id
             WHERE m.sent_at > NOW() - INTERVAL '6 months'
             ORDER BY m.id ASC`
        );

        const { rows: broadcastJobs } = await db.query(
            `SELECT id, name, message, source_filter, status, total, sent, failed,
                    created_at, completed_at
             FROM broadcast_jobs ORDER BY id ASC`
        );

        const { rows: birthdayGreetings } = await db.query(
            `SELECT bg.id, bg.customer_id, c.nama_lengkap, c.whatsapp,
                    bg.greeting_year, bg.message, bg.status, bg.error, bg.sent_at
             FROM birthday_greetings bg
             LEFT JOIN customers c ON c.id = bg.customer_id
             ORDER BY bg.id ASC`
        );

        const { rows: admins } = await db.query(
            `SELECT id, username, nama, email, role, created_at FROM admins ORDER BY id ASC`
        );

        const { rows: appSettings } = await db.query(
            `SELECT key, value, updated_at FROM app_settings ORDER BY key ASC`
        );

        const now = new Date().toISOString();
        let csv = `# CAHAYA PHONE FULL BACKUP\n# Generated: ${now}\n# Customers: ${customers.length} | Purchases: ${purchases.length} | Messages (last 6mo): ${messages.length}\n# Broadcasts: ${broadcastJobs.length} | Birthdays: ${birthdayGreetings.length} | Admins: ${admins.length}\n\n`;

        csv += '=== CUSTOMERS ===\n';
        csv += rowsToCsv(customers, ['id', 'nama_lengkap', 'whatsapp', 'source', 'status', 'tipe', 'tanggal_lahir', 'alamat', 'merk_unit', 'tipe_unit', 'harga', 'qty', 'nama_sales', 'metode_pembayaran', 'tahu_dari', 'opted_in', 'catatan', 'wa_sent', 'purchase_count', 'total_spent', 'last_purchase_at', 'last_incoming_message_at', 'created_at', 'updated_at']);

        csv += '\n=== PURCHASES ===\n';
        csv += rowsToCsv(purchases, ['id', 'customer_id', 'merk_unit', 'tipe_unit', 'harga', 'qty', 'nama_sales', 'metode_pembayaran', 'source', 'created_at']);

        csv += '\n=== MESSAGES (last 6 months) ===\n';
        csv += rowsToCsv(messages, ['id', 'customer_id', 'nama_lengkap', 'whatsapp', 'direction', 'message', 'wa_message_id', 'sent_at']);

        csv += '\n=== BROADCAST JOBS ===\n';
        csv += rowsToCsv(broadcastJobs, ['id', 'name', 'message', 'source_filter', 'status', 'total', 'sent', 'failed', 'created_at', 'completed_at']);

        csv += '\n=== BIRTHDAY GREETINGS ===\n';
        csv += rowsToCsv(birthdayGreetings, ['id', 'customer_id', 'nama_lengkap', 'whatsapp', 'greeting_year', 'message', 'status', 'error', 'sent_at']);

        csv += '\n=== ADMINS (no passwords) ===\n';
        csv += rowsToCsv(admins, ['id', 'username', 'nama', 'email', 'role', 'created_at']);

        csv += '\n=== APP SETTINGS ===\n';
        csv += rowsToCsv(appSettings, ['key', 'value', 'updated_at']);

        const filename = `cahaya-phone-full-backup-${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('﻿' + csv);   // BOM for Excel

        // Mark the timestamp so the dashboard monthly-backup banner can compute
        // "X days since last backup" and remind the owner if it's >30 days.
        db.query(
            `INSERT INTO app_settings (key, value) VALUES ('last_backup_at', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [new Date().toISOString()]
        ).catch(err => console.warn('[Backup] Could not save timestamp:', err.message));
    } catch (err) {
        console.error('❌ Full backup error (legacy path):', err);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Gagal generate backup: ' + err.message });
    }
    */
};

/**
 * GET /api/admin/backup/status — drives the end-of-month banner + the
 * backup button's disabled state. Returns:
 *  - lastBackupAt, lastCleanupAt   (when those last ran)
 *  - isEndOfMonth                  (today is last day of month, WITA)
 *  - cleanedThisMonth              (already cleaned in current WITA month)
 *  - newDataSinceCleanup           (any activity since last cleanup)
 *  - showBanner                    (= isEndOfMonth && !cleanedThisMonth && newDataSinceCleanup)
 *  - canBackup                     (= newDataSinceCleanup OR never cleaned)
 *
 * Frontend uses showBanner to render the reminder, and canBackup to enable/
 * disable the Download Full Backup button. "Tombol gak bisa dipencet sampai
 * ada data baru" maps to canBackup === false.
 */
exports.getBackupStatus = async (req, res) => {
    try {
        const { rows: settingRows } = await db.query(
            `SELECT key, value FROM app_settings WHERE key IN ('last_backup_at', 'last_monthly_cleanup_at')`
        );
        const map = Object.fromEntries(settingRows.map(r => [r.key, r.value]));
        const lastBackup = map.last_backup_at ? new Date(map.last_backup_at) : null;
        const lastCleanup = map.last_monthly_cleanup_at ? new Date(map.last_monthly_cleanup_at) : null;

        // WITA today's date pieces
        const wita = new Date(Date.now() + 8 * 60 * 60 * 1000);
        const dy = wita.getUTCDate();
        const dm = wita.getUTCMonth();
        const dyear = wita.getUTCFullYear();
        const lastDayOfMonth = new Date(dyear, dm + 1, 0).getDate();
        const isEndOfMonth = dy >= lastDayOfMonth;

        // Has cleanup already happened this WITA month?
        let cleanedThisMonth = false;
        if (lastCleanup) {
            const cleanupWita = new Date(lastCleanup.getTime() + 8 * 60 * 60 * 1000);
            cleanedThisMonth = (cleanupWita.getUTCMonth() === dm && cleanupWita.getUTCFullYear() === dyear);
        }

        // "newDataSinceCleanup": any new customer / message / wa_log row created
        // after the last cleanup timestamp. If never cleaned, anything counts as new.
        let newDataSinceCleanup = true;
        if (lastCleanup) {
            const sinceParam = lastCleanup.toISOString();
            // Cheap EXISTS query — return true if ANY of the three has fresh rows.
            // Each subquery short-circuits on first match thanks to LIMIT 1.
            try {
                const { rows } = await db.query(
                    `SELECT
                        EXISTS (SELECT 1 FROM customers WHERE created_at > $1 LIMIT 1)
                     OR EXISTS (SELECT 1 FROM messages WHERE sent_at > $1 LIMIT 1)
                     OR EXISTS (SELECT 1 FROM whatsapp_logs WHERE created_at > $1 LIMIT 1)
                        AS has_new`,
                    [sinceParam]
                );
                newDataSinceCleanup = !!rows[0]?.has_new;
            } catch (e) {
                console.warn('[BackupStatus] new-data probe failed:', e.message);
                newDataSinceCleanup = true;  // fail-safe: assume new data so button still works
            }
        }

        const daysSinceBackup = lastBackup
            ? Math.floor((Date.now() - lastBackup.getTime()) / (1000 * 60 * 60 * 24))
            : null;

        const showBanner = isEndOfMonth && !cleanedThisMonth && newDataSinceCleanup;
        const canBackup = newDataSinceCleanup;

        res.json({
            success: true,
            data: {
                lastBackupAt: lastBackup ? lastBackup.toISOString() : null,
                lastCleanupAt: lastCleanup ? lastCleanup.toISOString() : null,
                daysSinceBackup,
                isEndOfMonth,
                cleanedThisMonth,
                newDataSinceCleanup,
                canBackup,
                showBanner,
                lastDayOfMonth,
                todayDayOfMonth: dy
            }
        });
    } catch (err) {
        console.error('❌ Backup status error:', err);
        res.status(500).json({ success: false, message: 'Gagal cek status backup' });
    }
};

/**
 * Resource usage snapshot — shows DB size, row counts, last cleanup info.
 * Helps owner decide when to manually run cleanup.
 * GET /api/admin/resource-usage
 */
exports.getResourceUsage = async (req, res) => {
    // Defensive: query each table independently so a missing/permission-denied
    // table doesn't blow up the whole response. The previous version's UNION ALL
    // would fail entirely if ANY one query errored — that's why the frontend
    // was stuck on "Memuat info storage..." indefinitely.
    const tables = [
        'customers', 'messages', 'whatsapp_logs', 'broadcast_recipients',
        'broadcast_jobs', 'purchases', 'admin_activity_logs', 'birthday_greetings'
    ];
    const counts = [];
    let totalRowEstimate = 0;

    for (const t of tables) {
        try {
            // to_regclass returns NULL if table doesn't exist (no error thrown).
            const { rows } = await db.query(
                `SELECT CASE WHEN to_regclass($1) IS NOT NULL
                    THEN (SELECT COUNT(*) FROM ${t})::int
                    ELSE NULL END AS rows`,
                [t]
            );
            const rowCount = rows[0]?.rows;
            if (rowCount !== null && rowCount !== undefined) {
                counts.push({ table_name: t, rows: rowCount });
                totalRowEstimate += rowCount;
            }
        } catch (err) {
            console.warn(`[Resource] Could not count ${t}: ${err.message}`);
        }
    }

    // pg_database_size sometimes blocked on managed Postgres — try, fall back to estimate.
    let dbSizeBytes = 0;
    try {
        const { rows } = await db.query(
            `SELECT pg_database_size(current_database())::bigint AS bytes`
        );
        dbSizeBytes = Number(rows[0].bytes);
    } catch (_) {
        dbSizeBytes = totalRowEstimate * 600;  // ~600 bytes/row rough average
    }

    let oldestMessageDate = null;
    try {
        const { rows } = await db.query(`SELECT MIN(sent_at) AS oldest FROM messages`);
        oldestMessageDate = rows[0]?.oldest || null;
    } catch (_) { /* ignore */ }

    const sizeMB = Number((dbSizeBytes / (1024 * 1024)).toFixed(2));
    const supabaseFreeLimit = 500;
    const pctUsed = Number(((sizeMB / supabaseFreeLimit) * 100).toFixed(1));

    res.json({
        success: true,
        data: {
            tableCounts: counts,
            dbSizeBytes,
            dbSizeMB: sizeMB,
            supabaseFreeLimitMB: supabaseFreeLimit,
            pctOfFreeTier: pctUsed,
            oldestMessageDate,
            warning: pctUsed > 70 ? 'Database mendekati batas free tier. Backup + cleanup segera.' : null
        }
    });
};

/**
 * Railway billing status — banner shows only on H, H+1, H+2 in WITA.
 *
 * cycleKey (YYYY-MM of the billing event) lets the frontend hard-dismiss
 * the whole cycle when the owner clicks "Buka Railway" (treated as paid).
 * Next cycle gets a new cycleKey, so the banner returns automatically.
 *
 * GET /api/admin/billing-status
 */
exports.getBillingStatus = async (req, res) => {
    try {
        const billingDay = Math.max(1, Math.min(28, Number(process.env.BILLING_DAY) || 11));

        const nowUtcMs = Date.now();
        const wita = new Date(nowUtcMs + 8 * 60 * 60 * 1000);
        const todayDay = wita.getUTCDate();
        const todayMonth = wita.getUTCMonth();
        const todayYear = wita.getUTCFullYear();

        const daysPast = (todayDay >= billingDay && todayDay <= billingDay + 2)
            ? todayDay - billingDay
            : -1;

        let severity = 'none';
        let title = '';
        let message = '';

        if (daysPast === 0) {
            severity = 'urgent';
            title = `Hari ini tanggal billing Railway`;
            message = `Pastikan kartu sudah ter-charge sukses. Cek email Railway atau dashboard untuk konfirmasi.`;
        } else if (daysPast === 1 || daysPast === 2) {
            severity = 'overdue';
            title = `${daysPast} hari lewat dari billing Railway`;
            message = `Kalau ada masalah payment, masih ada grace period ~5 hari sebelum service di-suspend. Cek dashboard Railway sekarang.`;
        }

        // cycleKey = YYYY-MM of the billing event being reminded about.
        // Only meaningful when severity != 'none' (i.e. daysPast in [0,2]),
        // so the billing event is always this month.
        const cycleKey = `${todayYear}-${String(todayMonth + 1).padStart(2, '0')}`;

        res.json({
            success: true,
            data: {
                billingDay,
                daysPastBilling: daysPast,
                cycleKey,
                severity,
                title,
                message,
                show: severity !== 'none'
            }
        });
    } catch (err) {
        console.error('❌ Billing status error:', err.message);
        res.status(500).json({ success: false, message: 'Gagal cek status billing' });
    }
};

// ============================================
// APP SETTINGS: Global ON/OFF toggles
// ============================================

const AUTO_TOGGLE_KEYS = ['form_autoreply_enabled', 'birthday_auto_send'];

/**
 * Get semua toggle auto-send (form + birthday)
 * GET /api/admin/settings/auto-toggles
 */
exports.getAutoToggles = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
            [AUTO_TOGGLE_KEYS]
        );
        const map = {};
        for (const r of rows) map[r.key] = r.value !== 'false';

        res.json({
            success: true,
            data: {
                form_autoreply_enabled: map.form_autoreply_enabled !== false,
                birthday_auto_send: map.birthday_auto_send !== false
            }
        });
    } catch (error) {
        console.error('❌ getAutoToggles error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan' });
    }
};

/**
 * Update toggle auto-send
 * POST /api/admin/settings/auto-toggles
 * Body: { key: 'form_autoreply_enabled' | 'birthday_auto_send', enabled: boolean }
 */
exports.setAutoToggle = async (req, res) => {
    try {
        const { key, enabled } = req.body;
        if (!AUTO_TOGGLE_KEYS.includes(key)) {
            return res.status(400).json({ success: false, message: 'Key tidak valid' });
        }
        await db.query(
            `INSERT INTO app_settings (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
            [key, String(!!enabled)]
        );
        res.json({ success: true, key, enabled: !!enabled });
    } catch (error) {
        console.error('❌ setAutoToggle error:', error);
        res.status(500).json({ success: false, message: 'Gagal update pengaturan' });
    }
};

/**
 * GET /api/admin/purchases/metadata
 * Returns distinct merk_unit and metode_pembayaran values for dropdown hints.
 */
exports.getPurchaseMetadata = async (req, res) => {
    try {
        const [merkRes, pembayaranRes] = await Promise.all([
            db.query(`SELECT DISTINCT merk_unit FROM purchases WHERE merk_unit IS NOT NULL AND merk_unit != '' ORDER BY merk_unit`),
            db.query(`SELECT DISTINCT metode_pembayaran FROM purchases WHERE metode_pembayaran IS NOT NULL AND metode_pembayaran != '' ORDER BY metode_pembayaran`)
        ]);
        res.json({
            success: true,
            data: {
                merk_units: merkRes.rows.map(r => r.merk_unit),
                metode_pembayaran: pembayaranRes.rows.map(r => r.metode_pembayaran)
            }
        });
    } catch (error) {
        console.error('❌ getPurchaseMetadata error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil metadata pembelian' });
    }
};
