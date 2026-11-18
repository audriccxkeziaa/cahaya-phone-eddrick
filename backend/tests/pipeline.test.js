const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');

async function fixture(t) {
    const db = new PGlite();
    t.after(() => db.close());
    const migration = fs.readFileSync(path.join(__dirname, '../migrate.js'), 'utf8');
    for (const table of ['customers', 'purchases']) {
        const ddl = migration.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n        \\)`));
        await db.exec(ddl[0]);
    }
    const source = fs.readFileSync(path.join(__dirname, '../controllers/pipelineController.js'), 'utf8');
    const module = { exports: {} };
    vm.runInNewContext('(function(require, exports) {' + source + '\n})', { console })(
        name => { assert.equal(name, '../config/database'); return db; }, module.exports
    );
    return { db, controller: module.exports };
}

async function call(handler, query) {
    let body, status = 200;
    await handler({ query }, {
        json(value) { body = value; },
        status(value) { status = value; return this; }
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.success, true);
    return body;
}

test('PostgreSQL: all 12 months include repeat orders by WITA purchase date across years and DB timezones', async t => {
    const { db, controller } = await fixture(t);
    await db.exec(`
        INSERT INTO customers (nama_lengkap, whatsapp, created_at, status) VALUES
            ('Budi', '6281234567890', '2025-01-02', 'Completed'),
            ('New lead', '6281399999999', '2026-10-01', 'New');
        INSERT INTO purchases (customer_id, harga, qty, created_at) VALUES
            (1, 100, 2, '2025-12-31 15:59:59'),
            (1, 300, 1, '2025-12-31 16:00:00'),
            (1, 400, 2, '2026-10-31 15:59:59'),
            (1, 500, 1, '2026-10-31 16:00:00'),
            (1, 600, 1, '2026-11-10 04:00:00'),
            (1, NULL, NULL, '2026-11-11 04:00:00'),
            (1, 700, 1, '2026-12-31 16:00:00');
    `);
    for (const zone of ['UTC', 'Asia/Makassar', 'Pacific/Auckland', 'America/Los_Angeles']) {
        await db.exec(`SET TIME ZONE '${zone}'`);
        const report = await call(controller.getPipelineMonthly, { year: '2026' });
        assert.equal(report.data.length, 12, zone);
        assert.equal(report.data[0].bulan, '2026-01');
        assert.equal(report.data[11].bulan, '2026-12');
        assert.equal(Number(report.data[0].omzet), 300);
        assert.equal(Number(report.data[9].omzet), 800);
        assert.equal(report.data[10].sukses, 3); // One buyer, three purchase records.
        assert.equal(report.data[10].buyers, 1);
        assert.equal(Number(report.data[10].omzet), 1100);
        assert.equal(report.data[10].total, 0); // Registration is separate from purchase date.
        assert.equal(report.data[9].total, 1);
        assert.ok(report.meta.availableYears.includes(2027)); // Purchase-only year.
        const detail = await call(controller.getPipelineMonthDetail, { month: '2026-11' });
        assert.equal(detail.summary.transactions, report.data[10].sukses);
        assert.equal(Number(detail.summary.omzet), Number(report.data[10].omzet));
        assert.equal(detail.data.length, 3);
        assert.equal(new Date(detail.data[2].purchased_at).toISOString(), '2026-10-31T16:00:00.000Z');
        assert.equal(detail.data[2].nama_lengkap, 'Budi');
        const empty = await call(controller.getPipelineMonthDetail, { month: '2026-02' });
        assert.equal(empty.summary.transactions, 0);
        assert.equal(empty.data.length, 0);
        assert.equal(Number(empty.summary.omzet), 0);
    }
});

test('PostgreSQL: detail pagination has stable ordering and monthly totals cover every page', async t => {
    const { db, controller } = await fixture(t);
    await db.exec(`
        INSERT INTO customers (nama_lengkap, whatsapp) VALUES ('Buyer', '6281234567890');
        INSERT INTO purchases (customer_id, harga, qty, created_at)
            SELECT 1, 1000, 2, '2026-11-15 04:00:00'::timestamp FROM generate_series(1, 27);
    `);
    const first = await call(controller.getPipelineMonthDetail, { month: '2026-11', page: '1' });
    const second = await call(controller.getPipelineMonthDetail, { month: '2026-11', page: '2' });
    assert.equal(first.data.length, 25);
    assert.equal(second.data.length, 2);
    assert.equal(first.meta.totalPages, 2);
    assert.equal(Number(first.summary.omzet), 54000);
    assert.equal(first.summary.transactions, 27);
    assert.equal(first.summary.buyers, 1);
    assert.equal(new Set([...first.data, ...second.data].map(p => p.id)).size, 27);
    assert.equal(first.data[0].id, 27);
    assert.equal(second.data[1].id, 1);
});

test('PostgreSQL: dashboard sales totals use the same WITA calendar as monthly reports', async t => {
    const { db, controller } = await fixture(t);
    await db.exec(`
        INSERT INTO customers (nama_lengkap, whatsapp) VALUES ('Buyer', '6281234567890');
        WITH bounds AS (SELECT DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Makassar') AS month)
        INSERT INTO purchases (customer_id, harga, qty, created_at)
            SELECT 1, 100, 2, month AT TIME ZONE 'Asia/Makassar' AT TIME ZONE 'UTC' FROM bounds
            UNION ALL SELECT 1, 300, 1, (month - INTERVAL '1 second') AT TIME ZONE 'Asia/Makassar' AT TIME ZONE 'UTC' FROM bounds;
    `);
    for (const zone of ['UTC', 'Asia/Makassar', 'America/Los_Angeles']) {
        await db.exec(`SET TIME ZONE '${zone}'`);
        const summary = (await controller.getSalesSummary()).rows[0];
        assert.equal(Number(summary.omzet_bulan_ini), 200, zone);
        assert.equal(Number(summary.omzet_bulan_lalu), 300, zone);
        assert.equal(Number(summary.total_omzet), 500);
        assert.equal(Number(summary.transaction_count), 2);
        assert.equal(Number(summary.success_bulan_ini), 1);
        assert.equal(Number(summary.success_bulan_lalu), 1);
    }
});

test('report endpoints reject malformed periods and page numbers before accessing the database', async () => {
    const module = { exports: {} };
    const source = fs.readFileSync(path.join(__dirname, '../controllers/pipelineController.js'), 'utf8');
    vm.runInNewContext('(function(require, exports) {' + source + '\n})', { console })(
        () => ({ query() { throw new Error('Unexpected DB access'); } }), module.exports
    );
    for (const [handler, query] of [
        ['getPipelineMonthly', { year: '2026junk' }], ['getPipelineMonthly', { year: '1999' }],
        ['getPipelineMonthly', { year: '' }], ['getPipelineMonthDetail', { month: '2026-13' }],
        ['getPipelineMonthDetail', { month: '2026-00' }], ['getPipelineMonthDetail', { month: '2026-11', page: '-1' }],
        ['getPipelineMonthDetail', { month: '2026-11', page: '1x' }]
    ]) {
        let status;
        await module.exports[handler]({ query }, { status(code) { status = code; return this; }, json() {} });
        assert.equal(status, 400);
    }
});

function uiFixture(apiCall) {
    const elements = Object.fromEntries(['pipelineModal', 'pipelineModalBody', 'pipelineModalTitle'].map(id =>
        [id, { innerHTML: '', textContent: '', classList: { add() {}, remove() {} } }]));
    class StoreDate extends Date {
        constructor(...args) { super(...(args.length ? args : ['2026-11-18T04:00:00Z'])); }
    }
    const context = { window: {}, document: { getElementById: id => elements[id] }, Intl, Date: StoreDate };
    const source = fs.readFileSync(path.join(__dirname, '../../admin/pipeline.js'), 'utf8');
    vm.runInNewContext(source, context);
    const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    context.initializePipelineReports(apiCall, esc);
    return { window: context.window, body: elements.pipelineModalBody };
}

test('admin UI: month detail, empty/error states, year arrows, type tabs, fresh reopen and escaping', async () => {
    const calls = [];
    let failDetail = false;
    const ui = uiFixture(async url => {
        calls.push(url);
        if (url.includes('/monthly')) {
            const year = Number(url.split('year=')[1]);
            return { success: true, data: [{ bulan: `${year}-11`, omzet: 100, sukses: 2, total: 1, buyers: 1 }],
                meta: { year, availableYears: [2026, 2025], isArchive: year < 2026 } };
        }
        if (failDetail) return null;
        const empty = url.includes('2026-02');
        return { success: true, summary: { transactions: empty ? 0 : 2, buyers: 1, units: 2, omzet: 100 },
            meta: { page: 1, totalPages: 1 }, data: empty ? [] : [{ purchased_at: '2026-11-01T00:00:00Z',
                nama_lengkap: '<img src=x onerror=alert(1)>', whatsapp: '6281234567890', qty: 2,
                merk_unit: '<b>brand</b>', tipe_unit: 'A55', subtotal: 100, nama_sales: 'Sales', metode_pembayaran: 'Cash' }] };
    });
    await ui.window.showPipelineDetail('success');
    assert.match(ui.body.innerHTML, /showPipelineMonth\('2026-11'\)/);
    assert.match(ui.body.innerHTML, /Customer belanja/);
    ui.window.switchPipelineType('omzet');
    assert.match(ui.body.innerHTML, /Omzet/);
    await ui.window.changePipelineYear(-1);
    assert.ok(calls.at(-1).endsWith('year=2025'));
    await ui.window.changePipelineYear(1);
    assert.ok(calls.at(-1).endsWith('year=2026'));
    await ui.window.showPipelineMonth('2026-11');
    assert.match(ui.body.innerHTML, /Tanggal \(WITA\)/);
    assert.match(ui.body.innerHTML, /&lt;img/);
    assert.doesNotMatch(ui.body.innerHTML, /<img/);
    ui.window.backToPipelineYear();
    await ui.window.showPipelineMonth('2026-02');
    assert.match(ui.body.innerHTML, /Belum ada pembelian/);
    failDetail = true;
    await ui.window.showPipelineMonth('2026-11');
    assert.match(ui.body.innerHTML, /Gagal memuat detail/);
    await ui.window.showPipelineDetail('success');
    assert.ok(calls.at(-1).endsWith('year=2026'));
});

test('admin UI: late responses cannot overwrite the selected month or a closed report', async () => {
    const pending = [];
    const ui = uiFixture(url => {
        if (url.includes('/monthly')) return Promise.resolve({ success: true, data: [], meta: { year: 2026, availableYears: [2026] } });
        return new Promise(resolve => pending.push(resolve));
    });
    await ui.window.showPipelineDetail('success');
    const october = ui.window.showPipelineMonth('2026-10');
    const november = ui.window.showPipelineMonth('2026-11');
    pending[1]({ success: true, data: [], summary: {}, meta: {} });
    await november;
    const html = ui.body.innerHTML;
    pending[0]({ success: true, data: [], summary: {}, meta: {} });
    await october;
    assert.equal(ui.body.innerHTML, html);
    const december = ui.window.showPipelineMonth('2026-12');
    ui.window.closePipelineModal();
    const closedHtml = ui.body.innerHTML;
    pending[2]({ success: true, data: [], summary: {}, meta: {} });
    await december;
    assert.equal(ui.body.innerHTML, closedHtml);
});
