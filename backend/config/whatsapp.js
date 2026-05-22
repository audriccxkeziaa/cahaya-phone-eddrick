// ============================================
// WHATSAPP SERVICE — HTTP adapter to wa-bridge (Baileys)
//
// Architecture:
// - wa-bridge (Baileys) = thin transport service (sends one message at a time)
// - This module = HTTP client + DB logging, called by controllers
// - wa-worker.js = anti-ban orchestrator (warm-up, delay, break, working hours)
//
// All outgoing messages are logged to `whatsapp_logs` for audit and retry.
// ============================================

const axios = require('axios');
const db = require('./database');
const { sanitizePhone } = require('../utils/phoneUtils');
require('dotenv').config();

const BRIDGE_URL = process.env.WA_BRIDGE_URL || 'http://localhost:3001';
const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET || 'cahaya-phone-secret-key';

const DEFAULT_AUTOREPLY = 'Halo {nama}, terima kasih telah menghubungi Cahaya Phone Gorontalo! 🙏\n\nData Anda sudah kami terima. Tim kami akan segera menghubungi Anda untuk proses selanjutnya.\n\nSalam hangat,\nCahaya Phone';

class WhatsAppService {
    constructor() {
        this.bridgeUrl = BRIDGE_URL;
        this.dailyLimit = 200;
        this._cache = { autoReplyMessage: DEFAULT_AUTOREPLY };
    }

    // ============================================
    // BRIDGE HTTP HELPERS
    // ============================================
    async _bridgeCall(method, path, body = null, timeoutMs = 20000) {
        try {
            const headers = { 'X-WA-Secret': BRIDGE_SECRET };
            const config = { method, url: `${this.bridgeUrl}${path}`, headers, timeout: timeoutMs };
            if (body !== null && body !== undefined) {
                config.data = body;
                headers['Content-Type'] = 'application/json';
            }
            const res = await axios(config);
            return res.data;
        } catch (err) {
            const status = err.response?.status;
            const data = err.response?.data;
            const msg = data?.error || err.message;
            const wrapped = new Error(msg);
            wrapped.bridgeStatus = status;
            wrapped.bridgeData = data;
            throw wrapped;
        }
    }

    // ============================================
    // PUBLIC: Send text (logged). All sends go through here.
    // ============================================
    async sendText(phone, message, { typing = true, category = 'text', skipOptCheck = false } = {}) {
        const formattedNumber = sanitizePhone(phone);
        if (!formattedNumber || !formattedNumber.startsWith('62')) {
            return { success: false, error: 'Invalid phone number', phone };
        }

        if (!skipOptCheck) {
            const optedOut = await this._isOptedOut(formattedNumber);
            if (optedOut) {
                return { success: false, error: 'Customer telah opt-out', phone, opted_out: true };
            }
        }

        const logId = await this._insertLog({
            phone: formattedNumber,
            type: category,
            message_body: message
        });

        try {
            const result = await this._bridgeCall('POST', '/api/send', {
                phone: formattedNumber,
                message,
                typing
            });
            const waMessageId = result?.wa_message_id || null;
            await this._updateLog(logId, 'SENT', waMessageId, result, null);
            await this._incrementDailyCounter('sent');
            return { success: true, phone: formattedNumber, wa_message_id: waMessageId };
        } catch (err) {
            const errorCode = err.bridgeStatus ? String(err.bridgeStatus) : 'BRIDGE_ERR';
            const errorDetail = err.message || 'Unknown error';
            const retryable = this._isRetryable(errorCode, err.bridgeStatus);
            await this._updateLogFailed(logId, errorCode, errorDetail, err.bridgeData, retryable);
            await this._incrementDailyCounter('failed');
            return { success: false, phone: formattedNumber, error: errorDetail, error_code: errorCode, retryable };
        }
    }

    // ============================================
    // PUBLIC: Send with auto-reply fallback. No 24h window concept in Baileys.
    // Kept for API compat with earlier Cloud API code.
    // ============================================
    async sendMessage(phone, message) {
        return this.sendText(phone, message);
    }

    // ============================================
    // PUBLIC: Broadcast send (same as text — backend worker controls pacing)
    // ============================================
    async sendBroadcastMessage(phone, message) {
        return this.sendText(phone, message, { typing: true, category: 'broadcast' });
    }

    // ============================================
    // PUBLIC: Auto-reply after form submit (LEGACY — sends immediately).
    // Kept for backwards compat but no longer called from formController.
    // ============================================
    async sendAutoReply(customer) {
        const tmpl = await this._getAutoReplyTemplate();
        const message = tmpl.replace(/\{nama\}/g, customer.nama_lengkap || 'Kak');
        return this.sendText(customer.whatsapp, message, { typing: true, category: 'auto_reply', skipOptCheck: true });
    }

    // ============================================
    // PUBLIC: Queue auto-reply for anti-ban-paced delivery via wa-worker.
    // Worker drains queue at 60-120s intervals, with breaks every 25-30 sends,
    // and respects 08:00-22:00 WITA working hours. Customer-facing form returns
    // success immediately; the actual WA send happens minutes later.
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

        const { spinText } = require('./wa-worker');
        const tmpl = await this._getAutoReplyTemplate();
        let message = spinText(tmpl);
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
    // PUBLIC: Birthday greeting
    // ============================================
    async sendBirthdayGreeting(customer, customMessage) {
        const message = (customMessage || '').replace(/\{nama\}/g, customer.nama_lengkap || 'Kak');
        if (!message.trim()) return { success: false, error: 'Empty message' };
        return this.sendText(customer.whatsapp, message, { typing: true, category: 'birthday' });
    }

    // ============================================
    // PUBLIC: Check if number is registered on WhatsApp (via bridge)
    // ============================================
    async isNumberRegistered(phone) {
        const formattedNumber = sanitizePhone(phone);
        if (!formattedNumber || !formattedNumber.startsWith('62')) {
            return { registered: false, error: 'Nomor tidak valid' };
        }
        try {
            const result = await this._bridgeCall('POST', '/api/check-number', { phone: formattedNumber }, 15000);
            return { registered: !!result.registered, jid: result.jid };
        } catch (err) {
            // If bridge not connected, we can't check — assume registered so send can attempt
            return { registered: true, unchecked: true, error: err.message };
        }
    }

    // ============================================
    // PUBLIC: Bridge status (for admin dashboard)
    // ============================================
    async getStatus() {
        try {
            const result = await this._bridgeCall('GET', '/api/status', null, 5000);
            const stats = await this.getDailyStats();
            const connected = result.status === 'open';

            return {
                success: true,
                status: connected ? 'connected' : result.status,
                mode: 'baileys_bridge',
                qr: result.qr || null,
                qrNeeded: result.status === 'qr_pending',
                info: result.info || null,
                bridgeStatus: result.status,
                lastError: result.lastError,
                connectedAt: result.connectedAt,
                disconnectedAt: result.disconnectedAt,
                messagesSentToday: stats.sent_count,
                messagesFailedToday: stats.failed_count,
                dailyLimit: this.dailyLimit
            };
        } catch (err) {
            const stats = await this.getDailyStats();
            return {
                success: false,
                status: 'bridge_unreachable',
                mode: 'baileys_bridge',
                lastError: `Bridge tidak bisa dihubungi: ${err.message}. Cek WA_BRIDGE_URL.`,
                messagesSentToday: stats.sent_count,
                messagesFailedToday: stats.failed_count,
                dailyLimit: this.dailyLimit
            };
        }
    }

    isConfigured() {
        return !!(this.bridgeUrl && BRIDGE_SECRET);
    }

    // ============================================
    // PUBLIC: Restart / disconnect bridge (admin actions)
    // ============================================
    async restartBridge() {
        return this._bridgeCall('POST', '/api/restart');
    }
    async disconnectBridge() {
        return this._bridgeCall('POST', '/api/disconnect');
    }

    // ============================================
    // PUBLIC: Daily stats
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
    // PUBLIC: Settings
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
            console.log(`[WA] Settings loaded: dailyLimit=${this.dailyLimit}, bridge=${this.bridgeUrl}`);
        } catch (err) {
            console.warn('[WA] loadSettings error:', err.message);
        }
    }

    async _getAutoReplyTemplate() {
        // Try cache first
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
    // PUBLIC (noop for compat — Baileys has no delivery webhooks like Cloud API)
    // ============================================
    async updateMessageStatus(_waMessageId, _status, _timestamp) {
        // Baileys can emit message status events, but we don't wire them.
        // Kept as no-op so existing callers don't break.
    }

    // ============================================
    // INTERNAL
    // ============================================
    async _insertLog({ phone, type, message_body }) {
        try {
            const { rows } = await db.query(
                `INSERT INTO whatsapp_logs (phone, type, message_body, status, priority)
                 VALUES ($1, $2, $3, 'PENDING', 'normal')
                 RETURNING id`,
                [phone, type || 'text', message_body || null]
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

    _isRetryable(errorCode, httpStatus) {
        // Bridge unreachable / timeout → retry
        if (!httpStatus || httpStatus === 503 || httpStatus === 502 || httpStatus === 504) return true;
        if (httpStatus === 429) return true;
        if (httpStatus >= 500) return true;
        if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'ECONNREFUSED', 'BRIDGE_ERR'].includes(errorCode)) return true;
        return false;
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

module.exports = new WhatsAppService();
