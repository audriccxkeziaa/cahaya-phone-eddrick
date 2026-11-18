// New timestamps use timestamptz; legacy timestamp columns contain UTC wall time.
async function ensureContactSchema(db) {
    await db.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_purchase_at TIMESTAMPTZ');
    // Run on migration/startup, never on normal chats or repeat purchases. Once set,
    // this timestamp survives purchase edits/deletions and application restarts.
    await db.query(`
        UPDATE customers c SET first_purchase_at =
            COALESCE((SELECT MIN(p.created_at) FROM purchases p WHERE p.customer_id = c.id),
                     c.created_at) AT TIME ZONE 'UTC'
        WHERE c.tipe = 'Belanja' AND c.first_purchase_at IS NULL
    `);
}

module.exports = { ensureContactSchema };
