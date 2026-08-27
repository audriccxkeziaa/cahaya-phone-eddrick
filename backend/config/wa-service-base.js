// ============================================
// WA SERVICE BASE — logika yang sama untuk semua provider
//
// Semua di sini murni operasi database dan aturan bisnis: logging ke
// whatsapp_logs, opt-out, statistik harian, pengaturan, antrean auto-reply.
// TIDAK ADA transport di file ini.
//
// Dua turunan:
// - whatsapp-baileys.js → kirim lewat wa-bridge (Baileys, tidak resmi)
// - whatsapp-cloud.js   → kirim lewat Meta Cloud API (resmi)
//
// Turunan WAJIB mengimplementasikan: sendText, sendForExistingLog,
// isNumberRegistered, getStatus, isConfigured, restartBridge, disconnectBridge,
// _isRetryable.
// ============================================

const db = require('./database');
const { sanitizePhone } = require('../utils/phoneUtils');

const DEFAULT_AUTOREPLY = 'Halo {nama}, terima kasih telah menghubungi Cahaya Phone Gorontalo! 🙏\n\nData Anda sudah kami terima. Tim kami akan segera menghubungi Anda untuk proses selanjutnya.\n\nSalam hangat,\nCahaya Phone';

class WhatsAppServiceBase {
    constructor() {
        this.dailyLimit = 200;
        this._cache = { autoReplyMessage: DEFAULT_AUTOREPLY };
    }

    // ============================================
    // KONTRAK — wajib di-override turunan
    // ============================================
    async sendText() { throw new Error('sendText() belum diimplementasikan provider ini'); }
    async sendForExistingLog() { throw new Error('sendForExistingLog() belum diimplementasikan provider ini'); }
    async isNumberRegistered() { throw new Error('isNumberRegistered() belum diimplementasikan provider ini'); }
    async getStatus() { throw new Error('getStatus() belum diimplementasikan provider ini'); }
    isConfigured() { return false; }
    async restartBridge() { return { success: true, noop: true }; }
    async disconnectBridge() { return { success: true, noop: true }; }
    _isRetryable() { return false; }

    // Variasi teks anti-fingerprint. Hanya relevan di Baileys; provider resmi
    // meng-override jadi identitas karena isi template tidak boleh diacak.
    _varyText(text) {
        try {
            const { spinText } = require('./wa-worker');
            return spinText(text);
        } catch (_) {
            return text;
        }
    }

    // ============================================
    // PUBLIC: pembungkus tipis di atas sendText
    // ============================================
    async sendMessage(phone, message) {
        return this.sendText(phone, message);
    }

    async sendBroadcastMessage(phone, message) {
        return this.sendText(phone, message, { typing: true, category: 'broadcast' });
    }

    async sendBirthdayGreeting(customer, customMessage) {
        const message = (customMessage || '').replace(/\{nama\}/g, customer.nama_lengkap || 'Kak');
        if (!message.trim()) return { success: false, error: 'Empty message' };
        return this.sendText(customer.whatsapp, message, { typing: true, category: 'birthday' });
    }

    // LEGACY — kirim langsung tanpa antre. Tidak dipakai formController lagi.
    async sendAutoReply(customer) {
        const tmpl = await this._getAutoReplyTemplate();
        const message = tmpl.replace(/\{nama\}/g, customer.nama_lengkap || 'Kak');
        return this.sendText(customer.whatsapp, message, { typing: true, category: 'auto_reply', skipOptCheck: true });
    }

    // ============================================
    // PUBLIC: Antrekan auto-reply untuk dikuras wa-worker dengan pacing.
    // Form customer langsung dapat respons sukses; kiriman WA menyusul.
    // ============================================
    async enqueueAutoReply(customer, { autoDispatch = true, skipNumberCheck = false } = {}) {
        const formattedNumber = sanitizePhone(customer.whatsapp);
        if (!formattedNumber || !formattedNumber.startsWith('62')) {
            console.warn(`[WA] enqueueAutoReply: invalid phone ${customer.whatsapp}`);
            return { success: false, error: 'Invalid phone number' };
        }

        const optedOut = await this._isOptedOut(formattedNumber);
        if (optedOut) {
            console.log(`[WA] enqueueAutoReply: ${formattedNumber} opted out — skipping`);
            return { success: false, error: 'Customer telah opt-out', opted_out: true };
        }

        if (!skipNumberCheck) {
            const numberCheck = await this.isNumberRegistered(formattedNumber);
            if (numberCheck.registered === false) {
                console.log(`[WA] enqueueAutoReply: ${formattedNumber} not registered — skipping`);
                return {
                    success: false,
                    error: numberCheck.error || 'Nomor tidak terdaftar di WhatsApp',
                    registered: false,
                    unchecked: !!numberCheck.unchecked
                };
            }
        }

        const tmpl = await this._getAutoReplyTemplate();
        let message = this._varyText(tmpl);
        message = message.replace(/\{nama\}/g, customer.nama_lengkap || 'Kak');

        try {
            const { rows } = await db.query(
                `INSERT INTO whatsapp_logs (phone, type, message_body, status, priority, auto_dispatch)
                 VALUES ($1, 'auto_reply', $2, 'QUEUED', 'auto_reply', $3)
                 RETURNING id`,
                [formattedNumber, message, !!autoDispatch]
            );
            console.log(`[WA] enqueueAutoReply: OK → log_id=${rows[0].id} phone=${formattedNumber} auto_dispatch=${!!autoDispatch}`);
            return { success: true, queued: true, log_id: rows[0].id, auto_dispatch: !!autoDispatch };
        } catch (err) {
            console.warn('[WA] enqueueAutoReply INSERT failed:', err.message);
            return { success: false, error: err.message };
        }
    }

    // ============================================
    // PUBLIC: Statistik harian
    // ============================================
    async getDailyStats() {
        try {
            const { rows } = await db.query(
                `SELECT sent_count, failed_count FROM wa_daily_stats
                 WHERE stat_date = (NOW() AT TIME ZONE 'Asia/Makassar')::date
                 LIMIT 1`
            );
            return rows.length > 0 ? rows[0] : { sent_count: 0, failed_count: 0 };
        } catch (err) {
            return { sent_count: 0, failed_count: 0 };
        }
    }

    async getStats() {
        const stats = await this.getDailyStats();
        return {
            success: true,
            sentToday: stats.sent_count,
            failedToday: stats.failed_count,
            dailyLimit: this.dailyLimit,
            remaining: Math.max(0, this.dailyLimit - stats.sent_count)
        };
    }

    // ============================================
    // PUBLIC: Pengaturan
    // ============================================
    async setDailyLimit(limit) {
        if (limit && Number.isInteger(limit) && limit > 0) {
            this.dailyLimit = limit;
            await db.query(
                `INSERT INTO app_settings (key, value) VALUES ('wa_daily_limit', $1)
                 ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
                [String(limit)]
            ).catch(err => console.warn('[WA] Save daily limit failed:', err.message));
        }
        const stats = await this.getDailyStats();
        return { success: true, dailyLimit: this.dailyLimit, sentToday: stats.sent_count };
    }

    async setAutoReplyMessage(message) {
        if (!message || !String(message).trim()) return { success: false, error: 'Pesan kosong' };
        await db.query(
            `INSERT INTO app_settings (key, value) VALUES ('form_autoreply_message', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [String(message).trim()]
        );
        this._cache.autoReplyMessage = String(message).trim();
        return { success: true };
    }

    async loadSettings() {
        try {
            const { rows } = await db.query(
                `SELECT key, value FROM app_settings WHERE key IN ('wa_daily_limit', 'form_autoreply_message')`
            );
            for (const row of rows) {
                if (row.key === 'wa_daily_limit') {
                    const val = parseInt(row.value);
                    if (val > 0) this.dailyLimit = val;
                }
                if (row.key === 'form_autoreply_message' && row.value) {
                    this._cache.autoReplyMessage = row.value;
                }
            }
            console.log(`[WA] Settings loaded: dailyLimit=${this.dailyLimit}, provider=${this.providerName}`);
        } catch (err) {
            console.warn('[WA] loadSettings error:', err.message);
        }
    }

    async _getAutoReplyTemplate() {
        if (this._cache.autoReplyMessage) return this._cache.autoReplyMessage;
        try {
            const { rows } = await db.query(
                `SELECT value FROM app_settings WHERE key = 'form_autoreply_message' LIMIT 1`
            );
            const msg = rows[0]?.value || DEFAULT_AUTOREPLY;
            this._cache.autoReplyMessage = msg;
            return msg;
        } catch (_) {
            return DEFAULT_AUTOREPLY;
        }
    }

    // ============================================
    // PUBLIC: Update status pengiriman.
    // Skala ack Baileys: 3 = DELIVERED (✓✓), 4 = READ, 5 = PLAYED.
    // Webhook Meta dipetakan ke skala yang sama supaya dashboard tidak berubah.
    // ============================================
    async updateMessageStatus(waMessageId, ackStatus) {
        if (!waMessageId) return;
        const ack = parseInt(ackStatus);
        if (!Number.isFinite(ack) || ack < 3) return;

        const newStatus = ack >= 4 ? 'READ' : 'DELIVERED';
        try {
            await db.query(
                `UPDATE whatsapp_logs SET
                    status = $1,
                    delivered_at = COALESCE(delivered_at, NOW()),
                    read_at = CASE WHEN $1 = 'READ' THEN COALESCE(read_at, NOW()) ELSE read_at END,
                    updated_at = NOW()
                 WHERE wa_message_id = $2
                   AND status IN ('SENT', 'DELIVERED')`,
                [newStatus, waMessageId]
            );
        } catch (err) {
            console.warn('[WA] updateMessageStatus failed:', err.message);
        }
    }

    // ============================================
    // INTERNAL — logging
    // ============================================
    async _insertLog({ phone, type, message_body, template_name = null, template_language = null, template_components = null }) {
        try {
            const { rows } = await db.query(
                `INSERT INTO whatsapp_logs
                    (phone, type, message_body, status, priority,
                     template_name, template_language, template_components)
                 VALUES ($1, $2, $3, 'PENDING', 'normal', $4, $5, COALESCE($6, '[]'::jsonb))
                 RETURNING id`,
                [
                    phone, type || 'text', message_body || null,
                    template_name, template_language,
                    template_components ? JSON.stringify(template_components) : null
                ]
            );
            return rows[0].id;
        } catch (err) {
            console.warn('[WA] Insert log failed:', err.message);
            return null;
        }
    }

    async _updateLog(logId, status, waMessageId, apiResponse, error) {
        if (!logId) return;
        try {
            await db.query(
                `UPDATE whatsapp_logs SET
                    status = $1, wa_message_id = $2, api_response = $3,
                    error_detail = $4,
                    sent_at = CASE WHEN $1 = 'SENT' THEN NOW() ELSE sent_at END,
                    updated_at = NOW()
                 WHERE id = $5`,
                [status, waMessageId, apiResponse ? JSON.stringify(apiResponse) : null, error, logId]
            );
        } catch (err) {
            console.warn('[WA] Update log failed:', err.message);
        }
    }

    async _updateLogFailed(logId, errorCode, errorDetail, apiResponse, retryable) {
        if (!logId) return;
        try {
            if (retryable) {
                await db.query(
                    `UPDATE whatsapp_logs SET
                        status = 'FAILED',
                        error_code = $1,
                        error_detail = $2,
                        api_response = $3,
                        retry_count = retry_count + 1,
                        next_retry_at = NOW() + (POWER(5, LEAST(retry_count + 1, 4)) || ' seconds')::interval,
                        updated_at = NOW()
                     WHERE id = $4`,
                    [errorCode, errorDetail, apiResponse ? JSON.stringify(apiResponse) : null, logId]
                );
            } else {
                await db.query(
                    `UPDATE whatsapp_logs SET
                        status = 'FAILED',
                        error_code = $1,
                        error_detail = $2,
                        api_response = $3,
                        retry_count = max_retries,
                        updated_at = NOW()
                     WHERE id = $4`,
                    [errorCode, errorDetail, apiResponse ? JSON.stringify(apiResponse) : null, logId]
                );
            }
        } catch (err) {
            console.warn('[WA] Update log failed:', err.message);
        }
    }

    async _isOptedOut(phone) {
        try {
            const { rows } = await db.query(
                `SELECT 1 FROM customers WHERE whatsapp = $1 AND opted_in = FALSE LIMIT 1`,
                [phone]
            );
            return rows.length > 0;
        } catch (err) {
            return false;
        }
    }

    async _incrementDailyCounter(type) {
        try {
            const column = type === 'sent' ? 'sent_count' : 'failed_count';
            await db.query(
                `INSERT INTO wa_daily_stats (stat_date, ${column})
                 VALUES ((NOW() AT TIME ZONE 'Asia/Makassar')::date, 1)
                 ON CONFLICT (stat_date) DO UPDATE SET ${column} = wa_daily_stats.${column} + 1, updated_at = NOW()`
            );
        } catch (err) {
            console.warn('[WA] Increment daily counter failed:', err.message);
        }
    }
}

module.exports = { WhatsAppServiceBase, DEFAULT_AUTOREPLY };
