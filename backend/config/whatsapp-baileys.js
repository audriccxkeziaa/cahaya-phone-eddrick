// ============================================
// WHATSAPP SERVICE (BAILEYS) — HTTP adapter ke wa-bridge
//
// Arsitektur:
// - wa-bridge (Baileys) = transport tipis (kirim satu pesan per panggilan)
// - File ini = HTTP client, dipanggil lewat ./whatsapp (pemilih provider)
// - wa-service-base.js = logging DB, opt-out, statistik, pengaturan
// - wa-worker.js = orkestrator anti-ban (warm-up, delay, break, jam kerja)
//
// Semua pesan keluar dicatat di `whatsapp_logs` untuk audit dan retry.
// ============================================

const axios = require('axios');
const { sanitizePhone } = require('../utils/phoneUtils');
const { WhatsAppServiceBase } = require('./wa-service-base');
require('dotenv').config();

const BRIDGE_URL = process.env.WA_BRIDGE_URL || 'http://localhost:3001';
const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET || 'cahaya-phone-secret-key';

class WhatsAppBaileysService extends WhatsAppServiceBase {
    constructor() {
        super();
        this.providerName = 'baileys';
        this.bridgeUrl = BRIDGE_URL;
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

    // Ubah error bridge jadi bentuk hasil yang seragam antar provider.
    _describeError(err) {
        // Bridge menandai nomor tak terdaftar WA dengan code khusus —
        // permanent failure, JANGAN retry (kirim ulang ke nomor mati = sinyal spam)
        const bridgeCode = err.bridgeData?.code;
        const errorCode = bridgeCode || (err.bridgeStatus ? String(err.bridgeStatus) : 'BRIDGE_ERR');
        return {
            errorCode,
            errorDetail: err.message || 'Unknown error',
            apiResponse: err.bridgeData,
            retryable: bridgeCode === 'NOT_ON_WHATSAPP'
                ? false
                : this._isRetryable(errorCode, err.bridgeStatus)
        };
    }

    // ============================================
    // PUBLIC: Kirim teks (membuat baris log baru).
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
            const e = this._describeError(err);
            await this._updateLogFailed(logId, e.errorCode, e.errorDetail, e.apiResponse, e.retryable);
            await this._incrementDailyCounter('failed');
            return {
                success: false, phone: formattedNumber,
                error: e.errorDetail, error_code: e.errorCode, retryable: e.retryable
            };
        }
    }

    // ============================================
    // PUBLIC: Kirim untuk baris whatsapp_logs yang SUDAH ada.
    // Dipakai wa-worker saat menguras antrean — pemanggil yang mengurus
    // pembaruan baris log, jadi di sini tidak ada _insertLog/_updateLog.
    // ============================================
    async sendForExistingLog(phone, message, { typing = true, category = 'text' } = {}) {
        const formattedNumber = sanitizePhone(phone);
        if (!formattedNumber || !formattedNumber.startsWith('62')) {
            return { success: false, error: 'Invalid phone number', error_code: 'INVALID_PHONE', retryable: false };
        }
        try {
            const result = await this._bridgeCall('POST', '/api/send', {
                phone: formattedNumber, message, typing
            });
            return {
                success: true, phone: formattedNumber,
                wa_message_id: result?.wa_message_id || null,
                api_response: result,
                category
            };
        } catch (err) {
            const e = this._describeError(err);
            return {
                success: false, phone: formattedNumber,
                error: e.errorDetail, error_code: e.errorCode,
                retryable: e.retryable, api_response: e.apiResponse
            };
        }
    }

    // ============================================
    // PUBLIC: Cek nomor terdaftar di WhatsApp (via bridge)
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
            // Bridge tidak nyambung — tidak bisa dicek, anggap terdaftar biar kiriman tetap dicoba
            return { registered: true, unchecked: true, error: err.message };
        }
    }

    // ============================================
    // PUBLIC: Status bridge (untuk dashboard admin)
    // ============================================
    async getStatus() {
        try {
            const result = await this._bridgeCall('GET', '/api/status', null, 5000);
            const stats = await this.getDailyStats();
            const connected = result.status === 'open';

            return {
                success: true,
                status: connected ? 'connected' : result.status,
                provider: 'baileys',
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
                provider: 'baileys',
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
    // PUBLIC: Restart / disconnect bridge (aksi admin)
    // ============================================
    async restartBridge() {
        return this._bridgeCall('POST', '/api/restart');
    }
    async disconnectBridge() {
        return this._bridgeCall('POST', '/api/disconnect');
    }

    _isRetryable(errorCode, httpStatus) {
        // Bridge unreachable / timeout → retry
        if (!httpStatus || httpStatus === 503 || httpStatus === 502 || httpStatus === 504) return true;
        if (httpStatus === 429) return true;
        if (httpStatus >= 500) return true;
        if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'ECONNREFUSED', 'BRIDGE_ERR'].includes(errorCode)) return true;
        return false;
    }
}

module.exports = new WhatsAppBaileysService();
