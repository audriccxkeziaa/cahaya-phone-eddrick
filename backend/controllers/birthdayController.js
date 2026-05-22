// ============================================
// BIRTHDAY GREETING CONTROLLER
// Kirim ucapan ulang tahun otomatis via WhatsApp
// ============================================

const db = require('../config/database');
const whatsappService = require('../config/whatsapp');

const DEFAULT_MESSAGE = `Halo Kak {nama}! 🎂🎉\n\nSelamat Ulang Tahun dari kami *CAHAYA PHONE* Gorontalo!\n\nSemoga panjang umur, sehat selalu, dan diberkahi rezeki yang melimpah. Terima kasih sudah menjadi pelanggan setia kami.\n\nSalam hangat,\nCahaya Phone 🙏`;

// Module-level lock: only one manual birthday send in progress at a time.
// Prevents two admins from simultaneously clicking "Kirim" and double-sending.
let manualBirthdaySendInProgress = false;

// Working hours (WITA)
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 22;

function isWorkingHoursWITA() {
    const nowUtc = new Date();
    const witaHours = (nowUtc.getUTCHours() + 8) % 24;
    return witaHours >= WORK_START_HOUR && witaHours < WORK_END_HOUR;
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Per-send delay drawn from today's birthday profile (rolled once per day by wa-worker).
// Adds ±15s jitter on top so consecutive sends within the same day aren't identical either.
function nextBirthdayDelayMs() {
    const waWorker = require('../config/wa-worker');
    const profile = waWorker.getBirthdayProfile();
    const jitter = randInt(-15_000, 15_000);
    return Math.max(60_000, profile.base + jitter);
}

function nextBirthdayBreakMs() {
    const waWorker = require('../config/wa-worker');
    const profile = waWorker.getBirthdayProfile();
    return randInt(profile.breakDuration.min, profile.breakDuration.max);
}

function birthdayBreakEvery() {
    const waWorker = require('../config/wa-worker');
    return waWorker.getBirthdayProfile().breakEvery;
}

// Calculate age in years from tanggal_lahir.
// Birthday cron only fires on the actual birthday so this is just (currentYear - birthYear),
// but we still adjust for month/day in case the function is called off-day (manual trigger).
function calculateAge(birthDate) {
    if (!birthDate) return null;
    const today = new Date();
    const birth = new Date(birthDate);
    if (isNaN(birth.getTime())) return null;
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age >= 0 ? age : null;
}

/**
 * FUNGSI BARU: Memasukkan ke antrean (queue) sesuai status toggle (auto/manual)
 */
async function enqueueTodayBirthdays() {
    // Cek status toggle saat ini
    const autoResult = await db.query(`SELECT value FROM app_settings WHERE key = 'birthday_auto_send'`);
    const isAutoOn = autoResult.rows.length === 0 || autoResult.rows[0].value !== 'false';
    const currentMode = isAutoOn ? 'auto' : 'manual';
    const currentYear = new Date().getFullYear();

    // Masukkan ke antrean dengan status 'pending'
    await db.query(`
        INSERT INTO birthday_greetings (customer_id, greeting_year, status, dispatch_mode)
        SELECT c.id, $1, 'pending', $2
        FROM customers c
        WHERE c.tanggal_lahir IS NOT NULL AND c.opted_in IS NOT FALSE
          AND (
            (EXTRACT(MONTH FROM c.tanggal_lahir) = EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
             AND EXTRACT(DAY FROM c.tanggal_lahir) = EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Makassar')))
            OR (
                EXTRACT(MONTH FROM c.tanggal_lahir) = 2 AND EXTRACT(DAY FROM c.tanggal_lahir) = 29
                AND EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Makassar')) = 2 AND EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Makassar')) = 28
                AND NOT (MOD(EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))::int, 4) = 0)
            )
          )
        ON CONFLICT (customer_id, greeting_year) DO NOTHING; -- Jangan timpa jika sudah ada antrean
    `, [currentYear, currentMode]);
}

/**
 * Get customers yang ulang tahun hari ini.
 *
 * Feb 29 edge case: customers born on a leap day get their greeting on
 * Feb 28 in non-leap years (most common convention in Indonesia). The
 * extra OR clause matches Feb 28 today + Feb 29 birthday when current
 * year isn't a leap year — so leap-day folks never miss a birthday wish.
 */
async function getBirthdayToday() {
    const result = await db.query(`
        SELECT c.id, c.nama_lengkap, c.whatsapp, c.tanggal_lahir, c.merk_unit, c.tipe_unit,
               c.opted_in,
               bg.id as greeting_id, bg.status as greeting_status, bg.sent_at, bg.error as greeting_error, bg.dispatch_mode
        FROM customers c
        LEFT JOIN birthday_greetings bg
            ON bg.customer_id = c.id AND bg.greeting_year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
        WHERE c.tanggal_lahir IS NOT NULL
          AND (
            -- Normal case: month + day both match today
            (EXTRACT(MONTH FROM c.tanggal_lahir) = EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
             AND EXTRACT(DAY FROM c.tanggal_lahir) = EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Makassar')))
            -- Leap-day fallback: customer born Feb 29, today is Feb 28 of a non-leap year
            OR (
                EXTRACT(MONTH FROM c.tanggal_lahir) = 2
                AND EXTRACT(DAY FROM c.tanggal_lahir) = 29
                AND EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Makassar')) = 2
                AND EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Makassar')) = 28
                AND NOT (
                    -- Current year IS a leap year — let the real Feb 29 path handle it
                    MOD(EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))::int, 4) = 0
                    AND (MOD(EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))::int, 100) != 0
                         OR MOD(EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))::int, 400) = 0)
                )
            )
          )
        ORDER BY c.nama_lengkap
    `);
    return result.rows;
}

/**
 * API: Get daftar ulang tahun hari ini + status pengiriman.
 * Also exposes autoSend toggle and is_working_hours so the frontend knows
 * whether to enable/disable manual buttons and what notif to show on click.
 */
exports.getTodayBirthdays = async (req, res) => {
    try {
        await enqueueTodayBirthdays(); // Pastikan antrean terisi sesuai toggle saat ini
        const customers = await getBirthdayToday();

        // Get custom message dari settings
        const msgResult = await db.query(
            `SELECT value FROM app_settings WHERE key = 'birthday_message'`
        );
        const customMessage = msgResult.rows.length > 0 ? msgResult.rows[0].value : DEFAULT_MESSAGE;

        // Get auto-send setting
        const autoResult = await db.query(
            `SELECT value FROM app_settings WHERE key = 'birthday_auto_send'`
        );
        const autoSend = autoResult.rows.length > 0 ? autoResult.rows[0].value === 'true' : true;

        // Check if any auto birthday items are still pending/sending — frontend uses this
        // to decide whether to disable manual "Kirim" buttons (same as has_auto_pending in WA failed).
        const { rows: autoPending } = await db.query(`
            SELECT COUNT(*)::int AS cnt FROM birthday_greetings
            WHERE greeting_year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
              AND status IN ('pending', 'sending')
              AND dispatch_mode = 'auto'
        `);

        res.json({
            success: true,
            data: {
                customers,
                message: customMessage,
                autoSend,
                has_auto_pending: autoPending[0].cnt > 0,
                is_working_hours: isWorkingHoursWITA(),
                working_hours: { start: WORK_START_HOUR, end: WORK_END_HOUR, tz: 'WITA' },
                today: new Date().toISOString().split('T')[0]
            }
        });
    } catch (err) {
        console.error('[Birthday] Error getting today birthdays:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Kirim ucapan ke 1 customer (manual trigger dari admin).
 * LOGIKA KETAT: Prioritas AUTO, Jam Operasional, Delay Muter-Muter di layar,
 * satu manual dalam satu waktu (locked).
 */
exports.sendGreeting = async (req, res) => {
    try {
        const { customer_id } = req.body;
        if (!customer_id) return res.status(400).json({ success: false, message: 'customer_id required' });

        // GATE 1: JAM OPERASIONAL
        if (!isWorkingHoursWITA()) {
            return res.status(400).json({
                success: false,
                outside_working_hours: true,
                message: `Di luar jam operasional (${WORK_START_HOUR}:00–${WORK_END_HOUR}:00 WITA). Tidak dapat mengirim manual.`
            });
        }

        // GATE 2: PRIORITAS OTOMATIS (AUTO)
        // Cek apakah masih ada antrian 'pending'/'sending' dengan mode 'auto' hari ini
        const pendingAuto = await db.query(`
            SELECT 1 FROM birthday_greetings 
            WHERE status IN ('pending', 'sending') AND dispatch_mode = 'auto' 
            AND greeting_year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar')) LIMIT 1
        `);
        if (pendingAuto.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Tidak bisa kirim sekarang — masih ada antrian otomatis yang belum selesai. Tunggu sampai sistem menyelesaikannya, baru tombol manual bisa digunakan.'
            });
        }

        // GATE 3: SATU MANUAL SEKALIGUS
        // Mencegah dua admin klik bersamaan dan double-send ke customer yang sama.
        if (manualBirthdaySendInProgress) {
            return res.status(409).json({
                success: false,
                message: 'Pengiriman manual sedang berlangsung. Tunggu sebentar hingga loading selesai, lalu coba kirim berikutnya.'
            });
        }

        manualBirthdaySendInProgress = true;

        // GATE 4: DELAY MUTER-MUTER (Loading di layar admin)
        // Tahan HTTP response 5–15 detik agar terasa humanlike dan tidak spam.
        const delay = randInt(5_000, 15_000);
        await new Promise(r => setTimeout(r, delay));

        // Re-check jam operasional (jaga-jaga delay muter-muter ngelewatin jam tutup)
        if (!isWorkingHoursWITA()) {
            manualBirthdaySendInProgress = false;
            return res.status(400).json({
                success: false,
                outside_working_hours: true,
                message: 'Batal terkirim, waktu operasional keburu habis saat loading antrian.'
            });
        }

        // EKSEKUSI KIRIM
        const result = await sendBirthdayMessage(customer_id);
        manualBirthdaySendInProgress = false;

        if (result.success) {
            res.json({ success: true, message: 'Pesan ulang tahun berhasil terkirim manual!' });
        } else {
            res.status(400).json({ success: false, message: result.message || result.error });
        }

    } catch (err) {
        manualBirthdaySendInProgress = false;
        console.error('[Birthday] Error sending greeting:', err.message);
        if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Masukkan semua customer ulang tahun hari ini ke antrian (re-enqueue).
 * Worker (wa-worker._processBirthdayQueue) yang memproses satu per satu dengan
 * delay + break anti-ban. Endpoint ini tidak mengirim langsung agar tidak
 * double-send dengan worker yang berjalan paralel.
 */
exports.sendAllGreetings = async (req, res) => {
    try {
        if (!isWorkingHoursWITA()) {
            return res.status(400).json({
                success: false,
                outside_working_hours: true,
                message: `Di luar jam operasional (${WORK_START_HOUR}:00–${WORK_END_HOUR}:00 WITA). Coba lagi di jam kerja.`
            });
        }

        // Re-enqueue semua yang belum dikirim hari ini (failed → kembali ke pending).
        // enqueueTodayBirthdays pakai ON CONFLICT DO NOTHING jadi tidak overwrite yang
        // sudah 'sent'. Untuk yang 'failed' kita reset manual di sini.
        await db.query(`
            UPDATE birthday_greetings
            SET status = 'pending', error = NULL, updated_at = NOW()
            WHERE greeting_year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
              AND status = 'failed'
        `);
        await enqueueTodayBirthdays();  // insert yang belum ada sama sekali

        // Hitung berapa yang masuk antrian
        const { rows } = await db.query(`
            SELECT COUNT(*)::int AS cnt FROM birthday_greetings
            WHERE greeting_year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
              AND status = 'pending'
        `);
        const queued = rows[0]?.cnt || 0;

        if (queued === 0) {
            return res.json({ success: true, message: 'Semua ucapan sudah terkirim hari ini.', queued: 0 });
        }

        res.json({
            success: true,
            message: `${queued} ucapan masuk antrian. Worker otomatis memproses satu per satu dengan delay & break harian. Pantau di halaman ini — nama akan hilang saat terkirim.`,
            queued
        });
    } catch (err) {
        console.error('[Birthday] Error sendAllGreetings:', err.message);
        if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Update pesan ucapan custom
 */
exports.updateMessage = async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, message: 'Pesan tidak boleh kosong' });
        }

        await db.query(`
            INSERT INTO app_settings (key, value) VALUES ('birthday_message', $1)
            ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        `, [message.trim()]);

        res.json({ success: true, message: 'Pesan ucapan berhasil diupdate' });
    } catch (err) {
        console.error('[Birthday] Error updating message:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Toggle auto-send on/off
 */
exports.toggleAutoSend = async (req, res) => {
    try {
        const { enabled } = req.body;
        await db.query(`
            INSERT INTO app_settings (key, value) VALUES ('birthday_auto_send', $1)
            ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        `, [String(!!enabled)]);

        res.json({ success: true, autoSend: !!enabled });
    } catch (err) {
        console.error('[Birthday] Error toggling auto-send:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Get riwayat ucapan yang sudah terkirim (untuk log)
 */
exports.getHistory = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT bg.*, c.nama_lengkap, c.whatsapp, c.tanggal_lahir
            FROM birthday_greetings bg
            JOIN customers c ON c.id = bg.customer_id
            ORDER BY bg.sent_at DESC
            LIMIT 50
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('[Birthday] Error getting history:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Internal: Kirim pesan birthday ke 1 customer
 *
 * NOTE: Kolom sent_at disimpan sebagai TIMESTAMP UTC murni (pakai NOW()).
 * Frontend yang konversi ke WITA via toLocaleString({ timeZone: 'Asia/Makassar' }).
 * JANGAN pernah simpan string lokal WITA — akan kena double-shift saat dibaca.
 */
async function sendBirthdayMessage(customerId) {
    try {
        // Get customer data
        const custResult = await db.query(
            'SELECT id, nama_lengkap, whatsapp, tanggal_lahir FROM customers WHERE id = $1',
            [customerId]
        );
        if (custResult.rows.length === 0) {
            return { success: false, message: 'Customer tidak ditemukan' };
        }
        const customer = custResult.rows[0];

        // Cek apakah sudah dikirim tahun ini
        const year = new Date().getFullYear();
        const existing = await db.query(
            `SELECT id, status FROM birthday_greetings WHERE customer_id = $1 AND greeting_year = $2 AND status = 'sent'`,
            [customerId, year]
        );
        if (existing.rows.length > 0) {
            return { success: false, message: 'Ucapan sudah terkirim tahun ini' };
        }

        // Get custom message
        const msgResult = await db.query(
            `SELECT value FROM app_settings WHERE key = 'birthday_message'`
        );
        let message = msgResult.rows.length > 0 ? msgResult.rows[0].value : DEFAULT_MESSAGE;

        // Pipeline: spintax → {nama}/{umur} replace. Order matters — spintax is
        // resolved first so that admin can write {Halo|Hai} Kak {nama}, dengan
        // {nama} placeholder safely inside or outside spintax groups.
        const { spinText } = require('../config/wa-worker');
        message = spinText(message);
        message = message.replace(/\{nama\}/g, customer.nama_lengkap);
        const umur = calculateAge(customer.tanggal_lahir);
        message = message.replace(/\{umur\}/g, umur !== null ? String(umur) : '');

        // Cek dulu apakah nomor terdaftar di WhatsApp
        const numberCheck = await whatsappService.isNumberRegistered(customer.whatsapp);
        if (!numberCheck.registered) {
            const errorMsg = numberCheck.error || `Nomor ${customer.whatsapp} tidak terdaftar di WhatsApp`;

            await db.query(`
                INSERT INTO birthday_greetings (customer_id, greeting_year, message, status, error)
                VALUES ($1, $2, $3, 'failed', $4)
                ON CONFLICT (customer_id, greeting_year) DO UPDATE
                SET status = 'failed', error = $4
            `, [customerId, year, message, errorMsg]);

            console.log(`[Birthday] ❌ ${customer.nama_lengkap}: ${errorMsg}`);
            return { success: false, message: errorMsg, error: errorMsg };
        }

        // Kirim via WA bridge (Baileys)
        const waResult = await whatsappService.sendBirthdayGreeting(customer, message);

        // Log ke database — sent_at pakai NOW() (UTC), frontend konversi ke WITA
        if (waResult.success) {
            await db.query(`
                INSERT INTO birthday_greetings (customer_id, greeting_year, message, status, sent_at)
                VALUES ($1, $2, $3, 'sent', NOW())
                ON CONFLICT (customer_id, greeting_year) DO UPDATE
                SET status = 'sent', message = $3, sent_at = NOW()
            `, [customerId, year, message]);

            await db.query(`
                INSERT INTO messages (customer_id, direction, message, sent_at)
                VALUES ($1, 'out', $2, NOW())
            `, [customerId, message]);

            console.log(`[Birthday] ✅ Sent to ${customer.nama_lengkap} (${customer.whatsapp})`);
        } else {
            await db.query(`
                INSERT INTO birthday_greetings (customer_id, greeting_year, message, status, error)
                VALUES ($1, $2, $3, 'failed', $4)
                ON CONFLICT (customer_id, greeting_year) DO UPDATE
                SET status = 'failed', error = $4
            `, [customerId, year, message, waResult.error || 'Unknown error']);

            console.log(`[Birthday] ❌ Failed for ${customer.nama_lengkap}: ${waResult.error}`);
        }

        return { success: waResult.success, customer: customer.nama_lengkap, error: waResult.error };
    } catch (err) {
        console.error('[Birthday] Send error:', err.message);
        return { success: false, message: err.message };
    }
}

/**
 * CRON: Dipanggil otomatis tiap pagi (09:00 WITA via scheduler di app.js).
 * Tugasnya hanya MEMASUKKAN customer birthday hari ini ke antrian.
 * Pengiriman sebenarnya dilakukan oleh wa-worker._processBirthdayQueue()
 * yang berjalan setiap 15 detik — ini mencegah double-send antara cron dan worker.
 */
exports.enqueueTodayBirthdays = enqueueTodayBirthdays;

exports.cronCheckBirthdays = async function() {
    console.log('[Birthday] 🎂 Cron enqueue started...');
    try {
        await enqueueTodayBirthdays();

        // Hitung yang masuk antrian hari ini
        const { rows } = await db.query(`
            SELECT COUNT(*)::int AS cnt FROM birthday_greetings
            WHERE greeting_year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
              AND status IN ('pending', 'sending', 'sent')
        `);
        console.log(`[Birthday] ✅ Cron done — ${rows[0]?.cnt || 0} total birthday record(s) for today. Worker will process 'pending' rows automatically.`);
    } catch (err) {
        console.error('[Birthday] Cron error:', err.message);
    }
};

