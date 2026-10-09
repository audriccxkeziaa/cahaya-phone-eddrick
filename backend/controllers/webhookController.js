// ============================================
// WEBHOOK CONTROLLER
// Handle incoming WhatsApp messages
//
// ATURAN EMAS:
// - Chat manual (Skenario B): HANYA save DB + Google Contact
//   Format: "Customer - DD/MM/YYYY". TIDAK kirim auto-reply.
// - Auto-reply HANYA dari formController (Skenario A).
//
// ATURAN CUSTOMER:
// - 1 nomor HP = 1 record customer (tidak boleh duplikat)
// - Chat masuk dari nomor yang sudah ada → update, BUKAN insert baru
// - Chat Only → saat submit form → pindah ke Belanja
// - Sudah pernah Belanja → chat lagi → TIDAK bikin record baru
// ============================================

const crypto = require('crypto');
const db = require('../config/database');
const googleService = require('../config/google');
const { sanitizePhone, validatePhone } = require('../utils/phoneUtils');
const { safeEqual } = require('../config/csrfMiddleware');

/**
 * Handle incoming message dari WA Client (event internal, bukan HTTP)
 * Dipanggil langsung dari server.js saat WA Client emit 'message_received'
 */
exports.handleIncomingMessage = async (data) => {
    try {
        const { sender: phoneNumber, message, pushname: senderName, wa_message_id: waMessageId } = data;

        // PENTING: pakai sanitizePhone supaya format konsisten (628xxx)
        const cleanPhone = sanitizePhone(phoneNumber.replace(/\D/g, ''));

        // Validasi ketat: harus nomor Indonesia valid (62xxx, 11-15 digit)
        // Ini juga memfilter nomor WA internal (contoh: 188394495865076)
        const phoneCheck = validatePhone(cleanPhone);
        if (!phoneCheck.valid) {
            console.log(`[WEBHOOK] Invalid phone number: ${phoneNumber} -> ${cleanPhone} (${phoneCheck.message}), skipped`);
            return { success: false, error: 'Invalid phone number' };
        }

        // Idempotency: Baileys bisa kirim ulang pesan yang sama setelah reconnect.
        // Jangan proses dua kali (mencegah duplikat pesan & status flip-flop).
        if (waMessageId) {
            const { rows: dup } = await db.query(
                'SELECT 1 FROM messages WHERE wa_message_id = $1 LIMIT 1',
                [waMessageId]
            );
            if (dup.length > 0) {
                console.log(`[WEBHOOK] Duplicate message ${waMessageId}, skipped`);
                return { success: true, duplicate: true };
            }
        }

        console.log(`[WEBHOOK] Processing: ${senderName} (${cleanPhone}): ${message.substring(0, 50)}...`);

        // Nomor internal (staf, nomor toko lain) yang memang tidak boleh jadi customer.
        // Diisi lewat app_settings key 'wa_ignore_numbers', dipisah koma.
        // Ini menggantikan cara lama yang membuang SEMUA nomor yang kebetulan sudah
        // ada di Google Contacts — lihat catatan di bawah.
        try {
            const { rows: ign } = await db.query(
                `SELECT value FROM app_settings WHERE key = 'wa_ignore_numbers' LIMIT 1`
            );
            const ignoreList = (ign[0]?.value || '')
                .split(',')
                .map(v => sanitizePhone(v.trim().replace(/\D/g, '')))
                .filter(Boolean);
            if (ignoreList.includes(cleanPhone)) {
                console.log(`[WEBHOOK] Ignored incoming chat from ${cleanPhone} — ada di wa_ignore_numbers`);
                return { success: true, ignored: true, reason: 'ignore_list' };
            }
        } catch (err) {
            console.warn('[WEBHOOK] Ignore-list lookup failed:', err.message);
        }

        // Nama dari Google Contacts, kalau ada. INI TIDAK LAGI MEMBATALKAN PENYIMPANAN.
        //
        // Versi lama: begitu nomor ketemu di Google Contacts dengan nama asli, seluruh
        // chat masuk di-return lebih awal — customer tidak tersimpan ke DB, pesannya
        // tidak tercatat, dan last_incoming_message_at customer lama tidak ter-update.
        // Karena nomor pembeli yang pernah chat umumnya sudah tersimpan di kontak HP
        // pemilik toko, efeknya: pembeli yang cuma chat berhenti tersimpan sama sekali.
        //
        // Sekarang nama Google hanya dipakai untuk dua hal: memberi nama record baru
        // dengan nama asli (lebih berguna daripada "Customer - tanggal"), dan mencegah
        // kita menimpa kontak Google yang sudah dinamai manusia.
        let knownGoogleName = '';
        try {
            const googleContact = await googleService.findContactByPhoneNumber(cleanPhone);
            const googleName = Array.isArray(googleContact?.names) && googleContact.names[0]
                ? googleContact.names[0].displayName || googleContact.names[0].givenName || ''
                : '';
            if (googleName && !googleService.isPlaceholderName(googleName)) {
                knownGoogleName = googleName;
            }
        } catch (err) {
            console.warn('[WEBHOOK] Google contact lookup failed:', err.message);
        }

        // Opt-out: jika customer balas "STOP" / "BERHENTI", set opted_in = false
        const optOutKeywords = ['stop', 'berhenti', 'unsubscribe', 'keluar'];
        const lowerMsg = message.trim().toLowerCase();
        if (optOutKeywords.includes(lowerMsg)) {
            await db.query(
                `UPDATE customers SET opted_in = FALSE, updated_at = NOW() WHERE whatsapp = $1`,
                [cleanPhone]
            );
            console.log(`[WEBHOOK] Customer ${cleanPhone} opted out (keyword: "${lowerMsg}")`);
        }

        // Opt-in: jika customer balas "MULAI" / "START", set opted_in = true
        const optInKeywords = ['start', 'mulai', 'subscribe', 'daftar'];
        if (optInKeywords.includes(lowerMsg)) {
            await db.query(
                `UPDATE customers SET opted_in = TRUE, updated_at = NOW() WHERE whatsapp = $1`,
                [cleanPhone]
            );
            console.log(`[WEBHOOK] Customer ${cleanPhone} opted back in (keyword: "${lowerMsg}")`);
        }

        // Cari customer berdasarkan nomor HP (1 nomor = 1 customer)
        const { rows: existing } = await db.query(
            'SELECT id, nama_lengkap, status, tipe FROM customers WHERE whatsapp = $1 ORDER BY created_at DESC LIMIT 1',
            [cleanPhone]
        );

        let customerId;
        let customerStatus;

        if (existing.length > 0) {
            customerId = existing[0].id;
            const currentStatus = existing[0].status;

            if (['New', 'Inactive', 'Follow Up'].includes(currentStatus)) {
                await db.query(
                    'UPDATE customers SET status = $1, last_incoming_message_at = NOW() WHERE id = $2',
                    ['Contacted', customerId]
                );
                customerStatus = 'Contacted';
            } else {
                await db.query(
                    'UPDATE customers SET last_incoming_message_at = NOW() WHERE id = $1',
                    [customerId]
                );
                customerStatus = currentStatus;
            }

            console.log(`[WEBHOOK] Existing customer: ${customerId} (${existing[0].tipe}) — ${currentStatus} -> ${customerStatus}`);

            // Nama Chat Only tetap "Customer - tanggal", tidak di-update dari pushname
            // Nama Belanja dari form, juga tidak di-timpa
        } else {
            // ============================================
            // SKENARIO B: Customer BARU chat manual
            // Save ke DB + Google Contact ("Customer - Tanggal")
            // TIDAK kirim auto-reply — biarkan WA Business bawaan
            // ============================================
            let source = 'Unknown';
            const lowerMessage = message.toLowerCase();

            if (lowerMessage.includes('instagram') || lowerMessage.includes('ig')) {
                source = 'Instagram';
            } else if (lowerMessage.includes('facebook') || lowerMessage.includes('fb')) {
                source = 'Facebook';
            } else if (lowerMessage.includes('tiktok')) {
                source = 'TikTok';
            }

            // Nama default: "Customer - DD/MM/YYYY".
            // Tidak pakai pushname — pushname bisa asal-asalan / beda orang sama nomor.
            // Tapi kalau nomor ini sudah punya nama asli di Google Contacts, pakai itu:
            // nama yang diketik manusia lebih berguna daripada placeholder tanggal.
            const now = new Date();
            const tanggal = now.toLocaleDateString('id-ID', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                timeZone: 'Asia/Makassar'
            });
            const customerName = knownGoogleName || `customer - ${tanggal}`;

            const { rows: inserted } = await db.query(
                `INSERT INTO customers (nama_lengkap, whatsapp, source, status, tipe, last_incoming_message_at)
                VALUES ($1, $2, $3, 'New', 'Chat Only', NOW())
                ON CONFLICT (whatsapp) DO UPDATE SET updated_at = CURRENT_TIMESTAMP, last_incoming_message_at = NOW()
                RETURNING id, status`,
                [customerName, cleanPhone, source]
            );

            customerId = inserted[0].id;
            customerStatus = inserted[0].status || 'New';

            console.log(`[WEBHOOK] New customer (Chat Only): ${customerId} — ${customerName} — NO auto-reply`);

            // Penamaan kontak Google ditangani satu jalur: syncCustomerContactName (di bawah).
            // Kontak yang sudah dinamai manusia (knownGoogleName) dilindungi di sana.
            if (knownGoogleName) {
                console.log(`[WEBHOOK] Google Contact dilindungi untuk ${cleanPhone} — sudah ada nama: ${knownGoogleName}`);
            }

            // BERHENTI DI SINI. TIDAK kirim auto-reply.
            // WA Business bawaan yang handle reply.
        }

        // Sinkronkan nama kontak Google di background (tidak blocking):
        // Chat Only → "customer - DD/MM/YYYY" (tanggal diperbarui tiap chat),
        // Belanja → "{nama} - tanggal pembelian terakhir". Nama asli tidak disentuh.
        googleService.syncCustomerContactName(cleanPhone).catch(err => {
            console.warn('[WEBHOOK] Google Contact sync failed:', err.message);
        });

        // Simpan pesan ke database (dengan wa_message_id untuk idempotency)
        await db.query(
            `INSERT INTO messages (customer_id, direction, message, wa_message_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [customerId, 'in', message, waMessageId || null]
        );

        console.log(`[WEBHOOK] Message saved for customer: ${customerId}`);
        return { success: true, customer_id: customerId, status: customerStatus };

    } catch (error) {
        console.error('[WEBHOOK] Error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * HTTP Webhook endpoint (untuk wa-bridge / Fonnte / external WA API)
 * POST /api/webhook/whatsapp
 *
 * Auth: must include the bridge secret either as `X-WA-Secret` header (preferred,
 * matches wa-bridge/index.js forwardIncoming) or `secret` body field (Fonnte-style).
 * Without this check, ANY internet visitor could POST fake incoming messages and
 * fabricate customer records — see audit point #1.
 */
exports.handleWhatsAppWebhook = async (req, res) => {
    try {
        const expected = process.env.WA_BRIDGE_SECRET;
        if (!expected) {
            console.error('[WEBHOOK] WA_BRIDGE_SECRET is not configured — refusing all webhook traffic');
            return res.status(503).json({ success: false, message: 'Webhook auth not configured' });
        }
        const provided = req.headers['x-wa-secret'] || req.body?.secret;
        if (!provided || !safeEqual(provided, expected)) {
            console.warn('[WEBHOOK] Rejected unauthenticated webhook from', req.ip);
            return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
        }

        // Status delivery/read dari bridge (centang 1/2/biru) → update whatsapp_logs
        if (req.body.type === 'status_update') {
            const whatsappService = require('../config/whatsapp');
            await whatsappService.updateMessageStatus(req.body.wa_message_id, req.body.ack_status);
            return res.json({ success: true });
        }

        // Don't log full body in production — contains PII (phone + message). Log just sender prefix.
        if (process.env.NODE_ENV !== 'production') {
            console.log('[WEBHOOK HTTP] Received:', JSON.stringify(req.body, null, 2));
        } else {
            console.log('[WEBHOOK HTTP] Received from', String(req.body?.sender || req.body?.phone || '').slice(0, 6) + '***');
        }

        let data;

        // Format WA Bridge / internal
        if (req.body.source === 'wa-bridge') {
            data = {
                sender: req.body.sender,
                message: req.body.message,
                pushname: req.body.pushname || '',
                wa_message_id: req.body.wa_message_id || null
            };
        }
        // Format Fonnte
        else if (req.body.sender) {
            data = {
                sender: req.body.sender,
                message: req.body.message,
                pushname: req.body.member?.name || ''
            };
        }
        // Format Wablas
        else if (req.body.phone) {
            data = {
                sender: req.body.phone,
                message: req.body.message,
                pushname: req.body.pushname || ''
            };
        }
        else {
            return res.status(400).json({ success: false, message: 'Invalid webhook payload' });
        }

        const result = await exports.handleIncomingMessage(data);
        res.json(result);

    } catch (error) {
        console.error('[WEBHOOK HTTP] Error:', error);
        res.json({ success: false, message: 'Error processing webhook', error: error.message });
    }
};

// ============================================
// WEBHOOK META CLOUD API (WA_PROVIDER=cloud)
//
// Berbeda dari webhook wa-bridge: payload-nya bersarang
// (entry[].changes[].value) dan diautentikasi lewat tanda tangan HMAC, bukan
// secret di header. Endpoint-nya terpisah supaya jalur Baileys tetap utuh.
// ============================================

// Meta memakai kata status; whatsapp_logs memakai skala ack Baileys.
// 'sent' sengaja dipetakan ke 2 — updateMessageStatus mengabaikan ack < 3,
// dan baris log memang sudah berstatus SENT saat kiriman berhasil.
const META_ACK = { sent: 2, delivered: 3, read: 4 };

/**
 * Verifikasi pendaftaran webhook. Dipanggil Meta SEKALI saat Callback URL
 * disimpan di App Dashboard.
 * GET /api/webhook/meta?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 *
 * Harus membalas challenge sebagai teks polos — kalau dibungkus JSON,
 * Meta menolak pendaftarannya.
 */
exports.verifyMetaWebhook = (req, res) => {
    const expected = process.env.META_VERIFY_TOKEN;
    if (!expected) {
        console.error('[META WEBHOOK] META_VERIFY_TOKEN belum diset — verifikasi ditolak');
        return res.status(503).type('text/plain').send('META_VERIFY_TOKEN not configured');
    }

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token && safeEqual(String(token), expected)) {
        console.log('[META WEBHOOK] Verifikasi berhasil — webhook terdaftar');
        return res.status(200).type('text/plain').send(String(challenge ?? ''));
    }

    console.warn('[META WEBHOOK] Verifikasi ditolak dari', req.ip);
    return res.sendStatus(403);
};

/**
 * Penerima event Meta.
 * POST /api/webhook/meta
 */
exports.handleMetaWebhook = async (req, res) => {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
        console.error('[META WEBHOOK] META_APP_SECRET belum diset — menolak semua trafik webhook');
        return res.sendStatus(503);
    }

    const signature = req.headers['x-hub-signature-256'];
    if (!signature || !req.rawBody) {
        console.warn('[META WEBHOOK] Ditolak — tanda tangan atau raw body tidak ada');
        return res.sendStatus(401);
    }

    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
    if (!safeEqual(String(signature), expected)) {
        console.warn('[META WEBHOOK] Ditolak — tanda tangan tidak cocok, dari', req.ip);
        return res.sendStatus(401);
    }

    // Balas dulu, proses belakangan. Meta mengirim ulang lalu MENONAKTIFKAN
    // webhook yang lambat merespons — pemrosesan tidak boleh menahan respons.
    res.sendStatus(200);

    try {
        await processMetaPayload(req.body);
    } catch (err) {
        console.error('[META WEBHOOK] Gagal memproses payload:', err.message);
    }
};

async function processMetaPayload(body) {
    const entries = Array.isArray(body?.entry) ? body.entry : [];

    for (const entry of entries) {
        for (const change of (entry?.changes || [])) {
            const value = change?.value;
            if (!value) continue;

            const contactName = value.contacts?.[0]?.profile?.name || '';

            // Chat masuk — pakai ulang handleIncomingMessage supaya seluruh aturan
            // customer, opt-out, ignore-list, dan Google Contacts tetap satu jalur.
            for (const m of (value.messages || [])) {
                if (m?.type !== 'text') {
                    console.log(`[META WEBHOOK] Pesan tipe '${m?.type}' dari ${m?.from} diabaikan (hanya teks yang diproses)`);
                    continue;
                }
                const text = m.text?.body || '';
                if (!text) continue;

                await exports.handleIncomingMessage({
                    sender: m.from,
                    message: text,
                    pushname: contactName,
                    wa_message_id: m.id
                });
            }

            // Status pengiriman
            for (const s of (value.statuses || [])) {
                await applyMetaStatus(s);
            }
        }
    }
}

async function applyMetaStatus(s) {
    if (!s?.id) return;

    if (s.status === 'failed') {
        const err = s.errors?.[0] || {};
        const code = String(err.code ?? 'META_FAILED');
        const detail = String(err.title || err.message || 'Gagal menurut Meta').slice(0, 500);

        // Kegagalan yang dilaporkan Meta bersifat final untuk pesan itu —
        // template yang sama akan ditolak lagi. Tutup barisnya, jangan diulang.
        await db.query(
            `UPDATE whatsapp_logs SET
                status = 'FAILED', error_code = $1, error_detail = $2,
                retry_count = max_retries, next_retry_at = NULL, updated_at = NOW()
              WHERE wa_message_id = $3
                AND status NOT IN ('FAILED', 'CANCELLED')`,
            [code, detail, s.id]
        ).catch(e => console.warn('[META WEBHOOK] Update status gagal:', e.message));

        console.warn(`[META WEBHOOK] Pesan ${s.id} GAGAL (${code}): ${detail}`);
        return;
    }

    const ack = META_ACK[s.status];
    if (!ack) return;

    const whatsappService = require('../config/whatsapp');
    await whatsappService.updateMessageStatus(s.id, ack);
}

/**
 * Test webhook endpoint
 * GET /api/webhook/test
 */
exports.testWebhook = (req, res) => {
    res.json({
        success: true,
        message: 'Webhook endpoint is working',
        timestamp: new Date().toISOString()
    });
};
