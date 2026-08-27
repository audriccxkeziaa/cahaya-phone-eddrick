// ============================================
// PEMETAAN TEMPLATE META CLOUD API
//
// Hanya dipakai saat WA_PROVIDER=cloud.
//
// `name` dan jumlah parameter HARUS sama persis dengan template yang sudah
// DISETUJUI di WhatsApp Manager. Kalau tidak cocok, Meta menolak dengan
// error 132000 (jumlah parameter) atau 132001 (template tidak ditemukan).
//
// Isi template yang harus didaftarkan ada di docs/MIGRASI-WA-CLOUD-API.md
// Bagian B langkah 6.
//
// `category` di sini hanya catatan untuk manusia — kategori sebenarnya
// ditentukan Meta saat review, dan itu yang menentukan tarif.
// ============================================

const TEMPLATES = {
    // Konfirmasi setelah customer mengisi form di website.
    // Body: "Halo {{1}}, terima kasih telah menghubungi Cahaya Phone Gorontalo.
    //        Data Anda sudah kami terima dan tim kami akan segera menghubungi
    //        Anda untuk proses selanjutnya."
    auto_reply: {
        name: process.env.META_TPL_AUTO_REPLY || 'konfirmasi_data_masuk',
        language: process.env.META_TPL_LANG || 'id',
        category: 'UTILITY',
        params: ctx => [ctx.nama]
    },

    // Body: "Selamat ulang tahun, {{1}}! Semoga sehat dan sukses selalu.
    //        Tunjukkan pesan ini di Cahaya Phone Gorontalo untuk mendapat
    //        penawaran spesial."
    birthday: {
        name: process.env.META_TPL_BIRTHDAY || 'ucapan_ulang_tahun',
        language: process.env.META_TPL_LANG || 'id',
        category: 'MARKETING',
        params: ctx => [ctx.nama]
    },

    // Body: "Halo {{1}}, ada kabar dari Cahaya Phone Gorontalo. {{2}}"
    // {{2}} diisi teks broadcast yang diketik admin.
    broadcast: {
        name: process.env.META_TPL_BROADCAST || 'promo_umum',
        language: process.env.META_TPL_LANG || 'id',
        category: 'MARKETING',
        params: ctx => [ctx.nama, ctx.message]
    }
};

// Parameter template tidak boleh mengandung newline, tab, atau spasi berlebih —
// Meta menolaknya dengan 132000. Broadcast yang diketik admin hampir pasti
// mengandung baris baru, jadi selalu lewat sini.
function sanitizeParam(value) {
    return String(value ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/ {2,}/g, ' ')
        .trim()
        .slice(0, 1024) || '-';
}

// Bangun payload komponen template dari kategori internal.
// Return null kalau kategori tidak punya template terdaftar — pemanggil harus
// memperlakukan itu sebagai kegagalan permanen, bukan mengirim teks bebas.
function buildTemplate(category, ctx) {
    const tpl = TEMPLATES[category];
    if (!tpl) return null;

    const params = tpl.params(ctx).map(sanitizeParam);
    return {
        name: tpl.name,
        language: tpl.language,
        components: params.length
            ? [{ type: 'body', parameters: params.map(text => ({ type: 'text', text })) }]
            : []
    };
}

module.exports = { TEMPLATES, buildTemplate, sanitizeParam };
