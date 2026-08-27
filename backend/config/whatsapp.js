// ============================================
// PEMILIH PROVIDER WHATSAPP
//
// Controller cukup require('../config/whatsapp') dan tidak perlu tahu
// transport-nya apa. Keduanya punya permukaan API yang identik — lihat
// wa-service-base.js untuk kontraknya.
//
//   WA_PROVIDER=cloud   → Meta Cloud API resmi (whatsapp-cloud.js)
//   selain itu / kosong → Baileys via wa-bridge (whatsapp-baileys.js)
//
// Rollback dari Cloud API = kembalikan env var ini ke 'baileys' lalu restart.
// Validasi env untuk mode cloud ada di server.js saat boot.
// ============================================

require('dotenv').config();

const provider = String(process.env.WA_PROVIDER || 'baileys').trim().toLowerCase();

module.exports = provider === 'cloud'
    ? require('./whatsapp-cloud')
    : require('./whatsapp-baileys');
