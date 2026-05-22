// ============================================
// FORM CONTROLLER
// Handle customer form submissions
// ============================================

const db = require('../config/database');
const whatsappService = require('../config/whatsapp');
const googleService = require('../config/google');
const { sanitizePhone, validatePhone } = require('../utils/phoneUtils');
const { normalizeBrandAndModel } = require('../utils/brandUtils');

/**
 * Submit customer form
 * POST /api/form-submit
 */
exports.submitForm = async (req, res) => {
    try {
        const {
            nama, nama_lengkap, email, whatsapp, alamat, kota,
            nama_sales, merk_unit, tipe_unit, harga, qty,
            tanggal_lahir, metode_pembayaran, tahu_dari, opted_in
        } = req.body;

        const finalName = nama || nama_lengkap;

        // Honeypot trap — bots auto-fill every <input>; humans never see this field.
        // Silently 200 so the bot thinks it succeeded and doesn't probe further.
        if (req.body.website_url) {
            console.warn('[FORM] Honeypot tripped from', req.ip, '— rejecting silently');
            return res.json({ success: true, message: 'Pendaftaran berhasil. Terima kasih!' });
        }

        if (!finalName || !whatsapp) {
            return res.status(400).json({
                success: false,
                message: 'Nama dan No. WhatsApp wajib diisi'
            });
        }

        // Per-field length caps (DoS guard + sanity check). Any field exceeding the cap
        // is rejected outright — legitimate values are well within these limits.
        const lengthCaps = {
            nama: 100, nama_lengkap: 100, email: 120, alamat: 300, kota: 60,
            nama_sales: 60, merk_unit: 60, tipe_unit: 80, tahu_dari: 100,
            metode_pembayaran: 40
        };
        for (const [field, max] of Object.entries(lengthCaps)) {
            const v = req.body[field];
            if (typeof v === 'string' && v.length > max) {
                return res.status(400).json({
                    success: false,
                    message: `Field "${field}" terlalu panjang (maks ${max} karakter).`
                });
            }
        }

        // Sanitize & validate phone number (backend validation)
        const cleanPhone = sanitizePhone(whatsapp);
        const phoneCheck = validatePhone(cleanPhone);
        if (!phoneCheck.valid) {
            return res.status(400).json({ success: false, message: phoneCheck.message });
        }

        const extra = [];
        if (kota) extra.push(`Kota: ${kota}`);
        if (email) extra.push(`Email: ${email}`);
        const fullAddress = [alamat, extra.join(' | ')].filter(Boolean).join(' | ');

        const parsedHarga = harga ? parseFloat(harga) : null;
        const parsedQty = qty ? parseInt(qty, 10) : 1;

        const cleaned = normalizeBrandAndModel(merk_unit, tipe_unit);
        const cleanMerk = cleaned.merk_unit;
        const cleanTipe = cleaned.tipe_unit;

        let source = 'Website';
        if (tahu_dari) {
            const td = String(tahu_dari).trim();
            const tdLower = td.toLowerCase();

            const mappings = [
                { pattern: /\b(ig|insta|instagram|instgram)\b/i, name: 'Instagram' },
                { pattern: /\b(web|website|site|google)\b/i, name: 'Website' },
                { pattern: /\b(fb|facebook|facebk|fesbuk)\b/i, name: 'Facebook' },
                { pattern: /\b(tt|tiktok|tik tok|tik-tok)\b/i, name: 'TikTok' },
                { pattern: /\b(wa|whatsapp|grup|group)\b/i, name: 'WhatsApp' },
                { pattern: /\b(yt|youtube|yutub)\b/i, name: 'YouTube' },
                { pattern: /\b(tw|twitter|x\.com)\b/i, name: 'Twitter/X' },
                { pattern: /\b(shopee|tokped|tokopedia|lazada|marketplace|olshop)\b/i, name: 'Marketplace' },
                { pattern: /\b(teman|temen|tmn|sodara|saudara|keluarga|klrga|kenal|tetangga|ortu|nyokap|bokap|kakak|adik|om|tante)\b/i, name: 'Teman/Keluarga' },
                { pattern: /\b(lewat|jalan|lalu|numpang|mampir|depan|toko|banner|spanduk|papan)\b/i, name: 'Walk-in' },
                // Repeat buyer / sudah kenal toko — must be checked BEFORE generic fallback
                { pattern: /\b(pernah|langganan|pelanggan|repeat|kembali|lagi|balik|sudah tau|udah tau|kenal|tahu|tau).*(toko|cahaya|phone|hp|kami|sini)\b/i, name: 'Repeat Buyer' },
                { pattern: /\b(konsumen|customer|pembeli).*(pernah|lama|lagi|kembali|balik|tau|tahu|kenal|sudah|udah)\b/i, name: 'Repeat Buyer' },
                { pattern: /\b(pernah beli|udah beli|sudah beli|beli lagi|belanja lagi)\b/i, name: 'Repeat Buyer' }
            ];

            const found = mappings.find(m => m.pattern.test(tdLower));
            if (found) {
                source = found.name;
            } else if (td.trim() === '') {
                source = 'Website';
            } else {
                // Fallback: title-case but HARD CAP at 20 chars to match DB column VARCHAR(20).
                // If it exceeds 20, use 'Lainnya' so we don't silently truncate mid-word.
                const titleCased = td.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                source = titleCased.length <= 20 ? titleCased : 'Lainnya';
            }
        }

        console.log(`🧭 Determined source from tahu_dari='${tahu_dari}' -> source='${source}'`);

        // opted_in defaults to true if not explicitly set to false
        const optedIn = opted_in !== false;

        // Check if this phone already exists (Chat Only OR repeat buyer)
        const { rows: existingCustomer } = await db.query(
            `SELECT id FROM customers WHERE whatsapp = $1 ORDER BY created_at DESC LIMIT 1`,
            [cleanPhone]
        );

        let rows;
        if (existingCustomer.length > 0) {
            // Update existing record (Chat Only → Belanja, or repeat buyer update)
            const result = await db.query(
                `UPDATE customers SET
                    nama_lengkap = $1, nama_sales = $2, merk_unit = $3, tipe_unit = $4,
                    harga = $5, qty = $6, tanggal_lahir = $7, alamat = $8,
                    metode_pembayaran = $9, tahu_dari = $10, source = $11,
                    status = 'Completed', opted_in = $12, tipe = 'Belanja', updated_at = NOW()
                WHERE id = $13 RETURNING id`,
                [
                    finalName, nama_sales || null, cleanMerk, cleanTipe,
                    parsedHarga, parsedQty, tanggal_lahir || null, fullAddress,
                    metode_pembayaran || null, tahu_dari || null, source,
                    optedIn, existingCustomer[0].id
                ]
            );
            rows = result.rows;
        } else {
            // New customer
            const result = await db.query(
                `INSERT INTO customers (
                    nama_lengkap, nama_sales, merk_unit, tipe_unit, harga, qty,
                    tanggal_lahir, alamat, whatsapp, metode_pembayaran, tahu_dari, source, status, opted_in, tipe
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Completed', $13, 'Belanja')
                ON CONFLICT (whatsapp) DO UPDATE SET
                    nama_lengkap = EXCLUDED.nama_lengkap, nama_sales = EXCLUDED.nama_sales,
                    merk_unit = EXCLUDED.merk_unit, tipe_unit = EXCLUDED.tipe_unit,
                    harga = EXCLUDED.harga, qty = EXCLUDED.qty,
                    tanggal_lahir = EXCLUDED.tanggal_lahir, alamat = EXCLUDED.alamat,
                    metode_pembayaran = EXCLUDED.metode_pembayaran, tahu_dari = EXCLUDED.tahu_dari,
                    source = EXCLUDED.source, status = 'Completed', opted_in = EXCLUDED.opted_in,
                    tipe = 'Belanja', updated_at = NOW()
                RETURNING id`,
                [
                    finalName, nama_sales || null, cleanMerk, cleanTipe,
                    parsedHarga, parsedQty, tanggal_lahir || null, fullAddress,
                    cleanPhone, metode_pembayaran || null, tahu_dari || null, source, optedIn
                ]
            );
            rows = result.rows;
        }

        const customerId = rows[0].id;

        // Snapshot toggle state sekarang — disimpan ke purchase agar boot reconcile
        // tahu auto_dispatch yang benar kalau enqueue gagal (crash/error).
        const { rows: toggleSetting } = await db.query(
            `SELECT value FROM app_settings WHERE key = 'form_autoreply_enabled'`
        );
        const autoReplyEnabled = toggleSetting.length === 0 || toggleSetting[0].value !== 'false';

        // Record purchase in purchases history table
        let purchaseId = null;
        if (parsedHarga || cleanMerk || cleanTipe) {
            const { rows: pRows } = await db.query(
                `INSERT INTO purchases (customer_id, merk_unit, tipe_unit, harga, qty, nama_sales, metode_pembayaran, source, wa_auto_dispatch, wa_enqueued)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
                 RETURNING id`,
                [customerId, cleanMerk, cleanTipe, parsedHarga, parsedQty, nama_sales || null, metode_pembayaran || null, source, autoReplyEnabled]
            );
            purchaseId = pRows[0].id;
        }

        await db.query(
            `INSERT INTO messages (customer_id, direction, message) VALUES ($1, 'out', $2)`,
            [customerId, `Terima kasih ${finalName}, data Anda telah kami terima. Tim kami akan menghubungi segera.`]
        );

        // Response langsung (cepat!) — WA dan Google jalan di background
        res.json({
            success: true,
            message: 'Pendaftaran berhasil. Terima kasih!',
            customer_id: customerId
        });

        // Background: enqueue WA auto-reply (tidak blocking response).
        // Toggle state sudah di-snapshot ke purchases.wa_auto_dispatch di atas,
        // jadi kalau crash sebelum enqueue, boot reconcile tahu harus pakai nilai apa.
        (async () => {
            try {
                console.log(`[Form] Enqueue auto-reply for ${cleanPhone}: toggle=${autoReplyEnabled ? 'ON' : 'OFF'} → auto_dispatch=${autoReplyEnabled}`);
                const waResult = await whatsappService.enqueueAutoReply(
                    { nama_lengkap: finalName, whatsapp: cleanPhone },
                    { autoDispatch: autoReplyEnabled, skipNumberCheck: true }
                );

                if (!waResult || !waResult.success) {
                    console.warn('⚠️ enqueueAutoReply returned non-success:', waResult?.error);
                    const invalidNumber = waResult?.registered === false || /Invalid phone number|Nomor tidak terdaftar/i.test(waResult?.error || '');
                    await db.query(
                        invalidNumber
                            ? 'UPDATE customers SET wa_sent = NULL WHERE id = $1 AND wa_sent IS NOT TRUE'
                            : 'UPDATE customers SET wa_sent = FALSE WHERE id = $1 AND wa_sent IS NOT TRUE',
                        [customerId]
                    ).catch(() => {});
                } else {
                    if (purchaseId) {
                        await db.query('UPDATE purchases SET wa_enqueued = TRUE WHERE id = $1', [purchaseId]).catch(() => {});
                    }
                    await db.query(
                        'UPDATE customers SET wa_sent = FALSE WHERE id = $1 AND wa_sent IS NOT TRUE',
                        [customerId]
                    ).catch(() => {});
                }
            } catch (waError) {
                console.warn('⚠️ WhatsApp auto-reply enqueue failed:', waError.message || waError);
            }
        })();

        // Background: auto-save to Google Contacts (tidak blocking response)
        (async () => {
            try {
                await googleService.saveContact({
                    nama_lengkap: finalName,
                    whatsapp: cleanPhone,
                    alamat: fullAddress || null,
                    merk_unit: cleanMerk,
                    tipe_unit: cleanTipe,
                    metode_pembayaran: metode_pembayaran || null,
                    source,
                    tipe: 'Belanja'
                });
            } catch (gcError) {
                console.warn('⚠️ Google Contact save failed:', gcError.message || gcError);
            }
        })();

    } catch (error) {
        console.error('❌ Form submit error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal memproses pendaftaran',
            error: error.message
        });
    }
};