// Repair Google contact names using the same rules as chat/form sync.
const path = require('node:path');
const { parseArgs } = require('node:util');
const { sanitizePhone, validatePhone } = require('../utils/phoneUtils');

async function main() {
    const { values } = parseArgs({
        options: {
            phone: { type: 'string' },
            all: { type: 'boolean' },
            help: { type: 'boolean' }
        }
    });
    if (values.help) {
        console.log([
            'Sinkronkan ulang nama Google Contacts dari data customer.',
            '  node backend/scripts/sync_contact_names.js --phone 081234567890',
            '  node backend/scripts/sync_contact_names.js --all',
            '--phone memperbaiki satu nomor; --all memproses semua nomor valid.',
            'Konfigurasi mengikuti backend/.env atau environment deployment.'
        ].join('\n'));
        return;
    }
    if (Boolean(values.phone) === Boolean(values.all)) {
        throw new Error('Pilih salah satu: --phone NOMOR atau --all. Gunakan --help untuk panduan.');
    }
    const phone = sanitizePhone(values.phone);
    if (values.phone && (!validatePhone(phone).valid || /^620*$/.test(phone))) {
        throw new Error('Nomor WhatsApp tidak valid.');
    }

    require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
    const db = require('../config/database');
    const google = require('../config/google');
    try {
        if (!await google.getAuthenticatedClient()) {
            throw new Error('Google Contacts belum terhubung. Hubungkan kembali melalui panel admin.');
        }
        const { rows } = await db.query(
            values.phone
                ? 'SELECT id, whatsapp FROM customers WHERE whatsapp = $1'
                : `SELECT id, whatsapp FROM customers
                   WHERE whatsapp ~ '^62[0-9]{9,13}$' AND whatsapp !~ '^620*$'
                   ORDER BY id`,
            values.phone ? [phone] : []
        );
        if (rows.length === 0) {
            console.log('Tidak ada customer yang cocok.');
            return;
        }
        let saved = 0, failed = 0;
        for (let i = 0; i < rows.length; i++) {
            const result = await google.syncCustomerContactName(rows[i].whatsapp);
            if (result.success) saved++;
            else {
                failed++;
                console.error('Customer #' + rows[i].id + ': ' + result.error);
            }
            if (i < rows.length - 1) await new Promise(resolve => setTimeout(resolve, 1500));
        }
        console.log('Selesai: ' + saved + ' tersimpan, ' + failed + ' gagal dari ' + rows.length + ' customer.');
        if (failed) process.exitCode = 1;
    } finally {
        await db.end();
    }
}

main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
});
