const db = require('../config/database');

// Legacy timestamp columns store UTC wall time. Convert to WITA explicitly so
// reporting is independent of both the database and application server timezone.
const localDate = column => `(${column} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Makassar')`;

function storeCalendar() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit'
    }).formatToParts(new Date());
    return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

exports.getSalesSummary = () => db.query(`
    WITH bounds AS (
        SELECT DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Makassar') AS month
    ), sales AS (
        SELECT ${localDate('created_at')} AS bought_at,
               COALESCE(harga, 0) * COALESCE(qty, 1) AS amount FROM purchases
    )
    SELECT COUNT(*) AS transaction_count,
        COALESCE(SUM(amount), 0) AS total_omzet,
        COALESCE(SUM(amount) FILTER (WHERE bought_at >= month AND bought_at < month + INTERVAL '1 month'), 0) AS omzet_bulan_ini,
        COALESCE(SUM(amount) FILTER (WHERE bought_at >= month - INTERVAL '1 month' AND bought_at < month), 0) AS omzet_bulan_lalu,
        COUNT(*) FILTER (WHERE bought_at >= month AND bought_at < month + INTERVAL '1 month') AS success_bulan_ini,
        COUNT(*) FILTER (WHERE bought_at >= month - INTERVAL '1 month' AND bought_at < month) AS success_bulan_lalu
    FROM sales CROSS JOIN bounds
`);

exports.getPipelineMonthly = async (req, res) => {
    try {
        const { year: currentYear, month: currentMonth } = storeCalendar();
        const year = req.query.year === undefined ? currentYear : Number(req.query.year);
        if (!Number.isInteger(year) || year < 2000 || year > 9999) {
            return res.status(400).json({ success: false, message: 'Tahun tidak valid' });
        }
        const { rows } = await db.query(`
            WITH months AS (
                SELECT generate_series(make_date($1::int, 1, 1), make_date($1::int, 12, 1), INTERVAL '1 month')::date AS month_start
            ), cust AS (
                SELECT DATE_TRUNC('month', ${localDate('created_at')})::date AS month_start,
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status IN ('New','Contacted','Follow Up'))::int AS active,
                    COUNT(*) FILTER (WHERE status = 'Inactive')::int AS lost
                FROM customers
                WHERE EXTRACT(YEAR FROM ${localDate('created_at')}) = $1
                GROUP BY 1
            ), sales AS (
                SELECT DATE_TRUNC('month', ${localDate('created_at')})::date AS month_start,
                    COUNT(*)::int AS sukses, COUNT(DISTINCT customer_id)::int AS buyers,
                    COALESCE(SUM(COALESCE(harga, 0) * COALESCE(qty, 1)), 0) AS omzet
                FROM purchases
                WHERE EXTRACT(YEAR FROM ${localDate('created_at')}) = $1
                GROUP BY 1
            )
            SELECT TO_CHAR(m.month_start, 'YYYY-MM') AS bulan,
                TO_CHAR(m.month_start, 'Mon YYYY') AS label,
                COALESCE(c.total, 0) AS total, COALESCE(c.active, 0) AS active,
                COALESCE(c.lost, 0) AS lost, COALESCE(s.sukses, 0) AS sukses,
                COALESCE(s.buyers, 0) AS buyers, COALESCE(s.omzet, 0) AS omzet
            FROM months m LEFT JOIN cust c USING (month_start) LEFT JOIN sales s USING (month_start)
            ORDER BY m.month_start
        `, [year]);
        const { rows: years } = await db.query(`
            SELECT DISTINCT EXTRACT(YEAR FROM ${localDate('created_at')})::int AS year
            FROM (SELECT created_at FROM customers UNION ALL SELECT created_at FROM purchases) history
            WHERE created_at IS NOT NULL ORDER BY year DESC
        `);
        const availableYears = [...new Set([currentYear, year, ...years.map(r => r.year)])].sort((a, b) => b - a);
        res.json({ success: true, data: rows, meta: {
            year, currentYear, currentMonth, isArchive: year < currentYear,
            isFuture: year > currentYear, availableYears
        } });
    } catch (error) {
        console.error('Pipeline monthly error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil laporan bulanan' });
    }
};

exports.getPipelineMonthDetail = async (req, res) => {
    const month = req.query.month;
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (typeof month !== 'string' || !/^[2-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) ||
        !Number.isSafeInteger(page) || page < 1 || page > 1000000) {
        return res.status(400).json({ success: false, message: 'Bulan atau halaman tidak valid' });
    }
    const pageSize = 25;
    // Convert WITA month boundaries back to legacy UTC timestamps for indexed filtering.
    const filter = `p.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Makassar' AT TIME ZONE 'UTC')
        AND p.created_at < (($1::date + INTERVAL '1 month') AT TIME ZONE 'Asia/Makassar' AT TIME ZONE 'UTC')`;
    try {
        const { rows: [summary] } = await db.query(`
            SELECT COUNT(*)::int AS transactions, COUNT(DISTINCT p.customer_id)::int AS buyers,
                COALESCE(SUM(COALESCE(p.qty, 1)), 0) AS units,
                COALESCE(SUM(COALESCE(p.harga, 0) * COALESCE(p.qty, 1)), 0) AS omzet
            FROM purchases p WHERE ${filter}
        `, [month + '-01']);
        const { rows } = await db.query(`
            SELECT p.id, p.customer_id, c.nama_lengkap, c.whatsapp,
                p.created_at AT TIME ZONE 'UTC' AS purchased_at,
                p.merk_unit, p.tipe_unit, p.harga, COALESCE(p.qty, 1) AS qty,
                COALESCE(p.harga, 0) * COALESCE(p.qty, 1) AS subtotal,
                p.nama_sales, p.metode_pembayaran
            FROM purchases p JOIN customers c ON c.id = p.customer_id
            WHERE ${filter} ORDER BY p.created_at DESC, p.id DESC LIMIT $2 OFFSET $3
        `, [month + '-01', pageSize, (page - 1) * pageSize]);
        res.json({ success: true, data: rows, summary, meta: {
            month, page, pageSize, totalPages: Math.max(1, Math.ceil(summary.transactions / pageSize))
        } });
    } catch (error) {
        console.error('Pipeline detail error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil detail pembelian' });
    }
};
