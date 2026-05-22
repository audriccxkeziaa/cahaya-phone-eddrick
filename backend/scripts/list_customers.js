// List sample customers for debugging
const db = require('../config/database');

async function run() {
    try {
        const [rows] = await db.query('SELECT id, nama_lengkap, whatsapp, status, created_at FROM customers ORDER BY id LIMIT 20');
        console.log('🔎 Customers:');
        rows.forEach(r => {
            console.log(`${r.id}	${r.whatsapp}	${r.status}	${r.created_at}`);
        });
        process.exit(0);
    } catch (err) {
        console.error('❌ Failed to query customers:', err);
        process.exit(1);
    }
}

run();