// ============================================
// WHATSAPP SERVICE (META CLOUD API RESMI)
//
// Aktif hanya kalau WA_PROVIDER=cloud. Tanpa itu, ./whatsapp memilih
// whatsapp-baileys.js dan file ini tidak pernah di-load.
//
// Perbedaan mendasar dari Baileys:
// - Di LUAR jendela 24 jam hanya boleh kirim TEMPLATE yang sudah di-approve
//   Meta. Kirim teks bebas akan ditolak dengan error 131047.
// - Di DALAM jendela 24 jam boleh kirim teks bebas.
// - Tidak ada QR, tidak ada sesi yang bisa putus, tidak ada risiko ban
//   mendadak. Yang ada: quality rating dan messaging tier.
// - Status pengiriman datang lewat webhook Meta, bukan event socket.
//
// Jendela 24 jam dilacak lewat customers.last_incoming_message_at yang sudah
// diisi webhookController setiap ada chat masuk.
// ============================================

const axios = require('axios');
const db = require('./database');
const { sanitizePhone } = require('../utils/phoneUtils');
const { WhatsAppServiceBase } = require('./wa-service-base');
const { buildTemplate } = require('./wa-templates');
require('dotenv').config();

const API_VERSION = process.env.META_API_VERSION || 'v21.0';
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || '';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const GRAPH_BASE = 'https://graph.facebook.com';

// Kode error Meta yang layak diulang. Sisanya permanen — mengulang kiriman
// yang ditolak karena template salah atau di luar jendela hanya membuang kuota
// dan menumpuk antrean.
const RETRYABLE_META_CODES = new Set([
    '130429',   // rate limit hit
    '131056',   // pair rate limit hit
    '133016',   // akun sementara tidak tersedia
    '500', '502', '503', '504'
]);

class WhatsAppCloudService extends WhatsAppServiceBase {
    constructor() {
        super();
        this.providerName = 'cloud';
        this._statusCache = { at: 0, value: null };
    }

    // ============================================
    // TRANSPORT
    // ============================================
    async _graphCall(method, path, body = null, timeoutMs = 20000) {
        try {
            const config = {
                method,
                url: `${GRAPH_BASE}/${API_VERSION}${path}`,
                headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
                timeout: timeoutMs
            };
            if (body !== null && body !== undefined) {
                config.data = body;
                config.headers['Content-Type'] = 'application/json';
            }
            const res = await axios(config);
            return res.data;
        } catch (err) {
            const status = err.response?.status;
            const metaError = err.response?.data?.error;
            const wrapped = new Error(metaError?.message || err.message);
            wrapped.httpStatus = status;
            wrapped.metaCode = metaError?.code != null ? String(metaError.code) : null;
            wrapped.metaSubcode = metaError?.error_subcode != null ? String(metaError.error_subcode) : null;
            wrapped.metaError = metaError || null;
            throw wrapped;
        }
    }

    _describeError(err) {
        const errorCode = err.metaCode || (err.httpStatus ? String(err.httpStatus) : 'GRAPH_ERR');
        let detail = err.message || 'Unknown error';

        // Token kedaluwarsa/dicabut butuh tindakan manusia — jangan sampai
        // tenggelam di antara ratusan baris log biasa.
        if (errorCode === '190') {
            console.error('[WA CLOUD] TOKEN META TIDAK VALID — pengiriman berhenti sampai META_ACCESS_TOKEN diperbarui.');
            detail = `Token Meta tidak valid: ${detail}`;
        }

        return {
            errorCode,
            errorDetail: detail,
            apiResponse: err.metaError,
            retryable: this._isRetryable(errorCode, err.httpStatus)
        };
    }

    _isRetryable(errorCode, httpStatus) {
        if (!httpStatus) return true;                       // timeout / jaringan
        if (httpStatus >= 500) return true;
        if (RETRYABLE_META_CODES.has(String(errorCode))) return true;
        return false;
    }

    // ============================================
    // JENDELA 24 JAM — penentu biaya
    //
    // Terbuka  → boleh kirim teks bebas (murah/gratis)
    // Tertutup → wajib template (berbayar)
    // ============================================
    async _isWindowOpen(phone) {
        try {
            const { rows } = await db.query(
                `SELECT 1 FROM customers
                  WHERE whatsapp = $1
                    AND last_incoming_message_at IS NOT NULL
                    AND last_incoming_message_at > NOW() - INTERVAL '24 hours'
                  LIMIT 1`,
                [phone]
            );
            return rows.length > 0;
        } catch (err) {
            // Gagal cek → anggap tertutup. Salah menebak "terbuka" berarti Meta
            // menolak dengan 131047 dan pesannya hilang; salah menebak "tertutup"
            // hanya berarti terkirim sebagai template berbayar. Pilih yang sampai.
            console.warn('[WA CLOUD] Cek jendela 24 jam gagal:', err.message);
            return false;
        }
    }

    async _lookupName(phone) {
        try {
            const { rows } = await db.query(
                `SELECT nama_lengkap FROM customers WHERE whatsapp = $1 LIMIT 1`,
                [phone]
            );
            return rows[0]?.nama_lengkap || 'Kak';
        } catch (_) {
            return 'Kak';
        }
    }

    // Susun payload untuk /messages, plus metadata untuk pencatatan log.
    // Return { payload, meta } atau { error } kalau kategori tidak punya template.
    async _buildPayload(phone, message, category) {
        if (await this._isWindowOpen(phone)) {
            return {
                payload: {
                    messaging_product: 'whatsapp',
                    to: phone,
                    type: 'text',
                    text: { body: message, preview_url: false }
                },
                meta: { template_name: null, template_language: null, template_components: null, billable: false }
            };
        }

        const nama = await this._lookupName(phone);
        const tpl = buildTemplate(category, { nama, message });
        if (!tpl) {
            return {
                error: {
                    errorCode: 'NO_TEMPLATE',
                    errorDetail: `Jendela 24 jam tertutup dan kategori '${category}' tidak punya template terdaftar di wa-templates.js`,
                    retryable: false
                }
            };
        }

        return {
            payload: {
                messaging_product: 'whatsapp',
                to: phone,
                type: 'template',
                template: {
                    name: tpl.name,
                    language: { code: tpl.language },
                    components: tpl.components
                }
            },
            meta: {
                template_name: tpl.name,
                template_language: tpl.language,
                template_components: tpl.components,
                billable: true
            }
        };
    }

    async _post(payload) {
        const result = await this._graphCall('POST', `/${PHONE_NUMBER_ID}/messages`, payload);
        return { waMessageId: result?.messages?.[0]?.id || null, raw: result };
    }

    // ============================================
    // PUBLIC: Kirim teks (membuat baris log baru)
    // ============================================
    async sendText(phone, message, { category = 'text', skipOptCheck = false } = {}) {
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

        const built = await this._buildPayload(formattedNumber, message, category);

        if (built.error) {
            const logId = await this._insertLog({ phone: formattedNumber, type: category, message_body: message });
            await this._updateLogFailed(logId, built.error.errorCode, built.error.errorDetail, null, false);
            await this._incrementDailyCounter('failed');
            console.warn(`[WA CLOUD] ${formattedNumber}: ${built.error.errorDetail}`);
            return {
                success: false, phone: formattedNumber,
                error: built.error.errorDetail, error_code: built.error.errorCode, retryable: false
            };
        }

        const logId = await this._insertLog({
            phone: formattedNumber,
            type: category,
            message_body: message,
            template_name: built.meta.template_name,
            template_language: built.meta.template_language,
            template_components: built.meta.template_components
        });

        try {
            const { waMessageId, raw } = await this._post(built.payload);
            await this._updateLog(logId, 'SENT', waMessageId, raw, null);
            await this._incrementDailyCounter('sent');
            return {
                success: true, phone: formattedNumber,
                wa_message_id: waMessageId,
                billable: built.meta.billable
            };
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
    // PUBLIC: Kirim untuk baris whatsapp_logs yang SUDAH ada (dipakai wa-worker)
    // ============================================
    async sendForExistingLog(phone, message, { category = 'text' } = {}) {
        const formattedNumber = sanitizePhone(phone);
        if (!formattedNumber || !formattedNumber.startsWith('62')) {
            return { success: false, error: 'Invalid phone number', error_code: 'INVALID_PHONE', retryable: false };
        }

        const built = await this._buildPayload(formattedNumber, message, category);
        if (built.error) {
            return {
                success: false, phone: formattedNumber,
                error: built.error.errorDetail, error_code: built.error.errorCode, retryable: false
            };
        }

        try {
            const { waMessageId, raw } = await this._post(built.payload);
            return {
                success: true, phone: formattedNumber,
                wa_message_id: waMessageId, api_response: raw,
                billable: built.meta.billable, category
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

    // Isi template tidak boleh diacak — variasi apa pun membuatnya tidak cocok
    // dengan template terdaftar dan ditolak Meta. Di API resmi juga tidak ada
    // fingerprinting yang perlu dihindari.
    _varyText(text) {
        return text;
    }

    // ============================================
    // PUBLIC: Cloud API tidak punya cek "nomor terdaftar di WA".
    // Kiriman ke nomor mati akan gagal dengan 131026 saat dikirim.
    // ============================================
    async isNumberRegistered(phone) {
        const formattedNumber = sanitizePhone(phone);
        if (!formattedNumber || !formattedNumber.startsWith('62')) {
            return { registered: false, error: 'Nomor tidak valid' };
        }
        return { registered: true, unchecked: true };
    }

    // ============================================
    // PUBLIC: Status nomor (untuk dashboard admin).
    // Bentuknya sengaja dibuat sama seperti versi Baileys supaya admin.js
    // tidak perlu tahu provider mana yang aktif.
    // ============================================
    async getStatus() {
        const stats = await this.getDailyStats();

        // Cache 5 menit — dashboard polling terus, Graph API tidak perlu ikut.
        const CACHE_MS = 5 * 60_000;
        if (this._statusCache.value && Date.now() - this._statusCache.at < CACHE_MS) {
            return {
                ...this._statusCache.value,
                messagesSentToday: stats.sent_count,
                messagesFailedToday: stats.failed_count,
                dailyLimit: this.dailyLimit
            };
        }

        try {
            const info = await this._graphCall(
                'GET',
                `/${PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating`,
                null,
                8000
            );

            const value = {
                success: true,
                status: 'connected',
                provider: 'cloud',
                mode: 'meta_cloud_api',
                qr: null,
                qrNeeded: false,
                info: {
                    phone: String(info.display_phone_number || '').replace(/\D/g, ''),
                    name: info.verified_name || null
                },
                qualityRating: info.quality_rating || 'UNKNOWN',
                verifiedName: info.verified_name || null,
                lastError: null
            };
            this._statusCache = { at: Date.now(), value };

            return {
                ...value,
                messagesSentToday: stats.sent_count,
                messagesFailedToday: stats.failed_count,
                dailyLimit: this.dailyLimit
            };
        } catch (err) {
            const e = this._describeError(err);
            return {
                success: false,
                status: 'cloud_unreachable',
                provider: 'cloud',
                mode: 'meta_cloud_api',
                lastError: `Graph API tidak bisa dihubungi (${e.errorCode}): ${e.errorDetail}`,
                messagesSentToday: stats.sent_count,
                messagesFailedToday: stats.failed_count,
                dailyLimit: this.dailyLimit
            };
        }
    }

    isConfigured() {
        return !!(PHONE_NUMBER_ID && ACCESS_TOKEN);
    }

    // Tidak ada sesi untuk di-restart/diputus di API resmi.
    async restartBridge() {
        this._statusCache = { at: 0, value: null };
        return { success: true, noop: true, message: 'Cloud API tidak punya sesi — tidak ada yang perlu di-restart' };
    }
    async disconnectBridge() {
        return { success: true, noop: true, message: 'Cloud API tidak punya sesi — tidak ada yang perlu diputus' };
    }
}

module.exports = new WhatsAppCloudService();
