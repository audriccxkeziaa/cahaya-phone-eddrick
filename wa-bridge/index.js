// ============================================
// CAHAYA PHONE WA BRIDGE v2 (Baileys)
// Thin WhatsApp transport service.
// - QR auth + auto-reconnect
// - Send text messages (single, immediate)
// - Check number registered
// - Forward incoming messages to backend webhook
//
// Deployed to Railway. No Chromium needed.
// Anti-ban orchestration (warm-up, delays, working hours) lives
// in the BACKEND worker — this bridge just transports messages.
// ============================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const rawLogger = pino({ level: process.env.LOG_LEVEL || 'warn' });
const BAD_MAC_ALERT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const BAD_MAC_ALERT_THRESHOLD = 10;
let badMacErrorTimestamps = [];
let badMacRestartScheduled = false;

function registerBadMacError(message) {
    const text = String(message || '');
    if (!/Bad MAC|Failed to decrypt message/i.test(text)) return;

    const now = Date.now();
    badMacErrorTimestamps = badMacErrorTimestamps.filter(ts => now - ts < BAD_MAC_ALERT_WINDOW_MS);
    badMacErrorTimestamps.push(now);

    if (badMacErrorTimestamps.length >= BAD_MAC_ALERT_THRESHOLD && !badMacRestartScheduled) {
        badMacRestartScheduled = true;
        rawLogger.warn('[BAILEYS] High Bad MAC rate detected — restarting socket to recover session.');
        if (sock) {
            try { sock.end(new Error('bad mac recovery')); } catch (err) {
                rawLogger.warn('[BAILEYS] Failed to end socket during bad mac recovery:', err.message);
            }
        }
    }
}

// FIX: Simpan referensi method ASLI sebelum override.
// Bug lama: logger === rawLogger (object yang sama), sehingga
//   logger.error = fn(){ rawLogger.error() }  →  memanggil dirinya sendiri
//   → infinite recursion → Maximum call stack size exceeded.
const _rawWarn  = rawLogger.warn.bind(rawLogger);
const _rawError = rawLogger.error.bind(rawLogger);
const _rawFatal = rawLogger.fatal.bind(rawLogger);

const logger = rawLogger;
logger.warn = function (...args) {
    registerBadMacError(args[0]);
    return _rawWarn(...args);
};
logger.error = function (...args) {
    registerBadMacError(args[0]);
    return _rawError(...args);
};
logger.fatal = function (...args) {
    registerBadMacError(args[0]);
    return _rawFatal(...args);
};

// ============================================
// CONFIG
// ============================================
const PORT           = process.env.PORT             || 3001;
const API_SECRET     = process.env.WA_BRIDGE_SECRET || 'cahaya-phone-secret-key';
const WEBHOOK_URL    = process.env.WEBHOOK_URL      || '';
const SESSION_DIR    = process.env.SESSION_DIR      || './wa-session';
const RECONNECT_MIN_DELAY = 5_000;
const RECONNECT_MAX_DELAY = 60_000;

// Jam operasional WITA (UTC+8). Override via env jika perlu.
const ACTIVE_HOUR_START = parseInt(process.env.ACTIVE_HOUR_START ?? '8',  10); // 08:00 WITA
const ACTIVE_HOUR_END   = parseInt(process.env.ACTIVE_HOUR_END   ?? '22', 10); // 22:00 WITA

// ============================================
// STATE
// ============================================
let sock = null;
let clientState = {
    status: 'disconnected', // disconnected | connecting | qr_pending | open | logged_out | error | sleeping
    qr: null,
    qrRaw: null,
    info: null,
    lastError: null,
    connectedAt: null,
    disconnectedAt: null,
    sleepUntil: null,       // ISO string — kapan akan bangun
};
let reconnectAttempts = 0;
let reconnectTimer    = null;
let sleepTimer        = null;
let isSleeping        = false;
let isShuttingDown    = false;

// ============================================
// HTTP APP
// ============================================
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50kb' }));

function authCheck(req, res, next) {
    const secret = req.headers['x-wa-secret'] || req.query.secret;
    if (secret !== API_SECRET) {
        return res.status(401).json({ success: false, error: 'Invalid secret' });
    }
    next();
}

// ============================================
// HELPERS
// ============================================
function toJid(phone) {
    const clean = String(phone || '').replace(/\D/g, '');
    if (!clean) return null;
    return `${clean}@s.whatsapp.net`;
}

function isReady() {
    return sock && clientState.status === 'open';
}

/** Jam WITA saat ini (0–23) */
function witaHour() {
    return new Date(Date.now() + 8 * 3600_000).getUTCHours();
}

/** Apakah sekarang dalam jam operasional? */
function isActiveHour() {
    const h = witaHour();
    return h >= ACTIVE_HOUR_START && h < ACTIVE_HOUR_END;
}

// ============================================
// FORWARD QUEUE
// ============================================
const fs   = require('fs');
const path = require('path');
const PENDING_FORWARDS_FILE     = path.join(SESSION_DIR, 'pending-forwards.json');
const FORWARD_RETRY_INTERVAL_MS = 30_000;
const FORWARD_RETRY_BATCH       = 5;
const FORWARD_MAX_ATTEMPTS      = 200;
const FORWARD_QUEUE_MAX_SIZE    = 1000;

let pendingForwards   = [];
let forwardRetryTimer = null;
let forwardSaveTimer  = null;

function loadPendingForwards() {
    try {
        if (fs.existsSync(PENDING_FORWARDS_FILE)) {
            const raw = fs.readFileSync(PENDING_FORWARDS_FILE, 'utf8');
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                pendingForwards = arr;
                console.log(`[FORWARD] Loaded ${pendingForwards.length} pending forward(s) from disk`);
                if (pendingForwards.length > 0) ensureRetryTimer();
            }
        }
    } catch (err) {
        console.warn('[FORWARD] Could not load pending forwards:', err.message);
    }
}

function savePendingForwards() {
    if (forwardSaveTimer) return;
    forwardSaveTimer = setTimeout(() => {
        forwardSaveTimer = null;
        try {
            fs.mkdirSync(SESSION_DIR, { recursive: true });
            fs.writeFileSync(PENDING_FORWARDS_FILE, JSON.stringify(pendingForwards));
        } catch (err) {
            console.warn('[FORWARD] Could not persist pending forwards:', err.message);
        }
    }, 1000);
}

function ensureRetryTimer() {
    if (forwardRetryTimer) return;
    forwardRetryTimer = setInterval(retryPendingForwards, FORWARD_RETRY_INTERVAL_MS);
}

function stopRetryTimer() {
    if (forwardRetryTimer) {
        clearInterval(forwardRetryTimer);
        forwardRetryTimer = null;
    }
}

async function attemptForward(payload) {
    const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WA-Secret': API_SECRET },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
}

async function retryPendingForwards() {
    if (pendingForwards.length === 0) { stopRetryTimer(); return; }
    const batch       = pendingForwards.splice(0, FORWARD_RETRY_BATCH);
    const failedAgain = [];
    let successCount  = 0;

    for (const entry of batch) {
        entry.attempts = (entry.attempts || 0) + 1;
        try {
            await attemptForward(entry.payload);
            successCount++;
        } catch (err) {
            if (entry.attempts < FORWARD_MAX_ATTEMPTS) failedAgain.push(entry);
            else console.error(`[FORWARD] Dropping message from ${entry.payload.sender} after ${entry.attempts} attempts`);
        }
    }
    pendingForwards.push(...failedAgain);
    savePendingForwards();
    if (successCount > 0)
        console.log(`[FORWARD] Retry: ${successCount} delivered, ${failedAgain.length} still pending (queue: ${pendingForwards.length})`);
    if (pendingForwards.length === 0) stopRetryTimer();
}

async function wipeSession() {
    const fsp = fs.promises;
    await new Promise(r => setTimeout(r, 500));
    try {
        await fsp.rm(SESSION_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (err) {
        console.warn('[SESSION] Bulk rm failed (', err.message, ') — per-file fallback');
        try {
            const entries = await fsp.readdir(SESSION_DIR);
            for (const e of entries) {
                try { await fsp.unlink(path.join(SESSION_DIR, e)); }
                catch (e2) { console.warn(`[SESSION] Could not unlink ${e}: ${e2.message}`); }
            }
        } catch (_) {}
    }
    try { await fsp.mkdir(SESSION_DIR, { recursive: true }); } catch (_) {}
}

async function forwardIncoming(payload) {
    if (!WEBHOOK_URL) return;
    try {
        await attemptForward(payload);
    } catch (err) {
        if (pendingForwards.length >= FORWARD_QUEUE_MAX_SIZE) {
            console.error(`[FORWARD] Queue full — dropping oldest`);
            pendingForwards.shift();
        }
        pendingForwards.push({ payload, queuedAt: Date.now(), attempts: 0 });
        savePendingForwards();
        ensureRetryTimer();
        console.warn(`[WEBHOOK] Forward failed (${err.message}), queued. Pending: ${pendingForwards.length}`);
    }
}

loadPendingForwards();

// ============================================
// SLEEP / WAKE  (jam operasional 08:00–22:00 WITA)
//
// FIX: Dulu pakai process.exit(0) → Railway anggap selesai (status "completed"),
// tidak di-restart otomatis, harus redeploy manual tiap hari.
//
// Sekarang: proses Node.js TIDAK pernah mati sendiri.
//   22:00 WITA → putus socket WA, set isSleeping = true, proses tetap hidup
//   08:00 WITA → reconnect otomatis, isSleeping = false
//   Loop setiap hari tanpa perlu redeploy / Railway restart.
// ============================================

/** Hitung ms dari sekarang ke jam H:00 WITA berikutnya */
function msUntilWitaHour(targetHour) {
    const nowUtcMs = Date.now();
    const witaMs   = nowUtcMs + 8 * 3600_000;
    const witaNow  = new Date(witaMs);
    const target   = new Date(witaNow);
    target.setUTCHours(targetHour, 0, 0, 0);
    if (target <= witaNow) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - witaNow.getTime();
}

/** Matikan socket lalu tidur sampai jam buka */
async function enterSleep() {
    if (isSleeping || isShuttingDown) return;
    isSleeping = true;

    console.log(`[SLEEP] Jam operasional selesai (${ACTIVE_HOUR_END}:00 WITA) — memutus koneksi WA`);

    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (sock) {
        try { sock.end(new Error('sleep')); } catch (_) {}
        sock = null;
    }

    clientState.status         = 'sleeping';
    clientState.info           = null;
    clientState.disconnectedAt = new Date().toISOString();

    const msWake = msUntilWitaHour(ACTIVE_HOUR_START);
    const wakeAt = new Date(Date.now() + msWake).toISOString();
    clientState.sleepUntil = wakeAt;

    const hWake = (msWake / 3600_000).toFixed(1);
    console.log(`[SLEEP] Bangun jam ${ACTIVE_HOUR_START}:00 WITA dalam ~${hWake}h (${wakeAt})`);

    sleepTimer = setTimeout(() => { sleepTimer = null; wake(); }, msWake);
}

/** Reconnect saat jam buka */
function wake() {
    if (!isSleeping) return;
    isSleeping = false;
    clientState.sleepUntil = null;
    reconnectAttempts = 0;

    console.log(`[WAKE] ${ACTIVE_HOUR_START}:00 WITA — membangunkan koneksi WA...`);
    startSocket().catch(err => {
        console.error('[WAKE] startSocket gagal:', err.message);
        reconnectAttempts = 1;
        scheduleReconnect();
    });

    // Jadwalkan tidur lagi nanti malam
    scheduleSleep();
}

/** Jadwalkan tidur di jam ACTIVE_HOUR_END hari ini/besok */
function scheduleSleep() {
    const ms = msUntilWitaHour(ACTIVE_HOUR_END);
    const h  = (ms / 3600_000).toFixed(1);
    console.log(`[SLEEP] Jadwal tidur berikutnya dalam ~${h}h (${ACTIVE_HOUR_END}:00 WITA)`);
    setTimeout(() => enterSleep(), ms);
}

/** Dipanggil sekali saat startup — tentukan langsung tidur atau aktif */
function initOperationalSchedule() {
    if (process.env.DISABLE_ACTIVE_HOURS === 'true') {
        console.log('[SCHEDULE] Jam operasional dinonaktifkan via env — selalu aktif');
        return;
    }

    if (isActiveHour()) {
        // Sekarang jam operasional → aktif, tidur nanti malam
        console.log(`[SCHEDULE] Jam operasional aktif (${ACTIVE_HOUR_START}:00–${ACTIVE_HOUR_END}:00 WITA) — langsung konek`);
        scheduleSleep();
    } else {
        // Di luar jam operasional → tidur, tunggu jam buka
        const msWake  = msUntilWitaHour(ACTIVE_HOUR_START);
        const wakeAt  = new Date(Date.now() + msWake).toISOString();
        const hWake   = (msWake / 3600_000).toFixed(1);
        console.log(`[SCHEDULE] Di luar jam operasional — tidur dulu, bangun ${ACTIVE_HOUR_START}:00 WITA dalam ~${hWake}h`);

        isSleeping             = true;
        clientState.status     = 'sleeping';
        clientState.sleepUntil = wakeAt;

        sleepTimer = setTimeout(() => { sleepTimer = null; wake(); }, msWake);
    }
}

// ============================================
// BAILEYS SOCKET LIFECYCLE
// ============================================
async function startSocket() {
    if (isShuttingDown || isSleeping) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    try {
        clientState.status    = 'connecting';
        clientState.lastError = null;

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`[BAILEYS] Using version ${version.join('.')} (latest: ${isLatest})`);

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            logger,
            printQRInTerminal: false,
            browser: Browsers.macOS('Safari'),
            syncFullHistory: false,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            getMessage: async () => undefined,
            keepAliveIntervalMs: 30_000,
            connectTimeoutMs: 60_000,
            defaultQueryTimeoutMs: 60_000,
            shouldSyncHistoryMessage: () => false,
            shouldIgnoreJid: jid => /@(broadcast|status)/.test(jid || '')
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                clientState.status = 'qr_pending';
                clientState.qrRaw  = qr;
                try {
                    clientState.qr = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
                    console.log('[QR] QR baru — scan via admin dashboard');
                } catch (err) {
                    console.error('[QR] Gagal generate QR image:', err.message);
                }
            }

            if (connection === 'open') {
                clientState.status      = 'open';
                clientState.qr         = null;
                clientState.qrRaw      = null;
                clientState.lastError  = null;
                clientState.connectedAt = new Date().toISOString();
                reconnectAttempts      = 0;

                try {
                    const user    = sock.user || {};
                    const phoneId = (user.id || '').split(':')[0].split('@')[0];
                    clientState.info = {
                        phone: phoneId,
                        name: user.name || user.notify || '',
                        platform: 'baileys'
                    };
                    console.log(`[READY] Connected as ${clientState.info.name || '?'} (${clientState.info.phone})`);
                } catch (e) {
                    console.warn('[READY] Tidak bisa baca user info:', e.message);
                }
            }

            if (connection === 'close') {
                // Jika sedang tidur atau shutdown → abaikan, jangan reconnect
                if (isSleeping || isShuttingDown) return;

                const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
                const reason     = DisconnectReason[statusCode] || 'unknown';
                const errorMsg   = lastDisconnect?.error?.message || String(lastDisconnect?.error || 'unknown');

                console.log(`[CLOSE] Koneksi putus — code=${statusCode} reason=${reason} err="${errorMsg}"`);
                clientState.info           = null;
                clientState.disconnectedAt = new Date().toISOString();

                if (statusCode === DisconnectReason.loggedOut) {
                    clientState.status    = 'logged_out';
                    clientState.lastError = 'Logged out. Scan QR code again to reconnect.';
                    await wipeSession().catch(err => console.warn('[SESSION] Wipe gagal:', err.message));
                    console.log('[SESSION] Wiped — siap re-scan');
                    scheduleReconnect(0);
                    return;
                }

                clientState.status    = 'disconnected';
                clientState.lastError = `${reason}: ${errorMsg}`;
                reconnectAttempts    += 1;
                scheduleReconnect();
            }
        });

        // Incoming messages
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                try {
                    if (msg.key.fromMe) continue;
                    if (msg.key.remoteJid === 'status@broadcast') continue;
                    if (msg.key.remoteJid?.endsWith('@g.us')) continue;

                    const text =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    if (!text) continue;

                    const remoteJid = msg.key.remoteJid || '';
                    const pushname  = msg.pushName || '';
                    let phoneJid;

                    if (remoteJid.endsWith('@lid')) {
                        const realPhone = msg.key.senderPn || msg.key.remoteJidAlt;
                        if (!realPhone) {
                            console.log(`[MSG IN] LID-only sender ${pushname} (${remoteJid}) — no real phone, skipped`);
                            continue;
                        }
                        phoneJid = realPhone;
                    } else {
                        phoneJid = remoteJid;
                    }

                    const phone       = phoneJid.replace('@s.whatsapp.net', '').replace('@lid', '').split(':')[0];
                    const waMessageId = msg.key.id;
                    const timestamp   = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);

                    console.log(`[MSG IN] ${pushname} (${phone}): ${text.substring(0, 60)}`);

                    await forwardIncoming({
                        sender: phone, message: text, pushname,
                        timestamp, wa_message_id: waMessageId, source: 'wa-bridge'
                    });
                } catch (err) {
                    console.error('[MSG IN] Processing error:', err.message);
                }
            }
        });

    } catch (err) {
        clientState.status    = 'error';
        clientState.lastError = err.message;
        console.error('[INIT] Gagal start socket:', err.message);
        reconnectAttempts += 1;
        scheduleReconnect();
    }
}

function scheduleReconnect(overrideMs = null) {
    if (isShuttingDown || isSleeping) return;
    if (reconnectTimer) return;

    let delay;
    if (overrideMs !== null) {
        delay = overrideMs;
    } else {
        const base   = Math.min(RECONNECT_MIN_DELAY * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_DELAY);
        const jitter = Math.floor(Math.random() * 2000);
        delay = base + jitter;
    }

    console.log(`[RECONNECT] Retry dalam ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startSocket().catch(err => {
            console.error('[RECONNECT] startSocket throw:', err.message);
            reconnectAttempts += 1;
            scheduleReconnect();
        });
    }, delay);
}

// ============================================
// API ROUTES
// ============================================
app.get('/', (req, res) => {
    res.json({
        service: 'Cahaya Phone WA Bridge v2 (Baileys)',
        status: clientState.status,
        uptime_seconds: Math.round(process.uptime()),
        active_hours_wita: `${ACTIVE_HOUR_START}:00 – ${ACTIVE_HOUR_END}:00`,
        sleep_until: clientState.sleepUntil || null
    });
});

app.get('/api/status', authCheck, (req, res) => {
    res.json({
        success: true,
        status: clientState.status,
        qr: clientState.qr,
        info: clientState.info,
        lastError: clientState.lastError,
        connectedAt: clientState.connectedAt,
        disconnectedAt: clientState.disconnectedAt,
        sleepUntil: clientState.sleepUntil,
        pendingForwards: pendingForwards.length,
        oldestPendingForwardAgeSec: pendingForwards.length > 0
            ? Math.round((Date.now() - pendingForwards[0].queuedAt) / 1000) : 0
    });
});

app.post('/api/send', authCheck, async (req, res) => {
    const { phone, message, typing } = req.body;
    if (!phone || !message)
        return res.status(400).json({ success: false, error: 'phone and message required' });
    if (!isReady())
        return res.status(503).json({ success: false, error: `WhatsApp not connected (status: ${clientState.status})` });

    const jid = toJid(phone);
    if (!jid) return res.status(400).json({ success: false, error: 'Invalid phone number' });

    // Verify the number is actually ON WhatsApp before sending. Baileys'
    // sendMessage() to a non-existent number does NOT throw — the message silently
    // vanishes yet we'd report success and wrongly mark it delivered. Checking
    // onWhatsApp first turns a typo'd/unregistered number into a clear failure the
    // backend flags as FAILED (not SENT). It also avoids messaging dead numbers,
    // which hurts the sender's reputation (ban signal).
    try {
        const clean = String(phone).replace(/\D/g, '');
        const [info] = await sock.onWhatsApp(clean);
        if (!info || info.exists === false) {
            console.log(`[SKIP] ${phone}: not registered on WhatsApp`);
            return res.status(422).json({ success: false, phone, registered: false, error: 'not_registered' });
        }
    } catch (_) {
        // Registration check failed (transient) — don't block a legit send; fall
        // through and attempt it (preserves prior behavior on check errors).
    }

    try {
        if (typing) {
            try {
                await sock.presenceSubscribe(jid);
                await sock.sendPresenceUpdate('composing', jid);
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
                await sock.sendPresenceUpdate('paused', jid);
            } catch (_) {}
        }
        const result      = await sock.sendMessage(jid, { text: message });
        const waMessageId = result?.key?.id || null;
        console.log(`[SENT] ${phone} (wa_id: ${waMessageId})`);
        return res.json({ success: true, phone, wa_message_id: waMessageId });
    } catch (err) {
        console.error(`[SEND FAIL] ${phone}:`, err.message);
        return res.status(500).json({ success: false, phone, error: err.message });
    }
});

app.post('/api/check-number', authCheck, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'phone required' });
    if (!isReady()) return res.status(503).json({ success: false, error: `Not connected (status: ${clientState.status})` });

    try {
        const clean    = String(phone).replace(/\D/g, '');
        const [result] = await sock.onWhatsApp(clean);
        if (result?.exists) return res.json({ success: true, registered: true, jid: result.jid });
        return res.json({ success: true, registered: false });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/disconnect', authCheck, async (req, res) => {
    try {
        if (sock) {
            try { await sock.logout(); } catch (_) {}
            try { sock.end(new Error('manual disconnect')); } catch (_) {}
            sock = null;
        }
        await wipeSession();
        clientState.status = 'logged_out';
        clientState.info   = null;
        clientState.qr     = null;
        res.json({ success: true, message: 'Disconnected & session wiped. Restart to get new QR.' });
        setTimeout(() => startSocket().catch(() => {}), 1500);
    } catch (err) {
        console.error('[DISCONNECT] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/restart', authCheck, async (req, res) => {
    try {
        res.json({ success: true, message: 'Restarting socket...' });
        if (sock) {
            try { sock.end(new Error('manual restart')); } catch (_) {}
            sock = null;
        }
        // Override sleep — admin minta reconnect manual
        isSleeping        = false;
        clientState.sleepUntil = null;
        reconnectAttempts = 0;
        if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
        setTimeout(() => startSocket().catch(err => console.error('[RESTART] Failed:', err.message)), 500);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// STARTUP
// ============================================
app.listen(PORT, () => {
    console.log(`
========================================
  Cahaya Phone WA Bridge v2 (Baileys)
  Port    : ${PORT}
  Webhook : ${WEBHOOK_URL || '(not configured)'}
  Session : ${SESSION_DIR}
  Jam ops : ${ACTIVE_HOUR_START}:00 – ${ACTIVE_HOUR_END}:00 WITA
========================================
    `);

    initOperationalSchedule();

    // Hanya start socket jika sekarang jam operasional
    if (!isSleeping) {
        startSocket().catch(err => {
            console.error('[STARTUP] Initial start failed:', err.message);
            reconnectAttempts = 1;
            scheduleReconnect();
        });
    }
});

// Graceful shutdown — hanya untuk SIGTERM/SIGINT dari Railway
async function shutdown(signal) {
    console.log(`[SHUTDOWN] Received ${signal} — closing...`);
    isShuttingDown = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sleepTimer)     clearTimeout(sleepTimer);
    if (sock) {
        try { sock.end(new Error('shutdown')); } catch (_) {}
    }
    setTimeout(() => process.exit(0), 1500);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Prevent silent crashes
process.on('uncaughtException', (err) => {
    console.error('[CRASH PREVENTED] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRASH PREVENTED] Unhandled Rejection:', reason);
});