// Script: normalize_brands.js
// Purpose: Clean & normalize merk_unit/tipe_unit on existing rows in
//          `customers` and `purchases` using brandUtils.normalizeBrandAndModel.
// Usage:   node backend/scripts/normalize_brands.js [--dry-run]
//
// What it does:
//  - Reads every row's (merk_unit, tipe_unit), runs the normalizer.
//  - If anything changes, UPDATE that row.
//  - Prints a summary of changes.
//
// Safe to re-run: idempotent. Run with --dry-run first to preview.

const db = require('../config/database');
const { normalizeBrandAndModel } = require('../utils/brandUtils');

const DRY_RUN = process.argv.includes('--dry-run');

async function normalizeTable(table, idCol = 'id') {
    console.log(`\n📋 Processing table: ${table}`);
    const { rows } = await db.query(`SELECT ${idCol}, merk_unit, tipe_unit FROM ${table}`);
    console.log(`   Found ${rows.length} rows`);

    let changed = 0;
    let unchanged = 0;
    const samples = [];

    for (const row of rows) {
        const out = normalizeBrandAndModel(row.merk_unit, row.tipe_unit);
        if (!out.normalized) { unchanged++; continue; }

        if (samples.length < 10) {
            samples.push({
                id: row[idCol],
                from: `${row.merk_unit || 'NULL'} | ${row.tipe_unit || 'NULL'}`,
                to:   `${out.merk_unit || 'NULL'} | ${out.tipe_unit || 'NULL'}`
            });
        }

        if (!DRY_RUN) {
            await db.query(
                `UPDATE ${table} SET merk_unit = $1, tipe_unit = $2 WHERE ${idCol} = $3`,
                [out.merk_unit, out.tipe_unit, row[idCol]]
            );
        }
        changed++;
    }

    console.log(`   ✓ Changed: ${changed} rows | Unchanged: ${unchanged}`);
    if (samples.length) {
        console.log(`   Sample diffs:`);
        for (const s of samples) {
            console.log(`     #${s.id}: "${s.from}"  →  "${s.to}"`);
        }
    }
    return { changed, unchanged };
}

(async () => {
    try {
        if (DRY_RUN) console.log('🔍 DRY RUN — no DB writes will be performed.\n');

        const cust = await normalizeTable('customers');
        const purch = await normalizeTable('purchases');

        console.log('\n────────────────────────────────────────');
        console.log(`Total changes: customers=${cust.changed}  purchases=${purch.changed}`);
        if (DRY_RUN) console.log('Re-run without --dry-run to apply.');
        else console.log('✅ Migration complete.');

        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err.message || err);
        process.exit(1);
    }
})();
